import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import {
  fitView,
  imageToNormalized,
  metersPerPixelFromReferenceHold,
  metersPerPixelFromWallWidth,
  normalizedToScreen,
  normalizedToWall,
  panBy,
  previewBaseHeight,
  radiusToScreen,
  screenRadiusToNormalized,
  screenToImage,
  screenToNormalized,
  viewTransform,
  wallNormal,
  wallProfile,
  wallToNormalized,
  wallToWorld,
  zoomAt,
} from './coords'

const image = { width: 1200, height: 1600 }

describe('view transform', () => {
  it('fits the image centered inside the container (contain)', () => {
    const t = viewTransform({ width: 1000, height: 1000 }, image, fitView(image))
    // Height-limited: (1000 - 32) / 1600
    expect(t.scale).toBeCloseTo(968 / 1600)
    const tl = normalizedToScreen(t, image, { u: 0, v: 0 })
    const br = normalizedToScreen(t, image, { u: 1, v: 1 })
    expect(tl.y).toBeCloseTo(16)
    expect(br.y).toBeCloseTo(984)
    expect((tl.x + br.x) / 2).toBeCloseTo(500)
  })

  it('round-trips normalized → screen → normalized at arbitrary zoom/pan', () => {
    const view = { zoom: 3.7, center: { x: 210.5, y: 1333.3 } }
    const t = viewTransform({ width: 917, height: 643 }, image, view)
    for (const n of [
      { u: 0, v: 0 },
      { u: 0.123456789, v: 0.987654321 },
      { u: 1, v: 1 },
      { u: 0.5, v: 0.25 },
    ]) {
      const back = screenToNormalized(t, image, normalizedToScreen(t, image, n))
      expect(back.u).toBeCloseTo(n.u, 12)
      expect(back.v).toBeCloseTo(n.v, 12)
    }
  })

  it('keeps the same image point centered when the container resizes', () => {
    const view = { zoom: 2, center: { x: 300, y: 400 } }
    for (const size of [
      { width: 800, height: 600 },
      { width: 1600, height: 900 },
      { width: 375, height: 700 },
    ]) {
      const t = viewTransform(size, image, view)
      const c = screenToImage(t, { x: size.width / 2, y: size.height / 2 })
      expect(c.x).toBeCloseTo(300)
      expect(c.y).toBeCloseTo(400)
    }
  })

  it('zoomAt keeps the point under the cursor fixed', () => {
    const size = { width: 900, height: 700 }
    const view = fitView(image)
    const cursor = { x: 610, y: 222 }
    const before = screenToImage(viewTransform(size, image, view), cursor)
    const zoomed = zoomAt(view, size, image, cursor, 2.5)
    expect(zoomed.zoom).toBeCloseTo(2.5)
    const after = screenToImage(viewTransform(size, image, zoomed), cursor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('zoom is clamped', () => {
    const size = { width: 900, height: 700 }
    expect(zoomAt(fitView(image), size, image, { x: 0, y: 0 }, 1000).zoom).toBe(12)
    expect(zoomAt(fitView(image), size, image, { x: 0, y: 0 }, 0.0001).zoom).toBe(0.5)
  })

  it('panBy moves the image with the pointer', () => {
    const size = { width: 900, height: 700 }
    const view = { zoom: 2, center: { x: 600, y: 800 } }
    const t0 = viewTransform(size, image, view)
    const p0 = normalizedToScreen(t0, image, { u: 0.3, v: 0.3 })
    const t1 = viewTransform(size, image, panBy(view, size, image, 40, -25))
    const p1 = normalizedToScreen(t1, image, { u: 0.3, v: 0.3 })
    expect(p1.x - p0.x).toBeCloseTo(40)
    expect(p1.y - p0.y).toBeCloseTo(-25)
  })

  it('radius conversions are inverse and scale with zoom', () => {
    const size = { width: 900, height: 700 }
    const t1 = viewTransform(size, image, fitView(image))
    const t2 = viewTransform(size, image, { ...fitView(image), zoom: 2 })
    expect(radiusToScreen(t2, image, 0.02)).toBeCloseTo(2 * radiusToScreen(t1, image, 0.02))
    expect(screenRadiusToNormalized(t2, image, radiusToScreen(t2, image, 0.037))).toBeCloseTo(0.037, 12)
  })

  it('imageToNormalized clamps out-of-bounds points', () => {
    expect(imageToNormalized(image, { x: -50, y: 2000 })).toEqual({ u: 0, v: 1 })
  })
})

describe('wall-local coordinates', () => {
  const mpp = 0.003 // 3.6 m × 4.8 m wall

  it('maps the image bottom-left to the wall origin and y up', () => {
    expect(normalizedToWall(image, mpp, { u: 0, v: 1 })).toEqual({ x: 0, y: 0, z: 0 })
    const top = normalizedToWall(image, mpp, { u: 1, v: 0 })
    expect(top.x).toBeCloseTo(3.6)
    expect(top.y).toBeCloseTo(4.8)
  })

  it('round-trips through wall space', () => {
    const n = { u: 0.31, v: 0.77 }
    const back = wallToNormalized(image, mpp, normalizedToWall(image, mpp, n))
    expect(back.u).toBeCloseTo(n.u, 12)
    expect(back.v).toBeCloseTo(n.v, 12)
  })

  it('calibrates scale from wall width and from a reference hold', () => {
    expect(metersPerPixelFromWallWidth(3.6, image)).toBeCloseTo(0.003)
    // radius 0.025 of 1200 px = 30 px → 60 px diameter = 0.24 m → 4 mm/px
    expect(metersPerPixelFromReferenceHold(0.24, 0.025, image)).toBeCloseTo(0.004)
  })
})

describe('world (3D) placement', () => {
  it('vertical wall: y is height, z is protrusion, x is centered', () => {
    expect(wallToWorld({ x: 1.8, y: 2, z: 0.1 }, 0, 3.6)).toEqual([0, 2, 0.1])
  })

  it('overhang leans the top toward the viewer', () => {
    const [, y, z] = wallToWorld({ x: 0, y: 4, z: 0 }, 30, 3.6)
    expect(y).toBeCloseTo(4 * Math.cos(Math.PI / 6))
    expect(z).toBeCloseTo(4 * Math.sin(Math.PI / 6))
    const [, , zs] = wallToWorld({ x: 0, y: 4, z: 0 }, -10, 3.6)
    expect(zs).toBeLessThan(0)
  })

  it('normal is perpendicular to the wall and points at the climber', () => {
    const n = wallNormal(40)
    const up = wallToWorld({ x: 0, y: 1, z: 0 }, 40, 0)
    expect(n[1] * up[1] + n[2] * up[2]).toBeCloseTo(0)
    expect(wallNormal(0)).toEqual([0, -0, 1])
  })

  it('matches the rotated three.js group used by the 3D preview', () => {
    for (const angle of [-15, 0, 25, 60, 90]) {
      const p = { x: 1.1, y: 2.3, z: 0.07 }
      const width = 3.6
      const base = 0.8
      const v = new Vector3(p.x - width / 2, p.y, p.z).applyEuler(new Euler((angle * Math.PI) / 180, 0, 0))
      v.y += base
      const w = wallToWorld(p, angle, width, base)
      expect(w[0]).toBeCloseTo(v.x)
      expect(w[1]).toBeCloseTo(v.y)
      expect(w[2]).toBeCloseTo(v.z)
    }
  })

  it('lifts only steep walls off the floor in the preview', () => {
    expect(previewBaseHeight(0, 4.8)).toBe(0)
    expect(previewBaseHeight(30, 4.8)).toBe(0)
    expect(previewBaseHeight(80, 4.8)).toBeGreaterThan(3)
  })

  it('classifies wall profiles', () => {
    expect(wallProfile(-10)).toBe('slab')
    expect(wallProfile(0)).toBe('vertical')
    expect(wallProfile(20)).toBe('overhang')
    expect(wallProfile(45)).toBe('steep')
    expect(wallProfile(85)).toBe('roof')
  })
})
