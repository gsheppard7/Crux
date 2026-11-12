import { footEffectiveness, gripDirectionFactor, handCapacity, handShare, holdNeedsLip, supportAlignment } from './grip'
import { footPatch, handPatch, holdIdOf, parseRef, patchCanOppose } from './patches'
import type { ContactPatch } from '../model/schema'
import type { Contacts, FootLimb, HandLimb, HandLoad, Limb, PlannerContext, Pose, StanceId, Statics } from './types'

export interface Vec2 {
  x: number
  y: number
}

export const side = (limb: Limb): -1 | 1 => (limb === 'LH' || limb === 'LF' ? -1 : 1)
export const isHand = (limb: Limb): limb is HandLimb => limb === 'LH' || limb === 'RH'

export const MAX_LEAN = 0.6
export const MIN_PELVIS_Y = 0.3

/** Thigh 0.100 + shank 0.0465 + foot 0.0145 (Winter). A geometric prior, not a measured climbing force. */
export const LEG_MASS_FRACTION = 0.161

const HIP_IN_YAW = 0.8
const DROP_KNEE_YAW = 1.15

export function stanceYaw(stance: StanceId | undefined): number {
  switch (stance) {
    case 'hip-in-L':
      return -HIP_IN_YAW
    case 'hip-in-R':
      return HIP_IN_YAW
    case 'drop-knee-L':
      return -DROP_KNEE_YAW
    case 'drop-knee-R':
      return DROP_KNEE_YAW
    default:
      return 0
  }
}

/** Distance from the shoulder line to the wall. Smaller when a hip turns in. */
export function shoulderGap(stance: StanceId | undefined): number {
  if (stance === 'drop-knee-L' || stance === 'drop-knee-R') return 0.06
  if (stance === 'hip-in-L' || stance === 'hip-in-R') return 0.08
  return 0.15
}

export function hipGap(stance: StanceId | undefined): number {
  if (stance === 'drop-knee-L' || stance === 'drop-knee-R') return 0.08
  if (stance === 'hip-in-L' || stance === 'hip-in-R') return 0.1
  return 0.18
}

export function isDropKnee(stance: StanceId | undefined): boolean {
  return stance === 'drop-knee-L' || stance === 'drop-knee-R'
}

export function flagLimb(stance: StanceId | undefined): FootLimb | null {
  if (stance === 'flag-outside-L') return 'LF'
  if (stance === 'flag-outside-R') return 'RF'
  return null
}

/** Hard gates for a stance. Drop-knee height is checked after the pose is solved. */
export function stanceGate(contacts: Contacts, stance: StanceId, ctx: PlannerContext): { ok: boolean; reason: string } {
  if (stance === 'square' || stance === 'hip-in-L' || stance === 'hip-in-R') return { ok: true, reason: '' }
  if (isDropKnee(stance)) {
    if (ctx.profile.flexibility <= 0) return { ok: false, reason: 'drop knee needs more hip flexibility' }
    const limb: FootLimb = stance === 'drop-knee-L' ? 'LF' : 'RF'
    const foot = contacts[limb]
    if (!foot || foot.kind !== 'hold') return { ok: false, reason: 'drop knee needs that foot on a hold' }
    const hold = ctx.byId.get(foot.id)
    const spot = hold ? footPatch(hold, foot.patch) : undefined
    if (!spot || spot.role !== 'foot-edge') return { ok: false, reason: 'drop knee needs an outside edge' }
    return { ok: true, reason: '' }
  }
  if (stance === 'flag-outside-L') {
    if (contacts.LF || !contacts.RF) return { ok: false, reason: 'outside flag needs the other foot planted' }
    return { ok: true, reason: '' }
  }
  if (stance === 'flag-outside-R') {
    if (contacts.RF || !contacts.LF) return { ok: false, reason: 'outside flag needs the other foot planted' }
    return { ok: true, reason: '' }
  }
  return { ok: true, reason: '' }
}

export function shoulderCenter(pose: Pose, ctx: PlannerContext): Vec2 {
  return { x: pose.x + ctx.dims.torso * Math.sin(pose.lean), y: pose.y + ctx.dims.torso * Math.cos(pose.lean) }
}

export function shoulderPos(pose: Pose, ctx: PlannerContext, s: -1 | 1): Vec2 {
  const c = shoulderCenter(pose, ctx)
  const h = ctx.dims.shoulderWidth / 2
  const ang = pose.lean + stanceYaw(pose.stance)
  // The dropped hip tilts the torso, so the opposite shoulder rises with it.
  const kneeRise = (pose.stance === 'drop-knee-L' && s > 0) || (pose.stance === 'drop-knee-R' && s < 0) ? 0.1 : 0
  return { x: c.x + s * h * Math.cos(ang), y: c.y - s * h * Math.sin(ang) + kneeRise }
}

