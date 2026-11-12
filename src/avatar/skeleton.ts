import { bodyDims, type BodyDims, type ClimberProfile } from '../climber/profile'
import { flagLimb, flagPoint, hipGap, hipPos, shoulderCenter, shoulderGap, shoulderPos, side } from '../planner/body'
import { footPatch, handPatch, holdIdOf } from '../planner/patches'
import type { Beta, BetaStep, Contacts, Limb, PlannerContext, Pose } from '../planner/types'

export type Vec3 = { x: number; y: number; z: number }

export interface Skeleton {
  pelvis: Vec3
  chest: Vec3
  neck: Vec3
  head: Vec3
  L_shoulder: Vec3
  R_shoulder: Vec3
  L_elbow: Vec3
  R_elbow: Vec3
  L_hand: Vec3
  R_hand: Vec3
  L_hip: Vec3
  R_hip: Vec3
  L_knee: Vec3
  R_knee: Vec3
  L_foot: Vec3
  R_foot: Vec3
  /** Limbs stretched beyond reach (for UI highlighting). */
  overstretched: Limb[]
}

export type JointName = Exclude<keyof Skeleton, 'overstretched'>

const BONES: [JointName, JointName][] = [
  ['pelvis', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['chest', 'L_shoulder'],
  ['chest', 'R_shoulder'],
  ['L_shoulder', 'L_elbow'],
  ['L_elbow', 'L_hand'],
  ['R_shoulder', 'R_elbow'],
  ['R_elbow', 'R_hand'],
  ['pelvis', 'L_hip'],
  ['pelvis', 'R_hip'],
  ['L_hip', 'L_knee'],
  ['L_knee', 'L_foot'],
  ['R_hip', 'R_knee'],
  ['R_knee', 'R_foot'],
]

export const SKELETON_BONES = BONES

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z)
const norm = (a: Vec3): Vec3 => {
  const L = len(a) || 1
  return scale(a, 1 / L)
}
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const ease = (t: number) => t * t * (3 - 2 * t)

/** Two-bone analytic IK. Pole tip sits roughly on the preferred bend plane. */
export function twoBoneIk(
  root: Vec3,
  target: Vec3,
  lenA: number,
  lenB: number,
  pole: Vec3,
): { mid: Vec3; end: Vec3; stretch: number } {
  const to = sub(target, root)
  const dist = len(to)
  const max = lenA + lenB
  const min = Math.abs(lenA - lenB)
  const reach = Math.min(max * 0.999, Math.max(min + 1e-4, dist))
  const dir = norm(to)
  const stretch = dist / max
  const end = dist > 1e-6 ? add(root, scale(dir, Math.min(dist, max))) : add(root, { x: 0, y: -reach, z: 0 })
  const d = Math.min(dist, max)
  const cosA = Math.max(-1, Math.min(1, (lenA * lenA + d * d - lenB * lenB) / (2 * lenA * Math.max(d, 1e-6))))
  const along = lenA * cosA
  const height = Math.sqrt(Math.max(0, lenA * lenA - along * along))
  const axis = dir
  let poleDir = sub(pole, root)
  const proj = scale(axis, poleDir.x * axis.x + poleDir.y * axis.y + poleDir.z * axis.z)
  poleDir = sub(poleDir, proj)
  if (len(poleDir) < 1e-4) {
    const fallback = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
    poleDir = cross(axis, fallback)
  }
  poleDir = norm(poleDir)
  const mid = add(root, add(scale(axis, along), scale(poleDir, height)))
  return { mid, end: dist <= max ? target : end, stretch }
}

function handTarget(ctx: PlannerContext, contacts: Contacts, limb: 'LH' | 'RH'): Vec3 | null {
  const id = holdIdOf(contacts[limb])
  if (!id) return null
  const h = ctx.byId.get(id)
  if (!h) return null
  const spot = handPatch(h, contacts[limb])
  return { x: h.x + (spot?.dx ?? 0), y: h.y + (spot?.dy ?? 0), z: (h.depth + (spot?.dz ?? 0)) * 0.7 + 0.02 }
}

