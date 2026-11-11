import type { Hold, HoldType } from '../model/schema'
import type { BodyDims, ClimberProfile } from '../climber/profile'
import type { WallFrame } from '../model/coords'

export type HandLimb = 'LH' | 'RH'
export type FootLimb = 'LF' | 'RF'
export type Limb = HandLimb | FootLimb
export const LIMBS: Limb[] = ['LH', 'RH', 'LF', 'RF']

/** A foot is on a hold, smearing the wall at a point, or free (flagging / dangling). */
export type FootContact = { kind: 'hold'; id: string } | { kind: 'smear'; x: number; y: number } | null

export interface Contacts {
  LH: string | null
  RH: string | null
  LF: FootContact
  RF: FootContact
}

/** Pelvis position in wall-local meters plus torso lean (radians, + = shoulders to the right). */
export interface Pose {
  x: number
  y: number
  lean: number
}

export interface PlannerHold {
  id: string
  label: string
  x: number
  y: number
  /** Radius in meters. */
  r: number
  depth: number
  type: HoldType
  facingDeg: number | null
  difficulty: number | null
  hand: boolean
  foot: boolean
  matchable: boolean
  confidence: number
  source: Hold['source']
}

export interface PlannerContext {
  holds: PlannerHold[]
  byId: Map<string, PlannerHold>
  handHolds: PlannerHold[]
  footHolds: PlannerHold[]
  startIds: string[]
  finishIds: string[]
  angleDeg: number
  frame: WallFrame
  profile: ClimberProfile
  dims: BodyDims
  /** Planar (in-wall) reach after accounting for the body's distance from the wall. */
  handReach: number
  footReach: number
  scaleCalibrated: boolean
}

export interface HandLoad {
  limb: HandLimb
  holdId: string
  /** Load as a fraction of bodyweight. */
  load: number
  capacity: number
  u: number
}

export interface Statics {
  /** Worst hand utilization (load / capacity). > 1 = cannot hold. */
  uMax: number
  hands: HandLoad[]
  handShare: number
  /** How far (m) the center of mass sits outside the contacts sideways. */
  barnDoor: number
  flag: FootLimb | null
  feet: { limb: FootLimb; effectiveness: number }[]
}

export type MoveKind = 'start' | 'reach' | 'match' | 'cross' | 'dyno' | 'foot' | 'high-step' | 'smear' | 'flag' | 'cut'

export interface BetaStep {
  index: number
  kind: MoveKind
  limb: Limb | null
  contacts: Contacts
  pose: Pose
  statics: Statics
  /** Worst utilization while the moving limb is off. */
  uMid: number | null
  /** Stretch ratio (distance / reach) per loaded limb. */
  stretch: Partial<Record<Limb, number>>
  dynamic: boolean
  title: string
  detail: string[]
  caveats: string[]
}

export interface Beta {
  id: string
  label: string
  steps: BetaStep[]
  cost: number
  cruxStep: number
  maxEffort: number
  summary: string
  verdict: string
  caveats: string[]
}

export interface PlanStats {
  expanded: number
  ms: number
}

export type PlanResult =
  | { ok: true; betas: Beta[]; warnings: string[]; stats: PlanStats }
  | { ok: false; reason: string; diagnostics: string[]; warnings: string[]; partial: Beta | null; stats: PlanStats }