export function hipPos(pose: Pose, ctx: PlannerContext, s: -1 | 1): Vec2 {
  const yaw = stanceYaw(pose.stance)
  const w = ctx.dims.hipWidth / 2
  const drop = (pose.stance === 'drop-knee-L' && s < 0) || (pose.stance === 'drop-knee-R' && s > 0) ? 0.1 : 0
  return { x: pose.x + s * w * Math.cos(yaw), y: pose.y - drop - s * w * Math.sin(yaw) }
}

/**
 * Outside flag: on this leg's own side of the body, and well below the hip
 * so the foot stays under the arms instead of crossing in front of them.
 */
export function flagPoint(pose: Pose, ctx: PlannerContext, limb: FootLimb): Vec2 {
  const s = side(limb)
  const hip = hipPos({ ...pose, stance: 'square' }, ctx, s)
  const out = Math.max(0.16, ctx.dims.hipWidth * 0.85)
  const x = s < 0 ? Math.min(pose.x - out, hip.x - 0.04) : Math.max(pose.x + out, hip.x + 0.04)
  const y = hip.y - 0.62 * ctx.dims.leg
  return { x, y: Math.max(0.05, y) }
}

export function centerOfMass(pose: Pose, ctx: PlannerContext): Vec2 {
  const k = 0.45 * ctx.dims.torso
  const com = { x: pose.x + k * Math.sin(pose.lean), y: pose.y + k * Math.cos(pose.lean) }
  const flagged = flagLimb(pose.stance)
  if (!flagged) return com
  const foot = flagPoint(pose, ctx, flagged)
  return { x: com.x + (foot.x - com.x) * LEG_MASS_FRACTION, y: com.y + (foot.y - com.y) * LEG_MASS_FRACTION * 0.35 }
}

export function contactPoint(contacts: Contacts, limb: Limb, ctx: PlannerContext): Vec2 | null {
  if (isHand(limb)) {
    const ref = parseRef(contacts[limb])
    const h = ref ? ctx.byId.get(ref.id) : undefined
    if (!h) return null
    const spot = handPatch(h, contacts[limb])
    return { x: h.x + (spot?.dx ?? 0), y: h.y + (spot?.dy ?? 0) }
  }
  const f = contacts[limb]
  if (!f) return null
  if (f.kind === 'smear') return { x: f.x, y: f.y }
  const h = ctx.byId.get(f.id)
  if (!h) return null
  const spot = footPatch(h, f.patch)
  return { x: h.x + (spot?.dx ?? 0), y: h.y + (spot?.dy ?? 0) }
}

export function contactDepth(contacts: Contacts, limb: Limb, ctx: PlannerContext): number {
  if (isHand(limb)) {
    const ref = parseRef(contacts[limb])
    const h = ref ? ctx.byId.get(ref.id) : undefined
    if (!h) return 0
    return h.depth + (handPatch(h, contacts[limb])?.dz ?? 0)
  }
  const f = contacts[limb]
  if (!f || f.kind !== 'hold') return 0.02
  const h = ctx.byId.get(f.id)
  if (!h) return 0
  return h.depth + (footPatch(h, f.patch)?.dz ?? 0)
}

export function limbRoot(pose: Pose, ctx: PlannerContext, limb: Limb): Vec2 {
  return isHand(limb) ? shoulderPos(pose, ctx, side(limb)) : hipPos(pose, ctx, side(limb))
}

/** In-plane reach for this stance. Closing the gap to the wall lengthens it. */
export function limbReach(ctx: PlannerContext, limb: Limb, pose?: Pose): number {
  const stance = pose?.stance
  if (isHand(limb)) return Math.sqrt(Math.max(0.04, ctx.dims.arm ** 2 - shoulderGap(stance) ** 2))
  return Math.sqrt(Math.max(0.04, ctx.dims.leg ** 2 - hipGap(stance) ** 2))
}

/** How far a foot may sit above the hip. Default flexibility ≈ 12 cm — a small rock-over, not a knee-to-chest step. */
export function highStepLimit(ctx: PlannerContext): number {
  return 0.04 + 0.16 * ctx.profile.flexibility
}

