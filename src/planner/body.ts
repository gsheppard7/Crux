import { footEffectiveness, gripDirectionFactor, handCapacity, handShare } from './grip'
import type { Contacts, FootLimb, HandLimb, HandLoad, Limb, PlannerContext, Pose, Statics } from './types'

export interface Vec2 {
  x: number
  y: number
}

export const side = (limb: Limb): -1 | 1 => (limb === 'LH' || limb === 'LF' ? -1 : 1)
export const isHand = (limb: Limb): limb is HandLimb => limb === 'LH' || limb === 'RH'

export const MAX_LEAN = 0.6
export const MIN_PELVIS_Y = 0.3

export function shoulderCenter(pose: Pose, ctx: PlannerContext): Vec2 {
  return { x: pose.x + ctx.dims.torso * Math.sin(pose.lean), y: pose.y + ctx.dims.torso * Math.cos(pose.lean) }
}

export function shoulderPos(pose: Pose, ctx: PlannerContext, s: -1 | 1): Vec2 {
  const c = shoulderCenter(pose, ctx)
  const h = ctx.dims.shoulderWidth / 2
  return { x: c.x + s * h * Math.cos(pose.lean), y: c.y - s * h * Math.sin(pose.lean) }
}

export function hipPos(pose: Pose, ctx: PlannerContext, s: -1 | 1): Vec2 {
  return { x: pose.x + (s * ctx.dims.hipWidth) / 2, y: pose.y }
}

export function centerOfMass(pose: Pose, ctx: PlannerContext): Vec2 {
  const k = 0.45 * ctx.dims.torso
  return { x: pose.x + k * Math.sin(pose.lean), y: pose.y + k * Math.cos(pose.lean) }
}

export function contactPoint(contacts: Contacts, limb: Limb, ctx: PlannerContext): Vec2 | null {
  if (isHand(limb)) {
    const id = contacts[limb]
    const h = id ? ctx.byId.get(id) : undefined
    return h ? { x: h.x, y: h.y } : null
  }
  const f = contacts[limb]
  if (!f) return null
  if (f.kind === 'smear') return { x: f.x, y: f.y }
  const h = ctx.byId.get(f.id)
  return h ? { x: h.x, y: h.y } : null
}

export function limbRoot(pose: Pose, ctx: PlannerContext, limb: Limb): Vec2 {
  return isHand(limb) ? shoulderPos(pose, ctx, side(limb)) : hipPos(pose, ctx, side(limb))
}

export function limbReach(ctx: PlannerContext, limb: Limb): number {
  return isHand(limb) ? ctx.handReach : ctx.footReach
}