function footTarget(ctx: PlannerContext, contacts: Contacts, limb: 'LF' | 'RF', _pose: Pose): Vec3 | null {
  const f = contacts[limb]
  if (!f) return null
  if (f.kind === 'smear') return { x: f.x, y: f.y, z: 0.04 }
  const h = ctx.byId.get(f.id)
  if (!h) return null
  const spot = footPatch(h, f.patch)
  return { x: h.x + (spot?.dx ?? 0), y: h.y + (spot?.dy ?? 0), z: (h.depth + (spot?.dz ?? 0)) * 0.6 + 0.03 }
}

function flagFoot(ctx: PlannerContext, pose: Pose, limb: 'LF' | 'RF'): Vec3 {
  const p = flagPoint(pose, ctx, limb)
  return { x: p.x, y: p.y, z: 0.06 }
}

function danglingFoot(ctx: PlannerContext, pose: Pose, limb: 'LF' | 'RF'): Vec3 {
  const s = side(limb)
  const hip = hipPos(pose, ctx, s)
  const θ = (ctx.angleDeg * Math.PI) / 180
  // World-down projected into wall-local: (0, −cosθ, sinθ).
  const down = { x: 0, y: -Math.cos(θ), z: Math.sin(θ) }
  return add({ x: hip.x, y: hip.y, z: 0.22 }, scale(down, 0.55 * ctx.dims.leg))
}

export function skeletonFromPose(contacts: Contacts, pose: Pose, ctx: PlannerContext, opts?: { flag?: Limb | null }): Skeleton {
  const dims = ctx.dims
  const lean = pose.lean
  const close = shoulderGap(pose.stance) / 0.15
  const hipClose = hipGap(pose.stance) / 0.18
  const pelvis: Vec3 = { x: pose.x, y: pose.y, z: 0.22 * hipClose }
  const sc = shoulderCenter(pose, ctx)
  const chest: Vec3 = { x: sc.x, y: sc.y - 0.15 * dims.torso, z: 0.28 * close }
  const neck: Vec3 = { x: sc.x, y: sc.y + 0.05 * dims.torso, z: 0.32 * close }
  const head: Vec3 = { x: sc.x + 0.15 * dims.neck * Math.sin(lean), y: sc.y + dims.neck, z: 0.38 * close }

  const Ls = shoulderPos(pose, ctx, -1)
  const Rs = shoulderPos(pose, ctx, 1)
  const L_shoulder: Vec3 = { x: Ls.x, y: Ls.y, z: 0.3 * close }
  const R_shoulder: Vec3 = { x: Rs.x, y: Rs.y, z: 0.3 * close }
  const Lh = hipPos(pose, ctx, -1)
  const Rh = hipPos(pose, ctx, 1)
  const L_hip: Vec3 = { x: Lh.x, y: Lh.y, z: 0.2 * hipClose }
  const R_hip: Vec3 = { x: Rh.x, y: Rh.y, z: 0.2 * hipClose }

  const overstretched: Limb[] = []
  const flag = opts?.flag ?? null

  const solveArm = (limb: 'LH' | 'RH', root: Vec3) => {
    const target = handTarget(ctx, contacts, limb) ?? add(root, { x: side(limb) * 0.1, y: -0.3, z: 0.15 })
    const pole = add(root, { x: side(limb) * 0.6, y: -1, z: 0.6 })
    const ik = twoBoneIk(root, target, dims.upperArm, dims.forearm, pole)
    if (ik.stretch > 1.005) overstretched.push(limb)
    return ik
  }
  const solveLeg = (limb: 'LF' | 'RF', root: Vec3) => {
    let target: Vec3
    const flagged = flagLimb(pose.stance)
    if (!contacts[limb]) {
      target = flagged === limb || flag === limb || (flag === null && flagged === null && !contacts[limb === 'LF' ? 'RF' : 'LF'])
        ? flagFoot(ctx, pose, limb)
        : danglingFoot(ctx, pose, limb)
    } else {
      target = footTarget(ctx, contacts, limb, pose) ?? danglingFoot(ctx, pose, limb)
    }
    const dropKnee = (pose.stance === 'drop-knee-L' && limb === 'LF') || (pose.stance === 'drop-knee-R' && limb === 'RF')
    const pole = dropKnee ? add(root, { x: side(limb) * 0.15, y: -1, z: 0.15 }) : add(root, { x: side(limb) * 0.9, y: 0.1, z: 0.8 })
    const ik = twoBoneIk(root, target, dims.thigh, dims.shank, pole)
    if (ik.stretch > 1.005) overstretched.push(limb)
    return ik
  }

  const La = solveArm('LH', L_shoulder)
  const Ra = solveArm('RH', R_shoulder)
  const Ll = solveLeg('LF', L_hip)
  const Rl = solveLeg('RF', R_hip)

  return {
    pelvis,
    chest,
    neck,
    head,
    L_shoulder,
    R_shoulder,
    L_elbow: La.mid,
    R_elbow: Ra.mid,
    L_hand: La.end,
    R_hand: Ra.end,
    L_hip,
    R_hip,
    L_knee: Ll.mid,
    R_knee: Rl.mid,
    L_foot: Ll.end,
    R_foot: Rl.end,
    overstretched,
  }
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    lean: a.lean + (b.lean - a.lean) * t,
    stance: t < 0.5 ? (a.stance ?? 'square') : (b.stance ?? 'square'),
  }
}