export interface PoseResult {
  pose: Pose
  feasible: boolean
  stretch: Partial<Record<Limb, number>>
  cost: number
  /** Human-readable reasons when infeasible. */
  violations: string[]
}

function poseCost(pose: Pose, contacts: Contacts, ctx: PlannerContext, pts: Partial<Record<Limb, Vec2>>): number {
  const sinA = Math.sin((Math.max(0, ctx.angleDeg) * Math.PI) / 180)
  let J = 0
  let footX = 0
  let nFeet = 0
  let handX = 0
  let nHands = 0
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
    const p = pts[limb]
    if (!p) continue
    const root = limbRoot(pose, ctx, limb)
    const s = Math.hypot(p.x - root.x, p.y - root.y) / limbReach(ctx, limb, pose)
    if (s > 1) J += 60 + 400 * (s - 1) ** 2
    if (isHand(limb)) {
      nHands++
      handX += p.x
      if (s > 0.93) J += 2 * ((Math.min(s, 1) - 0.93) / 0.07) ** 2
      if (ctx.angleDeg > 10 && s < 0.6) J += (0.6 - s) * 2 * sinA
      const ref = parseRef(contacts[limb])
      const hold = ref ? ctx.byId.get(ref.id) : undefined
      if (hold) {
        const spot = handPatch(hold, contacts[limb])
        const com = centerOfMass(pose, ctx)
        const z = shoulderGap(pose.stance) - contactDepth(contacts, limb, ctx)
        const shoulder = { x: root.x - p.x, y: root.y - p.y }
        const pull = holdNeedsLip(hold.type)
          ? { x: (com.x - p.x) * 0.75 + shoulder.x * 0.25, y: (com.y - p.y) * 0.75 + shoulder.y * 0.25, z }
          : { x: shoulder.x, y: shoulder.y, z }
        J += 1.5 * (1 - gripDirectionFactor(hold, pull, spot))
        if (hold.facingDeg !== null && holdNeedsLip(hold.type)) {
          const align = supportAlignment(hold.facingDeg, { x: com.x - p.x, y: com.y - p.y })
          J += 14 * Math.max(0, 0.8 - align) ** 2
        }
      }
    } else {
      nFeet++
      footX += p.x
      J += 1.2 * (s - 0.72) ** 2
      const hi = p.y - pose.y
      const lim = highStepLimit(ctx)
      if (hi > lim) J += 60 + 400 * (hi - lim) ** 2
      else if (hi > -0.22) J += 1.4 * (hi + 0.22)
      const dropLimb = pose.stance === 'drop-knee-L' ? 'LF' : pose.stance === 'drop-knee-R' ? 'RF' : null
      // Keep this hip beside the high foot. Reach failures still dominate (cost 60+).
      if (dropLimb === limb) J += 400 * (hi - 0.02) ** 2
    }
  }
  if (Math.abs(pose.lean) > MAX_LEAN) J += 60 + 400 * (Math.abs(pose.lean) - MAX_LEAN) ** 2
  J += 1.5 * pose.lean ** 2
  if (pose.y < MIN_PELVIS_Y) J += 60 + 400 * (MIN_PELVIS_Y - pose.y) ** 2
  J += 0.6 * pose.y
  const com = centerOfMass(pose, ctx)
  if (nFeet > 0 && ctx.angleDeg <= 20) J += 1.5 * (com.x - footX / nFeet) ** 2
  if (nHands > 0) J += (0.4 + sinA) * (com.x - handX / nHands) ** 2
  return J
}

function initialPose(ctx: PlannerContext, pts: Partial<Record<Limb, Vec2>>, stance: StanceId): Pose {
  const hands = [pts.LH, pts.RH].filter(Boolean) as Vec2[]
  const feet = [pts.LF, pts.RF].filter(Boolean) as Vec2[]
  const all = [...hands, ...feet]
  const mean = (a: Vec2[], k: 'x' | 'y') => a.reduce((s, p) => s + p[k], 0) / a.length
  const x = mean(all, 'x')
  const fromHands = hands.length ? mean(hands, 'y') - ctx.dims.torso - 0.75 * ctx.handReach : 1
  const fromFeet = feet.length ? mean(feet, 'y') + 0.62 * ctx.footReach : fromHands
  let y = Math.max(MIN_PELVIS_Y, hands.length ? (fromHands + fromFeet) / 2 : fromFeet)
  if (stance === 'drop-knee-L' && pts.LF) y = Math.max(MIN_PELVIS_Y, pts.LF.y)
  if (stance === 'drop-knee-R' && pts.RF) y = Math.max(MIN_PELVIS_Y, pts.RF.y)
  return { x, y, lean: 0, stance }
}

