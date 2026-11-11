import type { Hold } from '../model/schema'
import { createId } from '../model/route'
import { hexToRgb, type NamedColorName, type Rgb } from './color'
import { classifyHolds } from './classify'
import { segmentHolds, type ColorTarget } from './segment'

export type DetectColor =
  | NamedColorName
  | { rgb: Rgb; tolerance?: number }

export interface DetectOptions {
  color: DetectColor
  /** 0–1; higher finds more / smaller holds. Default 0.55. */
  sensitivity?: number
  /** Include off-route holds of other colors. Default false. */
  includeOtherColors?: boolean
  /** Original-image meters per pixel, or null. */
  metersPerPixel?: number | null
  wallAngleDeg?: number
}

export interface DetectResult {
  holds: Hold[]
  startHoldIds: string[]
  finishHoldIds: string[]
  floorV: number | null
  warnings: string[]
  stats: {
    count: number
    targetCount: number
    wallLab: { L: number; a: number; b: number }
    floorV: number | null
    foregroundThreshold: number
  }
}

function resolveColor(color: DetectColor): ColorTarget {
  if (typeof color === 'string') return { kind: 'named', name: color }
  return {
    kind: 'eyedrop',
    rgb: color.rgb,
    tolerance: color.tolerance ?? 18,
  }
}

function readImageData(image: HTMLImageElement | ImageBitmap | ImageData): ImageData {
  if (
    typeof image === 'object' &&
    image !== null &&
    'data' in image &&
    (image as ImageData).data instanceof Uint8ClampedArray
  ) {
    return image as ImageData
  }
  const img = image as HTMLImageElement | ImageBitmap
  const w = 'naturalWidth' in img && img.naturalWidth ? img.naturalWidth : img.width
  const h = 'naturalHeight' in img && img.naturalHeight ? img.naturalHeight : img.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Core detection on ImageData (also used by tests that skip canvas decode).
 */
export function detectHoldsFromImageData(data: ImageData, options: DetectOptions): DetectResult {
  const sensitivity = options.sensitivity ?? 0.55
  const includeOtherColors = options.includeOtherColors ?? false
  const metersPerPixel = options.metersPerPixel ?? null
  const color = resolveColor(options.color)

  const seg = segmentHolds(data, { sensitivity, color, includeOtherColors })
  const classified = classifyHolds(seg.components, {
    imageWidth: seg.sourceWidth,
    imageHeight: seg.sourceHeight,
    metersPerPixel,
    wallAngleDeg: options.wallAngleDeg,
    floorV: seg.floorV,
    segWidth: seg.width,
    segHeight: seg.height,
  })

  const holds: Hold[] = []
  const startHoldIds: string[] = []
  const finishHoldIds: string[] = []

  let i = 1
  for (const c of classified) {
    const id = createId('h')
    const hold: Hold = {
      ...c.hold,
      id,
      label: String(i++),
    }
    holds.push(hold)
    if (c.roleGuess === 'start') startHoldIds.push(id)
    if (c.roleGuess === 'finish') finishHoldIds.push(id)
  }

  const warnings = [...seg.warnings]
  if (holds.length > 40) {
    warnings.push(`Detected ${holds.length} holds — review carefully; noise is likely.`)
  }

  return {
    holds,
    startHoldIds,
    finishHoldIds,
    floorV: seg.floorV,
    warnings,
    stats: {
      count: holds.length,
      targetCount: holds.filter((h) => h.inRoute).length,
      wallLab: seg.wallLab,
      floorV: seg.floorV,
      foregroundThreshold: seg.foregroundThreshold,
    },
  }
}

/**
 * Detect holds from a wall photo. Distinguishes wall / mat / holds, filters by
 * route color (named or eyedropper), and assigns low-confidence type guesses.
 */
export async function detectHolds(
  image: HTMLImageElement | ImageBitmap,
  options: DetectOptions,
): Promise<DetectResult> {
  const data = readImageData(image)
  return detectHoldsFromImageData(data, options)
}

/** Convenience: parse #rrggbb for eyedropper samples from the UI. */
export function sampleFromHex(hex: string, tolerance = 18): DetectColor {
  return { rgb: hexToRgb(hex), tolerance }
}