function lerpContacts(a: Contacts, b: Contacts, limb: Limb | null, t: number): Contacts {
  if (!limb || t >= 1) return b
  if (t <= 0) return a
  // Discrete contacts: keep previous until the moving limb arrives late in the motion.
  if (t < 0.85) return { ...b, [limb]: a[limb] } as Contacts
  return b
}

/**
 * Skeleton at continuous playback time `s` where floor(s) is the step index
 * and frac(s) is progress through that step's motion (0 = previous pose, 1 = settled).
 */
export function skeletonAt(beta: Beta, ctx: PlannerContext, s: number): { skeleton: Skeleton; step: BetaStep; t: number } {
  const steps = beta.steps
  const max = Math.max(0, steps.length - 1)
  const clamped = Math.min(max + 0.999, Math.max(0, s))
  const i = Math.min(max, Math.floor(clamped))
  const t = clamped - i
  const step = steps[i]
  const prev = steps[Math.max(0, i - 1)]
  const bodyT = ease(Math.min(1, t / 0.6))
  const limbT = ease(Math.max(0, Math.min(1, (t - 0.25) / 0.75)))
  const pose = i === 0 ? step.pose : lerpPose(prev.pose, step.pose, bodyT)
  const contacts = i === 0 ? step.contacts : lerpContacts(prev.contacts, step.contacts, step.limb, limbT)
  const sk = skeletonFromPose(contacts, pose, ctx, { flag: step.statics.flag })
  if (step.limb && t > 0 && t < 1) {
    const key = limbJoint(step.limb)
    const lift = 0.12 * Math.sin(Math.PI * limbT)
    const joint = sk[key]
    sk[key] = { x: joint.x, y: joint.y, z: joint.z + lift }
  }
  return { skeleton: sk, step, t }
}

function limbJoint(limb: Limb): JointName {
  switch (limb) {
    case 'LH':
      return 'L_hand'
    case 'RH':
      return 'R_hand'
    case 'LF':
      return 'L_foot'
    case 'RF':
      return 'R_foot'
  }
}

/** Project wall-local (x,y) through the route frame to normalized image coords. */
export function skeletonToNormalized(sk: Skeleton, ctx: PlannerContext): Record<JointName, { u: number; v: number }> {
  const out = {} as Record<JointName, { u: number; v: number }>
  for (const key of Object.keys(sk) as (keyof Skeleton)[]) {
    if (key === 'overstretched') continue
    const p = sk[key]
    out[key] = ctx.frame.toNormalized({ x: p.x, y: p.y })
  }
  return out
}

export function dimsFor(profile: ClimberProfile): BodyDims {
  return bodyDims(profile)
}
