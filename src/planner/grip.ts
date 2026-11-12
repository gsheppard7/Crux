import type { ContactPatch, HoldType } from '../model/schema'
import { fingerCapacity, technique, type ClimberProfile } from '../climber/profile'
import { footPatch, primaryPatch } from './patches'
import type { FootContact, PlannerHold } from './types'

/**
 * Hand-load capacity relative to a 20 mm edge (= 1.0). These are coarse
 * priors for a typical hold of each type, not measurements.
 */
const HAND_TYPE: Record<HoldType, number> = {
  jug: 2.2,
  edge: 1.35,
  crimp: 1.0,
  sloper: 0.95,
  pinch: 1.1,
  pocket: 0.9,
  undercling: 1.4,
  sidepull: 1.35,
  volume: 0.75,
  'foot-chip': 0.35,
  unknown: 1.0,
}

/** Capacity left when pulling exactly against the hold's good direction. */
const DIRECTION_FLOOR: Record<HoldType, number> = {
  jug: 0.5,
  edge: 0.2,
  crimp: 0.15,
  sloper: 0.1,
  pinch: 0.65,
  pocket: 0.35,
  undercling: 0.12,
  sidepull: 0.15,
  volume: 0.35,
  'foot-chip': 0.2,
  unknown: 0.4,
}

const FOOT_TYPE: Record<HoldType, number> = {
  jug: 0.95,
  edge: 0.9,
  crimp: 0.7,
  sloper: 0.55,
  pinch: 0.7,
  pocket: 0.6,
  undercling: 0.5,
  sidepull: 0.7,
  volume: 0.85,
  'foot-chip': 0.75,
  unknown: 0.65,
}

/** Grip difficulty 1 (good) … 5 (poor). Unknown = 3. */
const HAND_DIFFICULTY = [1.45, 1.18, 1.0, 0.8, 0.62]
const FOOT_DIFFICULTY = [1.1, 1.05, 1.0, 0.9, 0.78]

export const DEFAULT_DEPTH_CM: Record<HoldType, number> = {
  jug: 7,
  edge: 3,
  crimp: 2,
  sloper: 6,
  pinch: 5,
  pocket: 4,
  undercling: 4,
  sidepull: 4,
  volume: 25,
  'foot-chip': 2,
  unknown: 4,
}

const sinPos = (deg: number) => Math.sin((Math.max(0, deg) * Math.PI) / 180)

/**
 * 1 when pulling in the hold's ideal direction, down to the type's floor
 * when pulling against it. `pull` points from the hand toward the shoulder
 * in the wall plane (x right, y up). The ideal pull is opposite the
 * surface normal: a jug facing up wants the body below it.
 */
export function directionFactor(hold: Pick<PlannerHold, 'type' | 'facingDeg'>, pull: { x: number; y: number } | null): number {
  if (hold.facingDeg === null || !pull) return 1
  const len = Math.hypot(pull.x, pull.y)
  if (len < 1e-6) return 1
  const f = (hold.facingDeg * Math.PI) / 180
  const c = (-(Math.sin(f) * pull.x) - Math.cos(f) * pull.y) / len
  const a = Math.pow((c + 1) / 2, 1.5)
  const floor = DIRECTION_FLOOR[hold.type]
  return floor + (1 - floor) * a
}

/** Pressing down on a hold (hand below shoulder) is weaker than pulling but often available. */
export const PRESS_EFFICIENCY = 0.85

export interface Pull {
  x: number
  y: number
  /** Shoulder minus contact, out of the wall. Positive pulls off the wall. */
  z?: number
}

/**
 * How well `pull` sits in the patch cone. 1 is straight against the outward
 * normal. The cone widens the score; it is not a measured friction coefficient.
 * Null facing stays omnidirectional in the wall plane, except slopers, which
 * still lose capacity when the shoulder pulls off the wall.
 */
export function patchDirectionFactor(hold: Pick<PlannerHold, 'type' | 'facingDeg'>, patch: ContactPatch, pull: Pull | null): number {
  if (!pull) return 1
  const z = pull.z ?? 0
  const len = Math.hypot(pull.x, pull.y, z)
  if (len < 1e-6) return 1
  if (hold.facingDeg === null && hold.type !== 'sloper') return 1
  const align = -(patch.nx * pull.x + patch.ny * pull.y + patch.nz * z) / len
  const floor = DIRECTION_FLOOR[hold.type]
  const cone = Math.min(1, patch.coneDeg / 90)
  const shaped = Math.pow(Math.max(0, (align + 1) / 2), 1.5 * (1.15 - 0.5 * cone))
  return floor + (1 - floor) * shaped
}

/**
 * Best of pulling (arm in tension, toward the shoulder) and pressing (arm in
 * compression, away from the shoulder). `toShoulder` = shoulder − hand.
 */
export function gripDirectionFactor(
  hold: Pick<PlannerHold, 'type' | 'facingDeg' | 'patches'>,
  toShoulder: Pull | null,
  patch?: ContactPatch,
): number {
  if (!toShoulder) return 1
  const spot = patch ?? ('patches' in hold && hold.patches ? primaryPatch({ patches: hold.patches }, 'hand') : undefined)
  const score = (p: Pull) => (spot ? patchDirectionFactor(hold, spot, p) : directionFactor(hold, p))
  const pull = score(toShoulder)
  if (toShoulder.y <= 0) return pull
  return Math.max(pull, PRESS_EFFICIENCY * score({ x: -toShoulder.x, y: -toShoulder.y, z: -(toShoulder.z ?? 0) }))
}

