import type { Hold, HoldType } from '../model/schema'
import { createHold } from '../model/route'
import { DEFAULT_DEPTH_CM } from '../planner/grip'
import type { SegmentComponent } from './segment'

export interface ClassifyOptions {
  /** Image pixel width of the *original* photo. */
  imageWidth: number
  imageHeight: number
  /** Meters per original-image pixel, or null if uncalibrated. */
  metersPerPixel: number | null
  /** Wall angle (unused for type heuristics today; kept for callers). */
  wallAngleDeg?: number
  /** Normalized floor row from top; null → treat bottom as floor. */
  floorV: number | null
  /** Downscaled width/height used for area-fraction math. */
  segWidth: number
  segHeight: number
}

export interface ClassifiedHold {
  hold: Hold
  /** Suggested start/finish role before route wiring. */
  roleGuess: 'start' | 'finish' | null
}

const DIFFICULTY: Partial<Record<HoldType, number>> = {
  jug: 1,
  edge: 2,
  crimp: 3,
  sloper: 3,
  pinch: 3,
  pocket: 3,
  undercling: 3,
  sidepull: 2,
  volume: 2,
  'foot-chip': 2,
  unknown: 3,
}

function equivDiameterPx(comp: SegmentComponent, segW: number, imageWidth: number): number {
  // Diameter in original image pixels from downscaled area.
  const dSeg = 2 * Math.sqrt(comp.area / Math.PI)
  return (dSeg / segW) * imageWidth
}

/**
 * Type heuristics from shape + size. Low confidence; source 'model'.
 */
export function classifyComponent(comp: SegmentComponent, opts: ClassifyOptions): Omit<Hold, 'id' | 'label'> & { id?: string; label?: string } {
  const { imageWidth, metersPerPixel: mpp, segWidth, segHeight } = opts
  const areaFrac = comp.area / (segWidth * segHeight)
  const diamPx = equivDiameterPx(comp, segWidth, imageWidth)
  const diamM = mpp != null && mpp > 0 ? diamPx * mpp : null
  const widthFrac = diamPx / imageWidth

  // Axis lengths from elongation: major = d * sqrt(e/(1+something)) approx
  // Use bbox + elongation: minor ≈ diam / sqrt(elongation)
  const minorPx = diamPx / Math.sqrt(Math.max(1, comp.elongation))
  const minorM = diamM != null ? diamM / Math.sqrt(Math.max(1, comp.elongation)) : null
  const minorFrac = minorPx / imageWidth

  const elongated = comp.elongation >= 1.85
  const horiz = elongated && (comp.orientation < 35 || comp.orientation > 145)
  const vert = elongated && comp.orientation >= 55 && comp.orientation <= 125

  // Light bias points at the brighter lip. Image +y is down, so a highlight
  // above the centroid (negative y) is a positive hold you pull down on.
  const bias = Math.hypot(comp.lightBias.x, comp.lightBias.y)
  const biasRadius = Math.max(2, Math.sqrt(comp.area / Math.PI))
  let facingDeg: number | null = null
  if (bias > biasRadius * 0.06) {
    let deg = (Math.atan2(comp.lightBias.x, -comp.lightBias.y) * 180) / Math.PI
    if (deg < 0) deg += 360
    facingDeg = deg
  }
  const facingDown = facingDeg != null && facingDeg > 140 && facingDeg < 220
  const facingSide = facingDeg != null && ((facingDeg > 50 && facingDeg < 130) || facingDeg > 230)

  let type: HoldType
  let allowHand = true
  let allowFoot = true
  let confidence: number

  const bboxWFrac = comp.bbox.w / segWidth
  const bboxHFrac = comp.bbox.h / segHeight
  const compact =
    comp.solidity >= 0.62 &&
    comp.elongation < 2.4 &&
    bboxWFrac < 0.28 &&
    bboxHFrac < 0.28
  // Volume: a large compact blob, never a region that spans the wall.
  if (compact && areaFrac >= 0.012 && areaFrac <= 0.04) {
    type = 'volume'
    allowHand = true
    allowFoot = true
    facingDeg = facingSide ? facingDeg : null
    confidence = 0.45
  } else if ((diamM != null && diamM < 0.07) || (diamM == null && widthFrac < 0.015)) {
    type = 'foot-chip'
    allowHand = false
    allowFoot = true
    confidence = 0.4
  } else if (facingDown && (horiz || comp.elongation < 2.2)) {
    type = 'undercling'
    confidence = 0.4
  } else if (horiz) {
    const thin = (minorM != null && minorM < 0.035) || (minorM == null && minorFrac < 0.008)
    type = thin ? 'crimp' : 'edge'
    facingDeg = facingDeg ?? 0
    confidence = 0.4
  } else if (vert && (facingSide || comp.elongation >= 2.2)) {
    type = 'sidepull'
    if (facingDeg == null) facingDeg = comp.orientation < 90 ? 90 : 270
    confidence = 0.36
  } else if (vert) {
    type = 'pinch'
    facingDeg = null
    confidence = 0.32
  } else if (comp.solidity < 0.78 || widthFrac > 0.028 || (diamM != null && diamM > 0.1)) {
    type = 'jug'
    facingDeg = facingDeg ?? 0
    confidence = 0.38
  } else if (areaFrac >= 0.008 || (diamM != null && diamM > 0.18) || widthFrac > 0.06) {
    type = 'sloper'
    facingDeg = null
    confidence = 0.34
  } else {
    type = 'edge'
    facingDeg = facingDeg ?? 0
    confidence = 0.32
  }

  const bboxRadius = Math.max(comp.bbox.w, comp.bbox.h) / 2 / segWidth
  const radius = Math.max(0.004, Math.min(0.25, Math.max((diamPx / 2) / imageWidth, bboxRadius)))

  return {
    u: comp.centroid.u,
    v: comp.centroid.v,
    radius,
    type,
    facingDeg: facingDeg == null ? null : ((facingDeg % 360) + 360) % 360,
    outline: comp.outline.length >= 3 ? comp.outline : null,
    inRoute: comp.isTarget,
    allowHand,
    allowFoot,
    difficulty: DIFFICULTY[type] ?? 3,
    depthCm: DEFAULT_DEPTH_CM[type] ?? 4,
    confidence,
    source: 'model',
    color: comp.meanColorHex.toLowerCase(),
    note: '',
    patches: null,
  }
}

