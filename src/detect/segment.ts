import {
  deltaE,
  matchesEyedropper,
  matchesNamedColor,
  meanRgb,
  medianLab,
  rgbToHex,
  rgbToLab,
  type Lab,
  type NamedColorName,
  type Rgb,
} from './color'

export type ColorTarget =
  | { kind: 'named'; name: NamedColorName }
  | { kind: 'eyedrop'; rgb: Rgb; tolerance: number }

export interface SegmentOptions {
  /** 0 = strict (fewer pixels), 1 = loose. */
  sensitivity: number
  color: ColorTarget
  /** When true, keep non-target colored blobs as separate components tagged other. */
  includeOtherColors?: boolean
}

export interface SegmentComponent {
  /** Bounding box in downscaled pixel coords. */
  bbox: { x: number; y: number; w: number; h: number }
  /** Centroid in original image normalized coords (u,v). */
  centroid: { u: number; v: number }
  /** Area in downscaled pixels. */
  area: number
  meanColorHex: string
  /** Major-axis angle in degrees clockwise from +x (image right), [0,180). */
  orientation: number
  /** Major/minor axis ratio (≥1). */
  elongation: number
  /** Area / convex-hull area (approx). */
  solidity: number
  /** True when the blob matched the target color filter. */
  isTarget: boolean
  /** Optional binary mask of the downscaled component (row-major). */
  maskPreview?: Uint8Array
}

export interface SegmentResult {
  width: number
  height: number
  /** Original source size before downscale. */
  sourceWidth: number
  sourceHeight: number
  scale: number
  wallLab: Lab
  /** Normalized floor row (from top). null if no mat detected. */
  floorV: number | null
  foregroundThreshold: number
  components: SegmentComponent[]
  warnings: string[]
}

const MAX_SIDE = 640

function isImageData(source: HTMLImageElement | ImageBitmap | ImageData): source is ImageData {
  return (
    typeof source === 'object' &&
    source !== null &&
    'data' in source &&
    'width' in source &&
    'height' in source &&
    (source as ImageData).data instanceof Uint8ClampedArray &&
    !('close' in source) &&
    !('src' in source)
  )
}

/** Create ImageData without relying on the browser constructor (jsdom-safe). */
export function createImageData(width: number, height: number, fill?: Rgb): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill.r
      data[i + 1] = fill.g
      data[i + 2] = fill.b
      data[i + 3] = 255
    }
  }
  // Prefer native ctor when present; otherwise duck-type for tests.
  if (typeof ImageData !== 'undefined') {
    try {
      return new ImageData(data, width, height)
    } catch {
      /* fall through */
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

/** Downscale so max(width,height) ≤ 640, returning ImageData. */
export function downscaleToImageData(
  source: HTMLImageElement | ImageBitmap | ImageData,
  maxSide = MAX_SIDE,
): { data: ImageData; scale: number; sourceWidth: number; sourceHeight: number } {
  let sw: number
  let sh: number
  if (isImageData(source)) {
    sw = source.width
    sh = source.height
  } else {
    sw = 'naturalWidth' in source && source.naturalWidth ? source.naturalWidth : source.width
    sh = 'naturalHeight' in source && source.naturalHeight ? source.naturalHeight : source.height
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))

  if (isImageData(source) && scale === 1) {
    return { data: source, scale: 1, sourceWidth: sw, sourceHeight: sh }
  }

  if (isImageData(source)) {
    return { data: resizeImageData(source, w, h), scale, sourceWidth: sw, sourceHeight: sh }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.drawImage(source, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h), scale, sourceWidth: sw, sourceHeight: sh }
}

function resizeImageData(src: ImageData, tw: number, th: number): ImageData {
  const out = createImageData(tw, th)
  const sx = src.width / tw
  const sy = src.height / th
  for (let y = 0; y < th; y++) {
    const syi = Math.min(src.height - 1, Math.floor(y * sy))
    for (let x = 0; x < tw; x++) {
      const sxi = Math.min(src.width - 1, Math.floor(x * sx))
      const si = (syi * src.width + sxi) * 4
      const di = (y * tw + x) * 4
      out.data[di] = src.data[si]!
      out.data[di + 1] = src.data[si + 1]!
      out.data[di + 2] = src.data[si + 2]!
      out.data[di + 3] = src.data[si + 3]!
    }
  }
  return out
}

function pixelRgb(data: Uint8ClampedArray, i: number): Rgb {
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }
}

function sampleCenterLabs(data: ImageData): Lab[] {
  const { width: W, height: H } = data
  const x0 = Math.floor(W * 0.3)
  const x1 = Math.ceil(W * 0.7)
  const y0 = Math.floor(H * 0.25)
  const y1 = Math.ceil(H * 0.65)
  const labs: Lab[] = []
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 800)))
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * W + x) * 4
      if (data.data[i + 3]! < 128) continue
      labs.push(rgbToLab(pixelRgb(data.data, i)))
    }
  }
  return labs
}