function patternSearch(start: Pose, f: (p: Pose) => number): { pose: Pose; cost: number } {
  let best = start
  let bestCost = f(start)
  let step = 0.16
  let evals = 0
  while (step >= 0.005 && evals < 400) {
    let improved = false
    for (const [dx, dy, dl] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const cand = { x: best.x + dx * step, y: best.y + dy * step, lean: best.lean + dl * step * 1.2, stance: best.stance }
      const c = f(cand)
      evals++
      if (c < bestCost - 1e-9) {
        best = cand
        bestCost = c
        improved = true
      }
    }
    if (!improved) step /= 2
  }
  return { pose: best, cost: bestCost }
}

/** Find a comfortable pelvis position + lean that reaches all contacts. Deterministic. */
export function solvePose(contacts: Contacts, ctx: PlannerContext, stance: StanceId = 'square'): PoseResult {
  const gate = stanceGate(contacts, stance, ctx)
  if (!gate.ok) return { pose: { x: 0, y: MIN_PELVIS_Y, lean: 0, stance }, cost: 80, stretch: {}, feasible: false, violations: [gate.reason] }
  const pts: Partial<Record<Limb, Vec2>> = {}
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
    const p = contactPoint(contacts, limb, ctx)
    if (p) pts[limb] = p
  }
  const f = (p: Pose) => poseCost(p, contacts, ctx, pts)
  const init = initialPose(ctx, pts, stance)
  let best = patternSearch(init, f)
  if (best.cost >= 60) {
    for (const alt of [
      { ...init, x: init.x - 0.25, lean: -0.35, stance },
      { ...init, x: init.x + 0.25, lean: 0.35, stance },
      { ...init, y: init.y + 0.3, stance },
    ]) {
      const r = patternSearch(alt, f)
      if (r.cost < best.cost) best = r
    }
  }
  if (best.cost < 60 && (contacts.LH || contacts.RH)) {
    // One short pass that biases the pelvis toward a comfortable pull direction.
    let pose = best.pose
    let score = evaluateStatics(contacts, pose, ctx).uMax
    for (const step of [0.08, 0.04, 0.02]) {
      let moved = false
      for (const [dx, dy, dl] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const cand = { x: pose.x + dx * step, y: pose.y + dy * step, lean: pose.lean + dl * step, stance: pose.stance }
        if (f(cand) >= 60) continue
        const u = evaluateStatics(contacts, cand, ctx).uMax
        if (u < score - 1e-4) {
          pose = cand
          score = u
          moved = true
        }
      }
      if (!moved) break
    }
    best = { pose, cost: f(pose) }
  }
  return describePose(best.pose, best.cost, ctx, pts)
}

function describePose(pose: Pose, cost: number, ctx: PlannerContext, pts: Partial<Record<Limb, Vec2>>): PoseResult {
  const stretch: Partial<Record<Limb, number>> = {}
  const violations: string[] = []
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
    const p = pts[limb]
    if (!p) continue
    const root = limbRoot(pose, ctx, limb)
    const d = Math.hypot(p.x - root.x, p.y - root.y)
    const R = limbReach(ctx, limb, pose)
    stretch[limb] = d / R
    if (d > R * 1.005) violations.push(`${limb} short by ${Math.round((d - R) * 100)} cm`)
    if (!isHand(limb) && p.y - pose.y > highStepLimit(ctx)) violations.push(`${limb} high-step beyond hip mobility`)
  }
  if (isDropKnee(pose.stance)) {
    const limb: FootLimb = pose.stance === 'drop-knee-L' ? 'LF' : 'RF'
    const p = pts[limb]
    if (!p) violations.push('drop knee needs that foot on a hold')
    else if (p.y < pose.y - 0.08) violations.push('drop-knee needs the foot at hip height')
  }
  if (Math.abs(pose.lean) > MAX_LEAN + 0.01) violations.push('torso lean beyond range')
  if (pose.y < MIN_PELVIS_Y - 0.01) violations.push('body would be on the floor')
  return { pose, cost, stretch, feasible: violations.length === 0, violations }
}

/**
 * Quasi-static load estimate. Weight is split between feet and hands by wall
 * angle and foothold quality; hand load is split by horizontal distance to
 * the center of mass, amplified by any barn-door offset. Each hand's load
 * is compared with its grip capacity on that hold for this pull direction.
 */