const highStepLimit = (ctx: PlannerContext) => 0.12 + 0.3 * ctx.profile.flexibility

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
    const s = Math.hypot(p.x - root.x, p.y - root.y) / limbReach(ctx, limb)
    if (s > 1) J += 60 + 400 * (s - 1) ** 2
    if (isHand(limb)) {
      nHands++
      handX += p.x
      if (s > 0.93) J += 2 * ((Math.min(s, 1) - 0.93) / 0.07) ** 2
      if (ctx.angleDeg > 10 && s < 0.6) J += (0.6 - s) * 2 * sinA
      const hold = ctx.byId.get(contacts[limb]!)
      if (hold) J += 1.5 * (1 - gripDirectionFactor(hold, { x: root.x - p.x, y: root.y - p.y }))
    } else {
      nFeet++
      footX += p.x
      J += 1.2 * (s - 0.72) ** 2
      const hi = p.y - pose.y
      const lim = highStepLimit(ctx)
      if (hi > lim) J += 60 + 400 * (hi - lim) ** 2
      else if (hi > -0.1) J += 0.6 * (hi + 0.1)
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

function initialPose(ctx: PlannerContext, pts: Partial<Record<Limb, Vec2>>): Pose {
  const hands = [pts.LH, pts.RH].filter(Boolean) as Vec2[]
  const feet = [pts.LF, pts.RF].filter(Boolean) as Vec2[]
  const all = [...hands, ...feet]
  const mean = (a: Vec2[], k: 'x' | 'y') => a.reduce((s, p) => s + p[k], 0) / a.length
  const x = mean(all, 'x')
  const fromHands = hands.length ? mean(hands, 'y') - ctx.dims.torso - 0.75 * ctx.handReach : 1
  const fromFeet = feet.length ? mean(feet, 'y') + 0.62 * ctx.footReach : fromHands
  return { x, y: Math.max(MIN_PELVIS_Y, hands.length ? (fromHands + fromFeet) / 2 : fromFeet), lean: 0 }
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
      const cand = { x: best.x + dx * step, y: best.y + dy * step, lean: best.lean + dl * step * 1.2 }
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
export function solvePose(contacts: Contacts, ctx: PlannerContext): PoseResult {
  const pts: Partial<Record<Limb, Vec2>> = {}
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
    const p = contactPoint(contacts, limb, ctx)
    if (p) pts[limb] = p
  }
  const f = (p: Pose) => poseCost(p, contacts, ctx, pts)
  const init = initialPose(ctx, pts)
  let best = patternSearch(init, f)
  if (best.cost >= 60) {
    for (const alt of [
      { ...init, x: init.x - 0.25, lean: -0.35 },
      { ...init, x: init.x + 0.25, lean: 0.35 },
      { ...init, y: init.y + 0.3 },
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
        const cand = { x: pose.x + dx * step, y: pose.y + dy * step, lean: pose.lean + dl * step }
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
    const R = limbReach(ctx, limb)
    stretch[limb] = d / R
    if (d > R * 1.005) violations.push(`${limb} short by ${Math.round((d - R) * 100)} cm`)
    if (!isHand(limb) && p.y - pose.y > highStepLimit(ctx)) violations.push(`${limb} high-step beyond hip mobility`)
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
  const share = handShare(ctx.angleDeg, feet[0].effectiveness, feet[1].effectiveness)

  const xs: number[] = []
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
    if (!isHand(limb) && feet.find((f) => f.limb === limb)!.effectiveness < 0.05) continue
    const p = contactPoint(c, limb, ctx)
    if (p) xs.push(p.x)
  }
  let barnDoor = xs.length ? Math.max(0, com.x - Math.max(...xs) - 0.04, Math.min(...xs) - com.x - 0.04) : 0
  const freeFoot = (['LF', 'RF'] as const).find((l) => !c[l])
  const otherFootOn = freeFoot ? !!c[freeFoot === 'LF' ? 'RF' : 'LF'] : false
  let flag: FootLimb | null = null
  if (freeFoot && otherFootOn) {
    flag = freeFoot
    if (barnDoor > 0) barnDoor = Math.max(0, barnDoor - (0.12 + 0.1 * ctx.profile.flexibility))
  }
  const amplify = (1 + 2.2 * barnDoor) * swing

  const handIds = (['LH', 'RH'] as const).filter((l) => c[l])
  const hands: HandLoad[] = []
  if (handIds.length > 0) {
    const pos = handIds.map((l) => contactPoint(c, l, ctx)!)
    const matched = handIds.length === 2 && c.LH === c.RH
    const raw = pos.map((p) => 1 / (Math.abs(p.x - com.x) + 0.12))
    const total = raw.reduce((a, b) => a + b, 0)
    handIds.forEach((limb, i) => {
      const hold = ctx.byId.get(c[limb]!)!
      const root = shoulderPos(pose, ctx, side(limb))
      const p = pos[i]
      const stretch = Math.hypot(p.x - root.x, p.y - root.y) / ctx.handReach
      const w = matched ? 0.5 : raw[i] / total
      const load = share * amplify * w
      const capacity = handCapacity(hold, ctx.profile, ctx.angleDeg, { x: root.x - p.x, y: root.y - p.y }, stretch)
      hands.push({ limb, holdId: hold.id, load, capacity, u: load / capacity })
    })
  }
  const uMax = hands.length ? Math.max(...hands.map((h) => h.u)) : Number.POSITIVE_INFINITY
  return { uMax, hands, handShare: share, barnDoor, flag, feet }
}