/** Slopers and volumes lose friction as the wall steepens; most holds lose a little. */
export function steepnessFactor(type: HoldType, angleDeg: number): number {
  const s = sinPos(angleDeg)
  if (type === 'sloper') return Math.max(0.15, 1 - 0.9 * s) * (angleDeg < -2 ? 1.1 : 1)
  if (type === 'volume') return Math.max(0.2, 1 - 0.75 * s)
  if (type === 'pinch' || type === 'jug') return 1
  return 1 - 0.12 * s
}

/** Holding with a bent arm on non-slab terrain costs lock-off strength. */
export function lockoffFactor(profile: ClimberProfile, angleDeg: number, armStretch: number | null): number {
  if (armStretch === null || angleDeg <= 5 || armStretch >= 0.72) return 1
  const bent = 0.55 + 0.35 * profile.pullStrength
  const t = Math.max(0, armStretch) / 0.72
  return bent + (1 - bent) * t
}

/** One hand's capacity on this hold, as a fraction of bodyweight. */
export function handCapacity(
  hold: PlannerHold,
  profile: ClimberProfile,
  angleDeg: number,
  pull: Pull | null,
  armStretch: number | null,
  patch?: ContactPatch,
): number {
  const diff = HAND_DIFFICULTY[(hold.difficulty ?? 3) - 1]
  return (
    fingerCapacity(profile) *
    HAND_TYPE[hold.type] *
    diff *
    gripDirectionFactor(hold, pull, patch) *
    steepnessFactor(hold.type, angleDeg) *
    lockoffFactor(profile, angleDeg, armStretch)
  )
}

/** Smearing works on slab and vertical, barely on slight overhang, not at all on steep walls. */
export function smearEffectiveness(angleDeg: number): number {
  if (angleDeg <= -5) return 0.72
  if (angleDeg <= 5) return 0.5
  if (angleDeg <= 15) return 0.3
  if (angleDeg <= 25) return 0.12
  return 0
}

/**
 * How much of its potential a foot contact contributes, 0–1. Steep walls
 * need core tension to keep feet on, and small footholds suffer most.
 */
export function footEffectiveness(
  foot: FootContact,
  byId: Map<string, PlannerHold>,
  profile: ClimberProfile,
  angleDeg: number,
): number {
  if (!foot) return 0
  const tech = technique(profile)
  if (foot.kind === 'smear') return Math.min(1, smearEffectiveness(angleDeg) * tech)
  const h = byId.get(foot.id)
  if (!h) return 0
  const spot = footPatch(h, foot.patch)
  if (spot?.role === 'heel') {
    // A heel pulls like a third arm on steep ground. Hamstring strength is a prior.
    const heel = (angleDeg > 18 ? 0.62 : 0.28) * tech
    return Math.max(0, Math.min(1, heel))
  }
  if (spot?.role === 'toe') return Math.max(0, Math.min(1, (angleDeg > 10 ? 0.45 : 0.2) * tech))
  const s = sinPos(angleDeg)
  const small = h.type === 'foot-chip' || h.type === 'crimp' || h.type === 'sloper' ? 1 - 0.2 * s : 1
  const steep = 1 - 0.45 * s * (1.2 - profile.core)
  const smearSpot = spot?.role === 'smear' ? 0.85 : 1
  const e = FOOT_TYPE[h.type] * FOOT_DIFFICULTY[(h.difficulty ?? 3) - 1] * steep * small * tech * smearSpot
  return Math.max(0, Math.min(1, e))
}

/** Share of bodyweight on the hands with two good feet, by wall angle. */
export function baseHandShare(angleDeg: number): number {
  const s = Math.sin((angleDeg * Math.PI) / 180)
  return Math.min(0.97, Math.max(0.08, 0.25 + (angleDeg >= 0 ? 0.7 : 1.2) * s))
}

/** Combine both feet into a hand share; the better foot counts more. */
export function handShare(angleDeg: number, e1: number, e2: number): number {
  const hi = Math.max(e1, e2)
  const lo = Math.min(e1, e2)
  const support = Math.min(1, 0.62 * hi + 0.38 * lo)
  return 1 - (1 - baseHandShare(angleDeg)) * support
}

export type GripRating = 'good' | 'moderate' | 'hard' | 'very hard'

export interface HoldGripSummary {
  /** One-hand capacity with an ideal pull and straight arm, × bodyweight. */
  capacity: number
  rating: GripRating
  /** Could one hand hold the climber here with two decent feet? */
  oneHandWithFeet: boolean
  /** Could one hand hold with no feet (campus)? */
  oneHandNoFeet: boolean
}

export function holdGripSummary(hold: PlannerHold, profile: ClimberProfile, angleDeg: number): HoldGripSummary {
  const capacity = handCapacity(hold, profile, angleDeg, null, 1)
  const rating: GripRating = capacity >= 1.2 ? 'good' : capacity >= 0.8 ? 'moderate' : capacity >= 0.5 ? 'hard' : 'very hard'
  return {
    capacity,
    rating,
    oneHandWithFeet: capacity >= handShare(angleDeg, 0.75, 0.75),
    oneHandNoFeet: capacity >= 1,
  }
}