export function evaluateStatics(contacts: Contacts, pose: Pose, ctx: PlannerContext, omit?: Limb, swing = 1): Statics {
  const c: Contacts = omit ? { ...contacts, [omit]: null } : contacts
  const com = centerOfMass(pose, ctx)
  const feet: { limb: FootLimb; effectiveness: number }[] = (['LF', 'RF'] as const).map((limb) => ({
    limb,
    effectiveness: footEffectiveness(c[limb], ctx.byId, ctx.profile, ctx.angleDeg),
  }))
  const heel = (['LF', 'RF'] as const).some((limb) => {
    const f = c[limb]
    if (!f || f.kind !== 'hold') return false
    const h = ctx.byId.get(f.id)
    return h ? footPatch(h, f.patch)?.role === 'heel' : false
  })
  let share = handShare(ctx.angleDeg, feet[0].effectiveness, feet[1].effectiveness)
  if (heel) share *= 0.75

  const xs: number[] = []
  const loaded: ContactPatch[] = []
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
    if (!isHand(limb) && feet.find((f) => f.limb === limb)!.effectiveness < 0.05) continue
    const p = contactPoint(c, limb, ctx)
    if (!p) continue
    xs.push(p.x)
    if (isHand(limb)) {
      const ref = parseRef(c[limb])
      const hold = ref ? ctx.byId.get(ref.id) : undefined
      const spot = hold ? handPatch(hold, c[limb]) : undefined
      if (spot) loaded.push(spot)
    } else {
      const f = c[limb]
      if (f?.kind === 'hold') {
        const hold = ctx.byId.get(f.id)
        const spot = hold ? footPatch(hold, f.patch) : undefined
        if (spot) loaded.push(spot)
      } else if (f?.kind === 'smear') {
        loaded.push({ id: 'wall', role: 'smear', dx: 0, dy: 0, dz: 0, nx: 0, ny: 0, nz: 1, coneDeg: 50, widthM: 0.08 })
      }
    }
  }
  const flagged = flagLimb(pose.stance)
  if (flagged && !c[flagged]) {
    const p = flagPoint(pose, ctx, flagged)
    xs.push(p.x)
  }
  const barnDoor = xs.length ? Math.max(0, com.x - Math.max(...xs) - 0.04, Math.min(...xs) - com.x - 0.04) : 0
  const swingSide: -1 | 0 | 1 = !xs.length ? 0 : com.x > Math.max(...xs) + 0.04 ? 1 : com.x < Math.min(...xs) - 0.04 ? -1 : 0
  const flag: FootLimb | null = flagged
  const opposed = swingSide === 0 || loaded.some((p) => patchCanOppose(p, swingSide))
  const amplify = (1 + 2.2 * barnDoor) * swing

  const handIds = (['LH', 'RH'] as const).filter((l) => c[l])
  const hands: HandLoad[] = []
  if (handIds.length > 0) {
    const pos = handIds.map((l) => contactPoint(c, l, ctx)!)
    const matched = handIds.length === 2 && holdIdOf(c.LH) === holdIdOf(c.RH)
    const raw = pos.map((p) => 1 / (Math.abs(p.x - com.x) + 0.12))
    const total = raw.reduce((a, b) => a + b, 0)
    handIds.forEach((limb, i) => {
      const ref = parseRef(c[limb])!
      const hold = ctx.byId.get(ref.id)!
      const spot = handPatch(hold, c[limb])
      const root = shoulderPos(pose, ctx, side(limb))
      const p = pos[i]
      const stretch = Math.hypot(p.x - root.x, p.y - root.y) / limbReach(ctx, limb, pose)
      const w = matched ? 0.5 : raw[i] / total
      const load = share * amplify * w
      const zGap = shoulderGap(pose.stance) - contactDepth(c, limb, ctx)
      const shoulder = { x: root.x - p.x, y: root.y - p.y }
      const pull = holdNeedsLip(hold.type)
        ? { x: (com.x - p.x) * 0.75 + shoulder.x * 0.25, y: (com.y - p.y) * 0.75 + shoulder.y * 0.25, z: zGap }
        : { x: shoulder.x, y: shoulder.y, z: zGap }
      const capacity = handCapacity(hold, ctx.profile, ctx.angleDeg, pull, stretch, spot)
      hands.push({ limb, holdId: hold.id, load, capacity, u: load / capacity })
    })
  }
  const uMax = hands.length ? Math.max(...hands.map((h) => h.u)) : Number.POSITIVE_INFINITY
  return { uMax, hands, handShare: share, barnDoor, flag, feet, opposed }
}
