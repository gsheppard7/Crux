import { z } from 'zod'

const unit = z.number().finite().min(0).max(1)

export const CLIMB_STYLES = ['static', 'balanced', 'dynamic'] as const

export const ClimberProfileSchema = z.object({
  version: z.literal(1),
  name: z.string().max(40),
  heightM: z.number().min(1.2).max(2.3),
  /** Fingertip to fingertip, arms out. Equal to height = ape index 0. */
  wingspanM: z.number().min(1.1).max(2.5),
  weightKg: z.number().min(30).max(160),
  ageYears: z.number().int().min(6).max(90),
  /** Hardest V-grade sent. */
  maxGrade: z.number().int().min(0).max(17),
  /** 0–1. 0.5 ≈ can hang ~60% bodyweight per hand on a 20 mm edge. */
  fingerStrength: unit,
  /** 0–1. Pulling / lock-off strength. */
  pullStrength: unit,
  /** 0–1. Body tension: keeping feet on steep terrain. */
  core: unit,
  /** 0–1. Explosiveness for deadpoints and dynos. */
  power: unit,
  /** 0–1. Hip mobility: high-steps, wide stems. */
  flexibility: unit,
  style: z.enum(CLIMB_STYLES),
})

export type ClimberProfile = z.infer<typeof ClimberProfileSchema>
export type ClimbStyle = ClimberProfile['style']

export const inchesToM = (inches: number) => inches * 0.0254
export const mToInches = (m: number) => m / 0.0254
export const kgToLb = (kg: number) => kg * 2.20462

export function formatFeetInches(m: number): string {
  const total = Math.round(mToInches(m))
  return `${Math.floor(total / 12)}′${total % 12}″`
}

/**
 * Default: 5′11″, ape index 0, ~160 lb, 20 years old, sends V4–V5. Strong
 * for the grade but not exceptional.
 */
export const DEFAULT_CLIMBER: ClimberProfile = {
  version: 1,
  name: 'You',
  heightM: inchesToM(71),
  wingspanM: inchesToM(71),
  weightKg: 72.5,
  ageYears: 20,
  maxGrade: 5,
  fingerStrength: 0.5,
  pullStrength: 0.62,
  core: 0.6,
  power: 0.55,
  flexibility: 0.5,
  style: 'balanced',
}

export interface BodyDims {
  height: number
  wingspan: number
  shoulderHeight: number
  hipHeight: number
  /** Hip joint → shoulder joint. */
  torso: number
  /** Distance between shoulder joints / hip joints. */
  shoulderWidth: number
  hipWidth: number
  upperArm: number
  /** Elbow → grip point (forearm + part of the hand). */
  forearm: number
  /** Shoulder joint → grip point at full extension. */
  arm: number
  thigh: number
  shank: number
  /** Hip joint → foot contact at full extension. */
  leg: number
  neck: number
  headRadius: number
  /** Fingertips overhead, standing flat-footed. */
  standingReach: number
}

/**
 * Segment lengths from standard anthropometric ratios of stature (Winter,
 * "Biomechanics and Motor Control of Human Movement"), with arm length
 * adjusted by the measured wingspan.
 */
export function bodyDims(p: ClimberProfile): BodyDims {
  const H = p.heightM
  const shoulderWidth = 0.2 * H
  // Wingspan = shoulder width + 2 × (shoulder → fingertip). The grip point sits
  // ~5% of H inside the fingertips; scapular elevation when hanging adds ~3%.
  const armToTip = (p.wingspanM - shoulderWidth) / 2
  const arm = armToTip - 0.02 * H
  const upperArm = arm * 0.52
  const shoulderHeight = 0.818 * H
  const hipHeight = 0.53 * H
  return {
    height: H,
    wingspan: p.wingspanM,
    shoulderHeight,
    hipHeight,
    torso: shoulderHeight - hipHeight,
    shoulderWidth,
    hipWidth: 0.1 * H,
    upperArm,
    forearm: arm - upperArm,
    arm,
    thigh: 0.245 * H,
    shank: 0.246 * H,
    leg: 0.491 * H,
    neck: 0.06 * H,
    headRadius: 0.065 * H,
    standingReach: shoulderHeight + armToTip + 0.05 * H,
  }
}

/** Fraction of bodyweight one hand can hold on a 20 mm edge with an ideal pull. */
export function fingerCapacity(p: ClimberProfile): number {
  return 0.3 + 0.6 * p.fingerStrength
}

/** Footwork / technique multiplier that grows with experience. */
export function technique(p: ClimberProfile): number {
  return Math.min(1.12, Math.max(0.8, 0.8 + 0.04 * p.maxGrade))
}

/** Extra reach a deadpoint adds beyond static extension, meters. */
export function dynamicGain(p: ClimberProfile): number {
  return p.style === 'static' ? 0 : 0.1 + 0.3 * p.power
}

export const CLIMBER_STORAGE_KEY = 'crux:climber:v1'

export function loadClimber(storage: Storage | undefined = globalThis.localStorage): ClimberProfile {
  try {
    const text = storage?.getItem(CLIMBER_STORAGE_KEY)
    if (!text) return DEFAULT_CLIMBER
    const parsed = ClimberProfileSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : DEFAULT_CLIMBER
  } catch {
    return DEFAULT_CLIMBER
  }
}

export function saveClimber(p: ClimberProfile) {
  try {
    localStorage.setItem(CLIMBER_STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Non-critical.
  }
}