function madOfDeltas(labs: Lab[], center: Lab): number {
  if (labs.length === 0) return 8
  const deltas = labs.map((l) => deltaE(l, center)).sort((a, b) => a - b)
  const mid = Math.floor(deltas.length / 2)
  const med = deltas.length % 2 ? deltas[mid]! : (deltas[mid - 1]! + deltas[mid]!) / 2
  const abs = deltas.map((d) => Math.abs(d - med)).sort((a, b) => a - b)
  const mad = abs.length % 2 ? abs[Math.floor(abs.length / 2)]! : (abs[abs.length / 2 - 1]! + abs[abs.length / 2]!) / 2
  return Math.max(1.5, mad)
}

/**
 * Mat = bottom-band color differing from wall. Scan rows from bottom; rows
 * with ≥55% mat-colored set floorV at the top of that contiguous band.
 */
export function detectFloorV(data: ImageData, wallLab: Lab): number | null {
  const { width: W, height: H } = data
  const bandY0 = Math.floor(H * 0.7)
  const matSamples: Lab[] = []
  for (let y = bandY0; y < H; y += 2) {
    for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4
      const lab = rgbToLab(pixelRgb(data.data, i))
      if (deltaE(lab, wallLab) >= 12) matSamples.push(lab)
    }
  }
  if (matSamples.length < 20) return null
  const matLab = medianLab(matSamples)
  if (deltaE(matLab, wallLab) < 12) return null

  let floorRow = H
  let inMat = false
  for (let y = H - 1; y >= 0; y--) {
    let matCount = 0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (deltaE(rgbToLab(pixelRgb(data.data, i)), matLab) < 14) matCount++
    }
    const frac = matCount / W
    if (frac >= 0.55) {
      inMat = true
      floorRow = y
    } else if (inMat) {
      break
    } else if (y < H * 0.45) {
      break
    }
  }
  if (!inMat) return null
  return floorRow / H
}

function matchesTarget(rgb: Rgb, color: ColorTarget): boolean {
  if (color.kind === 'named') return matchesNamedColor(rgb, color.name)
  return matchesEyedropper(color.rgb, rgb, color.tolerance)
}

function morphCloseOpen(mask: Uint8Array, W: number, H: number): void {
  const dilate = (src: Uint8Array): Uint8Array => {
    const dst = new Uint8Array(src.length)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let on = 0
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
            if (src[ny * W + nx]) on = 1
          }
        }
        dst[y * W + x] = on
      }
    }
    return dst
  }
  const erode = (src: Uint8Array): Uint8Array => {
    const dst = new Uint8Array(src.length)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let on = 1
        for (let dy = -1; dy <= 1 && on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || !src[ny * W + nx]) on = 0
          }
        }
        dst[y * W + x] = on
      }
    }
    return dst
  }
  // close then open
  let m = dilate(mask)
  m = erode(m)
  m = erode(m)
  m = dilate(m)
  mask.set(m)
}

interface RawBlob {
  pixels: { x: number; y: number }[]
  isTarget: boolean
}

function connectedComponents(mask: Uint8Array, targetMask: Uint8Array, W: number, H: number): RawBlob[] {
  const seen = new Uint8Array(W * H)
  const blobs: RawBlob[] = []
  const stack: number[] = []

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    const pixels: { x: number; y: number }[] = []
    let targetVotes = 0
    while (stack.length) {
      const idx = stack.pop()!
      const x = idx % W
      const y = (idx / W) | 0
      pixels.push({ x, y })
      if (targetMask[idx]) targetVotes++
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const ni = ny * W + nx
          if (!mask[ni] || seen[ni]) continue
          seen[ni] = 1
          stack.push(ni)
        }
      }
    }
    blobs.push({ pixels, isTarget: targetVotes >= pixels.length * 0.35 })
  }
  return blobs
}

/** Monotone-chain convex hull; returns hull vertices in order. */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length <= 2) return points.slice()
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: { x: number; y: number }[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function polygonArea(poly: { x: number; y: number }[]): number {
  if (poly.length < 3) return poly.length
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    a += poly[i]!.x * poly[j]!.y - poly[j]!.x * poly[i]!.y
  }
  return Math.abs(a) / 2
}