/**
 * Classify all components and guess start/finish among in-route hand holds.
 * Finish = topmost hand hold; starts = lowest 1–2 hand holds ≥ ~0.5 m above floor.
 */
export function classifyHolds(components: SegmentComponent[], opts: ClassifyOptions): ClassifiedHold[] {
  const floorV = opts.floorV ?? 1
  const mpp = opts.metersPerPixel
  const classified: ClassifiedHold[] = components.map((c) => ({
    hold: createHold(classifyComponent(c, opts)),
    roleGuess: null,
  }))

  const handRoute = classified
    .filter((c) => c.hold.inRoute && c.hold.allowHand)
    .sort((a, b) => a.hold.v - b.hold.v) // top (small v) first

  if (handRoute.length === 0) return classified

  // Finish: topmost
  const finish = handRoute[0]!
  finish.roleGuess = 'finish'

  // Starts: lowest hand holds that are ≥ 0.5 m above floor (or clearly above mat)
  const minAboveV =
    mpp != null && mpp > 0
      ? 0.5 / (opts.imageHeight * mpp)
      : 0.08 // ~8% of image height when uncalibrated

  const candidates = [...handRoute]
    .filter((c) => c.hold.v < floorV - minAboveV)
    .sort((a, b) => b.hold.v - a.hold.v) // lowest first

  const starts = candidates.slice(0, 2).filter((c) => c !== finish)
  for (const s of starts) s.roleGuess = 'start'

  // If only one hand hold, it can be both — keep finish; also mark start if above floor
  if (handRoute.length === 1 && handRoute[0]!.hold.v < floorV - minAboveV) {
    handRoute[0]!.roleGuess = 'finish' // prefer finish label; parent can dual-assign
  }

  return classified
}
