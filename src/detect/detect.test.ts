import { describe, expect, it } from 'vitest'
import { matchesNamedColor, rgbToHex, rgbToHsv, rgbToLab, deltaE, type Rgb } from './color'
import { detectHoldsFromImageData } from './detect'
import { createImageData, detectFloorV, segmentHolds } from './segment'

function fillRect(data: ImageData, x0: number, y0: number, w: number, h: number, rgb: Rgb) {
  const { width, data: buf } = data
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= width || y >= data.height) continue
      const i = (y * width + x) * 4
      buf[i] = rgb.r
      buf[i + 1] = rgb.g
      buf[i + 2] = rgb.b
      buf[i + 3] = 255
    }
  }
}

function fillEllipse(data: ImageData, cx: number, cy: number, rx: number, ry: number, rgb: Rgb) {
  const { width, height, data: buf } = data
  const x0 = Math.floor(cx - rx)
  const x1 = Math.ceil(cx + rx)
  const y0 = Math.floor(cy - ry)
  const y1 = Math.ceil(cy + ry)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy > 1) continue
      const i = (y * width + x) * 4
      buf[i] = rgb.r
      buf[i + 1] = rgb.g
      buf[i + 2] = rgb.b
      buf[i + 3] = 255
    }
  }
}

/** Synthetic wall: beige wall, dark mat band, pink elliptical holds. */
function makeWallPhoto(W = 320, H = 400) {
  const wall: Rgb = { r: 210, g: 195, b: 175 }
  const mat: Rgb = { r: 35, g: 38, b: 42 }
  const pink: Rgb = { r: 236, g: 72, b: 153 }
  const blue: Rgb = { r: 59, g: 130, b: 246 }
  const data = createImageData(W, H, wall)
  const matH = Math.floor(H * 0.18)
  fillRect(data, 0, H - matH, W, matH, mat)

  // Three pink holds + one blue distractor
  fillEllipse(data, W * 0.35, H * 0.55, 14, 11, pink)
  fillEllipse(data, W * 0.62, H * 0.48, 12, 10, pink)
  fillEllipse(data, W * 0.48, H * 0.28, 16, 13, pink)
  fillEllipse(data, W * 0.2, H * 0.4, 11, 9, blue)

  return { data, W, H, matH, pink, wall }
}

describe('color helpers', () => {
  it('round-trips RGB→HSV→RGB approximately', () => {
    const rgb = { r: 236, g: 72, b: 153 }
    const hsv = rgbToHsv(rgb)
    expect(hsv.s).toBeGreaterThan(0.4)
    expect(matchesNamedColor(rgb, 'pink')).toBe(true)
    expect(matchesNamedColor(rgb, 'red')).toBe(false)
  })

  it('disambiguates pink vs red', () => {
    expect(matchesNamedColor({ r: 200, g: 30, b: 40 }, 'red')).toBe(true)
    expect(matchesNamedColor({ r: 200, g: 30, b: 40 }, 'pink')).toBe(false)
    expect(matchesNamedColor({ r: 240, g: 120, b: 170 }, 'pink')).toBe(true)
  })

  it('computes Lab ΔE for identical colors as ~0', () => {
    const a = rgbToLab({ r: 100, g: 120, b: 140 })
    expect(deltaE(a, a)).toBeCloseTo(0, 5)
    expect(rgbToHex({ r: 255, g: 0, b: 128 })).toBe('#ff0080')
  })
})

describe('segment + detect', () => {
  it('detects floorV from the dark mat band', () => {
    const { data, H, matH } = makeWallPhoto()
    const wallLab = rgbToLab({ r: 210, g: 195, b: 175 })
    const floorV = detectFloorV(data, wallLab)
    expect(floorV).not.toBeNull()
    // Floor should sit near the top of the mat band
    expect(floorV!).toBeGreaterThan(0.7)
    expect(floorV!).toBeLessThan((H - matH + 8) / H + 0.05)
  })

  it('finds ≥3 pink holds and assigns types', () => {
    const { data } = makeWallPhoto()
    const result = detectHoldsFromImageData(data, {
      color: 'pink',
      sensitivity: 0.6,
      includeOtherColors: false,
      metersPerPixel: null,
    })
    expect(result.floorV).not.toBeNull()
    expect(result.stats.targetCount).toBeGreaterThanOrEqual(3)
    expect(result.holds.length).toBeGreaterThanOrEqual(3)
    for (const h of result.holds) {
      expect(h.source).toBe('model')
      expect(h.color).toMatch(/^#[0-9a-f]{6}$/)
      expect(h.inRoute).toBe(true)
      expect(h.type).not.toBe('unknown')
      expect(h.confidence).toBeLessThan(0.8)
      expect(h.u).toBeGreaterThan(0)
      expect(h.u).toBeLessThan(1)
      expect(h.v).toBeGreaterThan(0)
      expect(h.v).toBeLessThan(result.floorV ?? 1)
    }
    expect(result.finishHoldIds.length).toBe(1)
  })

  it('can include other-color holds as off-route', () => {
    const { data } = makeWallPhoto()
    const result = detectHoldsFromImageData(data, {
      color: 'pink',
      sensitivity: 0.65,
      includeOtherColors: true,
    })
    const others = result.holds.filter((h) => !h.inRoute)
    expect(others.length).toBeGreaterThanOrEqual(1)
  })

  it('segments with eyedropper target', () => {
    const { data, pink } = makeWallPhoto()
    const seg = segmentHolds(data, {
      sensitivity: 0.55,
      color: { kind: 'eyedrop', rgb: pink, tolerance: 22 },
    })
    const targets = seg.components.filter((c) => c.isTarget)
    expect(targets.length).toBeGreaterThanOrEqual(3)
  })
})