function shapeStats(pixels: { x: number; y: number }[]): {
  orientation: number
  elongation: number
  solidity: number
  cx: number
  cy: number
} {
  const n = pixels.length
  let sx = 0
  let sy = 0
  for (const p of pixels) {
    sx += p.x
    sy += p.y
  }
  const cx = sx / n
  const cy = sy / n
  let xx = 0
  let yy = 0
  let xy = 0
  for (const p of pixels) {
    const dx = p.x - cx
    const dy = p.y - cy
    xx += dx * dx
    yy += dy * dy
    xy += dx * dy
  }
  xx /= n
  yy /= n
  xy /= n
  const trace = xx + yy
  const det = xx * yy - xy * xy
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det))
  const l1 = trace / 2 + disc
  const l2 = Math.max(1e-6, trace / 2 - disc)
  const elongation = Math.sqrt(Math.max(l1, 1e-6) / l2)
  let orientation = 0
  if (Math.abs(xy) > 1e-9 || Math.abs(xx - yy) > 1e-9) {
    orientation = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI
    if (orientation < 0) orientation += 180
  }
  // Subsample for hull if large
  const sample =
    pixels.length > 400
      ? pixels.filter((_, i) => i % Math.ceil(pixels.length / 400) === 0)
      : pixels
  const hull = convexHull(sample)
  const hullA = Math.max(polygonArea(hull), n)
  const solidity = Math.min(1, n / hullA)
  return { orientation, elongation, solidity, cx, cy }
}

/**
 * Segment holds from a photo / ImageData. Distinguishes wall, mat, and
 * foreground; filters by target color; returns connected components.
 */
export function segmentHolds(
  source: HTMLImageElement | ImageBitmap | ImageData,
  options: SegmentOptions,
): SegmentResult {
  const warnings: string[] = []
  const { data, scale, sourceWidth, sourceHeight } = downscaleToImageData(source)
  const { width: W, height: H } = data
  const labs = sampleCenterLabs(data)
  const wallLab = medianLab(labs)
  const mad = madOfDeltas(labs, wallLab)
  // Higher sensitivity → lower ΔE threshold → more foreground.
  const sens = Math.max(0, Math.min(1, options.sensitivity))
  const T = Math.max(6, 2.2 * mad) * (1.55 - 0.95 * sens)

  const floorV = detectFloorV(data, wallLab)
  if (floorV === null) warnings.push('No mat/floor band detected; using the bottom of the photo as the floor.')
  const floorRow = floorV !== null ? Math.floor(floorV * H) : H

  const fg = new Uint8Array(W * H)
  const targetMask = new Uint8Array(W * H)
  const includeOther = options.includeOtherColors === true

  for (let y = 0; y < floorRow; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (data.data[i + 3]! < 128) continue
      const rgb = pixelRgb(data.data, i)
      const d = deltaE(rgbToLab(rgb), wallLab)
      if (d <= T) continue
      const idx = y * W + x
      const isT = matchesTarget(rgb, options.color)
      if (isT) {
        fg[idx] = 1
        targetMask[idx] = 1
      } else if (includeOther) {
        fg[idx] = 1
      }
    }
  }

  morphCloseOpen(fg, W, H)
  // Keep targetMask only where fg survived morphology
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i]) targetMask[i] = 0
  }

  const minArea = Math.max(12, 0.00006 * W * H)
  const maxArea = 0.15 * W * H
  const raw = connectedComponents(fg, targetMask, W, H)
  const components: SegmentComponent[] = []

  for (const blob of raw) {
    if (!blob.isTarget && !includeOther) continue
    if (blob.isTarget === false && includeOther) {
      // ok
    }
    const area = blob.pixels.length
    if (area < minArea || area > maxArea) continue
    // Prefer target; drop tiny non-target noise more aggressively
    if (!blob.isTarget && area < minArea * 2) continue

    let minX = W
    let minY = H
    let maxX = 0
    let maxY = 0
    const colors: Rgb[] = []
    for (const p of blob.pixels) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
      const i = (p.y * W + p.x) * 4
      colors.push(pixelRgb(data.data, i))
    }
    const stats = shapeStats(blob.pixels)
    // Map centroid to original normalized coords
    const u = (stats.cx + 0.5) / W
    const v = (stats.cy + 0.5) / H
    components.push({
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      centroid: { u, v },
      area,
      meanColorHex: rgbToHex(meanRgb(colors)),
      orientation: stats.orientation,
      elongation: stats.elongation,
      solidity: stats.solidity,
      isTarget: blob.isTarget,
    })
  }

  // Prefer target components when overlapping centroids are very close
  components.sort((a, b) => Number(b.isTarget) - Number(a.isTarget) || b.area - a.area)

  if (components.filter((c) => c.isTarget).length === 0) {
    warnings.push('No holds matched the selected color. Try the eyedropper or lower sensitivity.')
  }

  return {
    width: W,
    height: H,
    sourceWidth,
    sourceHeight,
    scale,
    wallLab,
    floorV,
    foregroundThreshold: T,
    components,
    warnings,
  }
}
