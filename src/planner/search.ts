import type { Route } from '../model/schema'
import { dynamicGain, type ClimberProfile } from '../climber/profile'
import { buildContext } from './context'
import { centerOfMass, contactPoint, evaluateStatics, hipPos, isHand, limbReach, shoulderPos, side, solvePose, stanceGate, type PoseResult } from './body'
import { smearEffectiveness } from './grip'
import { describeMove, effortLabel, holdName, stanceLabel } from './explain'
import { handPatch, handTarget, holdIdOf, primaryPatch } from './patches'
import { skeletonFromPose } from '../avatar/skeleton'
import type { Beta, BetaStep, Contacts, FootContact, FootLimb, Limb, MoveKind, PlannerContext, PlannerHold, PlanResult, Pose, StanceId, Statics } from './types'

function lookup(ctx: PlannerContext, ref: string | null | undefined): PlannerHold | undefined {
  const id = holdIdOf(ref)
  return id ? ctx.byId.get(id) : undefined
}

function handSpots(h: PlannerHold): string[] {
  const hands = h.patches.filter((p) => p.role === 'hand')
  if (hands.length <= 1) return [h.id]
  return hands.map((p) => handTarget(h, p.id))
}

/** Soft preferences on top of the move cost. Straight arms are not a universal rule. */
export function tacticCost(
  pose: Pose,
  stretch: Partial<Record<Limb, number>>,
  statics: Statics,
  ctx: PlannerContext,
  dynamic: boolean,
  hold: PlannerHold | undefined,
): number {
  let cost = 0
  const stance = pose.stance ?? 'square'
  if (stance.startsWith('hip-in')) cost += ctx.angleDeg > 15 ? 0.05 : 0.3
  if (stance.startsWith('drop-knee')) cost += 0.4 * (1.2 - ctx.profile.flexibility)
  if (stance.startsWith('flag')) cost += 0.45
  const feetGood = statics.feet.some((f) => f.effectiveness >= 0.55)
  const positive =
    !!hold &&
    ((hold.patches.find((p) => p.role === 'hand')?.ny ?? 0) > 0.2 || hold.type === 'jug' || hold.type === 'edge' || hold.type === 'volume')
  if (feetGood && positive && !dynamic) {
    for (const limb of ['LH', 'RH'] as const) {
      const s = stretch[limb]
      if (s !== undefined && s < 0.72) cost += (0.72 - s) * (ctx.angleDeg > 10 ? 1.6 : 0.35)
    }
  }
  if (hold && (hold.confidence < 0.6 || hold.type === 'unknown')) cost += 0.35
  return cost
}

/** Press down on a wide upward hold, then the foot can take the spot. */
export function isMantle(hold: PlannerHold, toShoulderY: number): boolean {
  const spot = primaryPatch(hold, 'hand')
  if (!spot) return false
  return toShoulderY > 0.05 && spot.ny > 0.45 && spot.widthM >= 0.08 && (hold.type === 'jug' || hold.type === 'volume' || hold.type === 'edge')
}

export interface PlanOptions {
  beamWidth?: number
  /** Beam slots per hand configuration, so foot shuffles don't crowd out alternatives. */
  perHandPair?: number
  maxDepth?: number
  maxBetas?: number
  timeBudgetMs?: number
}

/**
 * Utilization allowed while a limb is moving. Capacity is a ~5 s sustainable
 * grip; a ~1 s move can briefly draw ~20% more.
 */
const MOVE_LIMIT = 1.2
/** A deadpoint must be caught with margin. */
const CATCH_LIMIT = 0.92

interface Move {
  kind: MoveKind
  limb: Limb
  uMid: number
  dynamic: boolean
}

interface Node {
  key: string
  contacts: Contacts
  pose: Pose
  stretch: Partial<Record<Limb, number>>
  statics: Statics
  g: number
  h: number
  depth: number
  parent: Node | null
  move: Move | null
}

/** At least one foot on a hold (a volume counts). The other may smear or flag; both on the wall is illegal. */
function feetLegal(c: Contacts): boolean {
  const onHold = (f: FootContact) => f?.kind === 'hold'
  return onHold(c.LF) || onHold(c.RF)
}

/** A hold meant for feet: a foot chip, or anything hands are not allowed on. */
function dedicatedFoot(h: { type: string; hand: boolean }): boolean {
  return h.type === 'foot-chip' || !h.hand
}

function footX(f: FootContact, byId: Map<string, { x: number }>): number | null {
  if (!f) return null
  if (f.kind === 'smear') return f.x
  return byId.get(f.id)?.x ?? null
}

/** Left foot should stay left of the right foot. */
function feetCrossed(c: Contacts, byId: Map<string, { x: number }>): boolean {
  const lx = footX(c.LF, byId)
  const rx = footX(c.RF, byId)
  return lx != null && rx != null && lx > rx + 0.05
}

const footKey = (f: FootContact) => (!f ? '-' : f.kind === 'hold' ? `h:${f.id}${f.patch ? `@${f.patch}` : ''}` : `s:${f.x.toFixed(2)},${f.y.toFixed(2)}`)
export const contactsKey = (c: Contacts) => `${c.LH}|${c.RH}|${footKey(c.LF)}|${footKey(c.RF)}`
const q = (v: number) => Math.round(v / 0.05) * 0.05

export class Planner {
  private poseCache = new Map<string, PoseResult>()
  expanded = 0
  private readonly gain: number
  readonly finishTop: number

  constructor(
    readonly ctx: PlannerContext,
    readonly opts: Required<PlanOptions>,
  ) {
    this.gain = dynamicGain(ctx.profile)
    this.finishTop = Math.max(...ctx.finishIds.map((id) => lookup(ctx, id)!.y))
  }

  pose(c: Contacts, stance: StanceId = 'square'): PoseResult {
    const key = `${contactsKey(c)}|${stance}`
    let r = this.poseCache.get(key)
    if (!r) {
      r = solvePose(c, this.ctx, stance)
      this.poseCache.set(key, r)
    }
    return r
  }

  isGoal(c: Contacts): boolean {
    const F = this.ctx.finishIds
    const lh = holdIdOf(c.LH)
    const rh = holdIdOf(c.RH)
    if (!lh || !rh) return false
    if (F.length === 1) {
      const f = lookup(this.ctx, F[0])!
      return f.matchable ? lh === F[0] && rh === F[0] : lh === F[0] || rh === F[0]
    }
    return F.includes(lh) && F.includes(rh)
  }

  heuristic(c: Contacts): number {
    const { handReach } = this.ctx
    const finishIds = this.ctx.finishIds
    const finishes = finishIds.map((id) => lookup(this.ctx, id)!)
    const toFinish = (id: string | null) => {
      const h = id ? lookup(this.ctx, id) : undefined
      if (!h) return 2 * handReach
      return Math.min(...finishes.map((f) => Math.hypot(f.x - h.x, f.y - h.y)))
    }
    const near = Math.min(toFinish(c.LH), toFinish(c.RH))
    const far = Math.max(toFinish(c.LH), toFinish(c.RH))
    const onFinish = [c.LH, c.RH].filter((id) => {
      const hid = holdIdOf(id)
      return hid && finishIds.includes(hid)
    }).length
    // Feet left far below the hands will have to come up before the next big move.
    const topHand = Math.max(...[c.LH, c.RH].map((id) => (id ? lookup(this.ctx, id)!.y : 0)))
    const footYs = [c.LF, c.RF].map((f) => (!f ? null : f.kind === 'smear' ? f.y : lookup(this.ctx, f.id)?.y ?? null)).filter((y): y is number => y !== null)
    const bestFoot = footYs.length ? Math.max(...footYs) : 0
    const footLag = Math.max(0, topHand - bestFoot - (this.ctx.footReach + 0.25))
    const offHold = [c.LF, c.RF].filter((f) => f?.kind !== 'hold').length
    return (1.3 * (0.6 * near + 0.4 * far)) / (0.55 * handReach) + (2 - onFinish) * 0.8 + (1.8 * footLag) / handReach + offHold * 1.5
  }

  /** Hip height implied by the current hands, so a low foot doesn't drag the step cap down. */
  naturalHipY(c: Contacts): number {
    const ys = [c.LH, c.RH].map((id) => (id ? lookup(this.ctx, id)!.y : null)).filter((y): y is number => y !== null)
    const lowHand = ys.length ? Math.min(...ys) : 1
    return lowHand - 0.75 * this.ctx.dims.torso
  }

  /**
   * Highest a foot may be placed. The extra above the hip is what a drop knee
   * needs; square poses still reject a foot the hip cannot sit beside.
   */
  footYMax(c: Contacts): number {
    const topHand = Math.max(...[c.LH, c.RH].map((id) => (id ? lookup(this.ctx, id)!.y : 0)))
    const extra = 0.08 + 0.24 * this.ctx.profile.flexibility
    return Math.min(this.naturalHipY(c) + extra, topHand - 0.18)
  }

  /**
   * Points on the wall for one foot. `ignoreId` is a hold the other foot already
   * owns; standing next to it is fine, stacking on it is not.
   */
  wallSmears(pose: Pose, limb: 'LF' | 'RF', yMax: number, ignoreId: string | null): FootContact[] {
    if (smearEffectiveness(this.ctx.angleDeg) <= 0) return []
    const s = side(limb)
    const out: FootContact[] = []
    // Use the hip the hands imply when the current pose has collapsed (no feet yet).
    const baseY = Math.min(yMax, Math.max(pose.y, yMax - 0.05))
    for (const [dx, drop] of [
      [0.16, 0.4],
      [0.28, 0.62],
    ] as const) {
      const x = q(pose.x + s * dx)
      const y = q(Math.max(0.12, baseY - drop))
      if (y >= yMax || x < 0.05 || x > this.ctx.frame.widthM - 0.05) continue
      if (this.ctx.footHolds.some((h) => h.id !== ignoreId && Math.hypot(h.x - x, h.y - y) < 0.28)) continue
      out.push({ kind: 'smear', x, y })
    }
    return out
  }

  /**
   * Wall smears only when this foot has no hold of its own.
   * The hold the other foot is on does not count.
   */
  smearOptions(pose: Pose, limb: 'LF' | 'RF', contacts: Contacts): FootContact[] {
    const other = contacts[limb === 'LF' ? 'RF' : 'LF']
    const taken = other?.kind === 'hold' ? other.id : null
    const hip = hipPos(pose, this.ctx, side(limb))
    const yMax = this.footYMax(contacts)
    const nearby = this.ctx.footHolds.some(
      (h) => h.id !== taken && h.y <= yMax + 0.02 && h.y >= 0.03 && Math.hypot(h.x - hip.x, h.y - hip.y) <= this.ctx.footReach + 0.35,
    )
    if (nearby) return []
    return this.wallSmears(pose, limb, yMax, taken)
  }

  candidates(node: Node, limb: Limb): (string | FootContact)[] {
    const { ctx } = this
    const c = node.contacts
    if (isHand(limb)) {
      const other = c[limb === 'LH' ? 'RH' : 'LH']
      const otherLimb = limb === 'LH' ? 'RH' : 'LH'
      const root = shoulderPos(node.pose, ctx, side(limb))
      const minY = Math.min(...[c.LH, c.RH].map((id) => (id ? lookup(ctx, id)!.y : 0)))
      const myX = c[limb] ? lookup(ctx, c[limb]!)!.x : null
      const otherX = other ? lookup(ctx, other)!.x : null
      const crosses = (x: number) => (otherX == null ? false : limb === 'LH' ? x > otherX + 0.05 : x < otherX - 0.05)
      const pool = ctx.handHolds
        .filter((h) => h.id !== holdIdOf(c[limb]) || h.patches.filter((p) => p.role === 'hand').length > 1)
        .filter((h) => Math.hypot(h.x - root.x, h.y - root.y) <= ctx.handReach + this.gain + 0.6)
        .filter((h) => h.y >= minY - 0.45)
      const straight = pool.filter((h) => h.id !== holdIdOf(other) && !crosses(h.x))
      const crossing = pool.filter((h) => h.id !== holdIdOf(other) && crosses(h.x))
      const otherRoot = shoulderPos(node.pose, ctx, side(otherLimb))
      const otherCanTake = (h: PlannerHold) => {
        if (myX == null) return false
        const otherWouldCross = otherLimb === 'LH' ? h.x > myX + 0.05 : h.x < myX - 0.05
        if (otherWouldCross) return false
        return Math.hypot(h.x - otherRoot.x, h.y - otherRoot.y) <= ctx.handReach + this.gain + 0.35
      }
      const otherHold = other ? lookup(ctx, other) : undefined
      const canMatch =
        !!other && !!otherHold?.matchable && Math.hypot(otherHold.x - root.x, otherHold.y - root.y) <= ctx.handReach + this.gain + 0.2
      const bestStraightY = straight.reduce((m, h) => Math.max(m, h.y), Number.NEGATIVE_INFINITY)
      const crossIsTheWayUp = crossing.filter((h) => h.y > bestStraightY + 0.12)
      const myY = c[limb] ? lookup(ctx, c[limb]!)!.y : 0
      const upwardStraight = straight.filter((h) => h.y > myY + 0.08)
      const near = pool
        .filter((h) => h.id !== holdIdOf(other) || h.matchable || ctx.finishIds.includes(h.id))
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .slice(0, 9)
        .flatMap((h) => handSpots(h))
        .filter((ref) => ref !== c[limb])
      // Nothing higher on this side: match, then the other hand takes the hold that would have been a cross.
      if (other && canMatch && upwardStraight.length === 0 && crossIsTheWayUp.some(otherCanTake)) near.unshift(other)
      for (const id of ctx.finishIds) {
        if (id === c[limb] || near.includes(id)) continue
        const h = lookup(ctx, id)!
        if (!h.matchable && id === other) continue
        near.push(id)
      }
      return near
    }
    const cur = c[limb]
    const curId = cur && cur.kind === 'hold' ? cur.id : null
    const otherFootLimb = limb === 'LF' ? 'RF' : 'LF'
    const otherFoot = c[otherFootLimb]
    const otherFootId = otherFoot?.kind === 'hold' ? otherFoot.id : null
    const otherFootX = footX(otherFoot, ctx.byId)
    const crossesFoot = (x: number) => (otherFootX == null ? false : limb === 'LF' ? x > otherFootX + 0.05 : x < otherFootX - 0.05)
    const hip = hipPos(node.pose, ctx, side(limb))
    const maxHandY = Math.max(...[c.LH, c.RH].map((id) => (id ? lookup(ctx, id)!.y : 0)))
    // Prefer feet that close the gap under the hands when they lag behind.
    const bestFootNow = Math.max(
      ...(['LF', 'RF'] as const).map((l) => {
        const f = c[l]
        if (!f) return 0
        return f.kind === 'smear' ? f.y : (lookup(ctx, f.id)?.y ?? 0)
      }),
    )
    const needUp = maxHandY - bestFootNow > ctx.footReach + 0.25
    const yMax = this.footYMax(c)
    const hipLine = this.naturalHipY(c)
    const idealY = needUp ? Math.min(yMax, hipLine - 0.05) : hipLine - 0.4 * ctx.dims.leg
    const reachable = ctx.footHolds
      .filter((h) => h.id !== curId && h.id !== otherFootId)
      .filter((h) => h.y >= 0.03 && h.y <= yMax)
      .filter((h) => Math.hypot(h.x - hip.x, h.y - hip.y) <= ctx.footReach + 0.8)
    const sameSide = reachable.filter((h) => !crossesFoot(h.x))
    const crossingFeet = reachable.filter((h) => crossesFoot(h.x))
    const uncrossed = sameSide.length > 0 ? sameSide : reachable
    const chips = uncrossed.filter(dedicatedFoot)
    const open = chips.length
      ? uncrossed.filter((h) => dedicatedFoot(h) || !chips.some((chip) => Math.hypot(chip.x - h.x, chip.y - h.y) < 0.4))
      : uncrossed
    const ranked = open.sort((a, b) => {
      const score = (h: PlannerHold) => Math.abs(h.y - idealY) + 0.5 * Math.abs(h.x - hip.x) + (dedicatedFoot(h) ? -0.25 : 0)
      return score(a) - score(b) || a.id.localeCompare(b.id)
    })
    const crossRanked = crossingFeet.sort((a, b) => Math.abs(a.y - idealY) - Math.abs(b.y - idealY) || a.id.localeCompare(b.id))
    const asFoot = (h: PlannerHold): FootContact[] => {
      if (h.type !== 'volume') return [{ kind: 'hold', id: h.id }]
      const high = h.y >= hipLine - 0.08
      const spots = h.patches.filter((p) => p.role === 'foot-edge' || p.role === 'smear' || (high && (p.role === 'heel' || p.role === 'toe')))
      if (spots.length <= 1) return [{ kind: 'hold', id: h.id }]
      const primary = spots.find((p) => p.role === 'foot-edge') ?? spots[0]
      return spots.map((p) => ({ kind: 'hold' as const, id: h.id, patch: p.id === primary.id ? undefined : p.id }))
    }
    const holds: FootContact[] = [...ranked.slice(0, 6), ...(sameSide.length > 0 ? crossRanked.slice(0, 2) : [])].flatMap(asFoot)
    const smears = this.smearOptions(node.pose, limb as 'LF' | 'RF', c).filter(
      (s): s is { kind: 'smear'; x: number; y: number } => !!s && s.kind === 'smear' && (sameSide.length === 0 || !crossesFoot(s.x)),
    )
    const out = [...holds, ...smears]
    // Flag only when there is no hold and no wall smear (steep terrain). A smear beats sharing one hold.
    if (cur && holds.length === 0 && smears.length === 0) out.push(null)
    return out
  }

  /**
   * A hand move the body can actually make. The moving hand may deadpoint
   * out to dynamic reach; the other hand stays within a small shrug.
   */
  handSlackOk(pr: PoseResult, moving: 'LH' | 'RH'): { ok: boolean; dynamic: boolean } {
    const other = moving === 'LH' ? 'RH' : 'LH'
    for (const v of pr.violations) {
      const foot = v.startsWith('LF') || v.startsWith('RF')
      const movingShort = v.startsWith(moving) && v.includes('short')
      const otherShort = v.startsWith(other) && v.includes('short')
      if (foot || movingShort || otherShort) continue
      return { ok: false, dynamic: false }
    }
    const extra = (hand: 'LH' | 'RH') => Math.max(0, (pr.stretch[hand] ?? 0) - 1) * limbReach(this.ctx, hand, pr.pose)
    if (extra(other) > 0.05) return { ok: false, dynamic: false }
    const movingExtra = extra(moving)
    if (movingExtra > this.gain + 0.02) return { ok: false, dynamic: false }
    const feetOver = (['LF', 'RF'] as const).some((f) => (pr.stretch[f] ?? 0) > 1.02 || pr.violations.some((v) => v.startsWith(f)))
    if (feetOver) return { ok: false, dynamic: false }
    return { ok: true, dynamic: movingExtra > 0.02 }
  }

  /**
   * When a planted foot blocks the next hold, drop that foot and smear it
   * back on from the new hip. A shortfall inside dynamic reach becomes a deadpoint.
   */
  rescueHand(
    moving: 'LH' | 'RH',
    from: Pose,
    contacts: Contacts,
    pr: PoseResult,
  ): { contacts: Contacts; pose: PoseResult; dynamic: boolean } | null {
    const holdId = contacts[moving]
    const hold = holdId ? lookup(this.ctx, holdId) : undefined
    if (!hold) return null
    const root = shoulderPos(from, this.ctx, side(moving))
    const dist = Math.hypot(hold.x - root.x, hold.y - root.y)
    // Only the band a deadpoint can still make from the body we already have.
    if (dist > this.ctx.handReach + this.gain) return null
    const footReach = this.ctx.footReach
    const footBlocking = (f: 'LF' | 'RF') => {
      const over = Math.max(0, (pr.stretch[f] ?? 0) - 1) * footReach
      return over >= 0.08 || pr.violations.some((v) => v.startsWith(f) && v.includes('high-step'))
    }
    const blocked = (['LF', 'RF'] as const).filter(footBlocking)
    const movingExtra = Math.max(0, (pr.stretch[moving] ?? 0) - 1) * this.ctx.handReach
    if (blocked.length === 0 && movingExtra <= 0.02) return null
    let next = contacts
    let pose = pr
    if (blocked.length > 0) {
      for (const f of blocked) next = { ...next, [f]: null }
      pose = this.pose(next, pr.pose.stance)
      if (!this.handSlackOk(pose, moving).ok) return null
      for (const f of blocked) {
        const other = next[f === 'LF' ? 'RF' : 'LF']
        const ignore = other?.kind === 'hold' ? other.id : null
        for (const smear of this.wallSmears(pose.pose, f, this.footYMax(next), ignore)) {
          const trial: Contacts = { ...next, [f]: smear }
          const posed = this.pose(trial, pr.pose.stance)
          if (!this.handSlackOk(posed, moving).ok) continue
          next = trial
          pose = posed
          break
        }
      }
    }
    const slack = this.handSlackOk(pose, moving)
    if (!slack.ok) return null
    if (pose.feasible && blocked.length === 0) return null
    // A hand move may free a foot only when that foot lands again. Cutting loose is its own move.
    if (blocked.some((f) => !next[f])) return null
    return { contacts: next, pose, dynamic: slack.dynamic }
  }

  /** True when matching frees the other hand to take a hold this hand would have to cross for. */
  opensACross(node: Node, limb: 'LH' | 'RH'): boolean {
    const { ctx } = this
    const other = node.contacts[limb === 'LH' ? 'RH' : 'LH']
    const otherX = other ? lookup(ctx, other)?.x : null
    const my = node.contacts[limb] ? lookup(ctx, node.contacts[limb]!) : undefined
    if (otherX == null || !my) return false
    const myY = my.y
    return ctx.handHolds.some((h) => {
      if (h.id === holdIdOf(other) || h.id === my.id || h.y < myY + 0.12) return false
      const crosses = limb === 'LH' ? h.x > otherX + 0.05 : h.x < otherX - 0.05
      return crosses
    })
  }

  private hipFor(limb: Limb): StanceId {
    if (limb === 'RH' || limb === 'LF') return 'hip-in-L'
    return 'hip-in-R'
  }

  private dropFor(limb: Limb): StanceId {
    return this.hipFor(limb) === 'hip-in-L' ? 'drop-knee-L' : 'drop-knee-R'
  }

  private lateralHold(hold: PlannerHold | undefined): boolean {
    if (!hold) return false
    if (hold.type === 'sidepull' || hold.type === 'undercling') return true
    if (hold.facingDeg === null) return false
    const f = hold.facingDeg
    return (f >= 45 && f < 135) || (f > 225 && f <= 315)
  }

  private footHigh(contacts: Contacts): boolean {
    const hip = this.naturalHipY(contacts)
    return (['LF', 'RF'] as const).some((limb) => {
      const foot = contacts[limb]
      return foot?.kind === 'hold' && (lookup(this.ctx, foot.id)?.y ?? 0) >= hip - 0.05
    })
  }

  /** Flag the free foot toward the side the body is swinging. */
  private flagFor(contacts: Contacts, pose: Pose): StanceId | null {
    const leftOn = !!contacts.LF
    const rightOn = !!contacts.RF
    if (leftOn === rightOn) return null
    const com = centerOfMass(pose, this.ctx)
    const xs: number[] = []
    for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
      const p = contactPoint(contacts, limb, this.ctx)
      if (p) xs.push(p.x)
    }
    if (xs.length === 0) return null
    const sign = com.x > Math.max(...xs) + 0.04 ? 1 : com.x < Math.min(...xs) - 0.04 ? -1 : 0
    if (sign > 0 && !rightOn && leftOn) return 'flag-outside-R'
    if (sign < 0 && !leftOn && rightOn) return 'flag-outside-L'
    return null
  }

  private stanceList(node: Node, limb: Limb, contacts: Contacts): StanceId[] {
    const out: StanceId[] = ['square']
    const hold = isHand(limb) ? lookup(this.ctx, contacts[limb] as string) : undefined
    if (this.ctx.angleDeg > 15 || this.lateralHold(hold)) out.push(this.hipFor(limb))
    if (this.footHigh(contacts)) out.push(this.dropFor(limb))
    const flag = this.flagFor(contacts, node.pose)
    if (flag && !out.includes(flag)) out.push(flag)
    return out
  }

  /**
   * A deadpoint is a launch pose plus a catch, used only after every static
   * stance fails the release check. The catch may stretch by `dynamicGain`.
   */
  private tryDeadpoint(node: Node, limb: 'LH' | 'RH', contacts: Contacts, penalty: Map<string, number>): Node | null {
    if (this.gain <= 0) return null
    const launchStance: StanceId = limb === 'RH' ? 'hip-in-L' : 'hip-in-R'
    let launch = this.pose(node.contacts, launchStance)
    if (!launch.feasible) launch = this.pose(node.contacts, 'square')
    if (!launch.feasible) {
      launch = { pose: node.pose, feasible: true, stretch: node.stretch, cost: 0, violations: [] }
    }
    const launchU = evaluateStatics(node.contacts, launch.pose, this.ctx, limb).uMax
    if (launchU > 1 + 0.25 * this.ctx.profile.power) return null
    for (const stance of ['square', launchStance] as const) {
      const pr = this.pose(contacts, stance)
      // The catch may sit up to dynamicGain past the arrived shoulder. The launch
      // pose is the body that lets go; its utilization is checked above.
      if (!this.handSlackOk(pr, limb).ok) continue
      const after = evaluateStatics(contacts, pr.pose, this.ctx)
      if (after.uMax > CATCH_LIMIT || (after.barnDoor > 0.08 && !after.opposed)) continue
      return this.price(node, limb, contacts, pr, after, launchU, true, penalty)
    }
    return null
  }

  private price(
    node: Node,
    limb: Limb,
    contacts: Contacts,
    pr: PoseResult,
    after: Statics,
    uMid: number,
    dynamic: boolean,
    penalty: Map<string, number>,
  ): Node {
    const { ctx } = this
    const prevHands = [holdIdOf(node.contacts.LH), holdIdOf(node.contacts.RH)]
    let kind: MoveKind
    let cost: number
    const feetChanged = (['LF', 'RF'] as const).filter((f) => footKey(contacts[f]) !== footKey(node.contacts[f])).length
    if (isHand(limb)) {
      const hold = lookup(ctx, contacts[limb])!
      const other = holdIdOf(contacts[limb === 'LH' ? 'RH' : 'LH'])
      const lx = lookup(ctx, contacts.LH!)!.x
      const rx = lookup(ctx, contacts.RH!)!.x
      const crossed = lx > rx + 0.08
      const prevY = lookup(ctx, node.contacts[limb])?.y ?? 0
      const targetId = hold.id
      const spot = handPatch(hold, contacts[limb])
      const root = shoulderPos(pr.pose, ctx, side(limb))
      const at = contactPoint(contacts, limb, ctx)!
      kind = dynamic ? 'dyno' : other === targetId ? 'match' : crossed ? 'cross' : isMantle(hold, root.y - at.y) ? 'mantle' : 'reach'
      if (kind === 'mantle' && spot && spot.ny <= 0.45) kind = 'reach'
      cost = 1.0
      if (crossed) {
        const stayed = lookup(ctx, node.contacts[limb] ?? '')
        cost += stayed?.matchable ? 3.6 : 1.2
      }
      if (kind === 'match' && !ctx.finishIds.includes(hold.id)) cost += this.opensACross(node, limb) ? 0.2 : 1.5
      if (hold.y < prevY - 0.1) cost += 0.8
      if (dynamic) cost += 2 + 1.5 * (1 - ctx.profile.power) + (ctx.profile.style === 'dynamic' ? -0.8 : 0)
      if (feetChanged > 0) cost += 2.8
      cost += penalty.get(`${limb}:${hold.id}:${pr.pose.stance}`) ?? 0
      if (prevHands.includes(hold.id) && kind !== 'match') cost += 0.5
      cost += tacticCost(pr.pose, pr.stretch, after, ctx, dynamic, hold)
    } else if (feetChanged === 2) {
      kind = 'foot'
      cost = 0.7
    } else {
      const f = contacts[limb as FootLimb]
      const otherFoot = contacts[limb === 'LF' ? 'RF' : 'LF']
      cost = 0.55
      if (!f) {
        kind = otherFoot ? 'flag' : 'cut'
        cost += otherFoot ? 2.4 : 3
      } else if (f.kind === 'smear') {
        kind = 'smear'
        cost += 2.6
      } else {
        const fy = lookup(ctx, f.id)!.y
        kind = fy > pr.pose.y - 0.02 ? 'high-step' : 'foot'
        if (kind === 'high-step') cost += 0.9 * (1.2 - ctx.profile.flexibility)
        const h = lookup(ctx, f.id)!
        if (!dedicatedFoot(h) && ctx.footHolds.some((o) => o.id !== h.id && dedicatedFoot(o) && Math.hypot(o.x - h.x, o.y - h.y) < 0.4)) cost += 1.6
      }
    }
    if (!isHand(limb)) {
      const lp = contactPoint(contacts, 'LF', ctx)
      const rp = contactPoint(contacts, 'RF', ctx)
      const twisting = pr.pose.stance.startsWith('hip-in') || pr.pose.stance.startsWith('drop-knee')
      if (lp && rp && lp.x > rp.x + 0.05 && !twisting) cost += 1.8
    }
    const maxStretch = Math.max(0, ...Object.values(pr.stretch).map((s) => s ?? 0))
    if (maxStretch > 0.97) cost += (maxStretch - 0.97) / 0.03
    const offHold = [contacts.LF, contacts.RF].filter((f) => f?.kind !== 'hold').length
    cost += offHold * 0.85
    cost += 1.6 * after.uMax ** 2 + 1.2 * uMid ** 2
    return {
      key: contactsKey(contacts),
      contacts,
      pose: pr.pose,
      stretch: pr.stretch,
      statics: after,
      g: node.g + cost,
      h: this.heuristic(contacts),
      depth: node.depth + 1,
      parent: node,
      move: { kind, limb, uMid, dynamic },
    }
  }

  /** Evaluate moving one limb; returns the child node or a failure reason. */
  tryMove(node: Node, limb: Limb, target: string | FootContact, penalty: Map<string, number>, preset?: Contacts): Node | string {
    const { ctx } = this
    const contacts = preset ?? ({ ...node.contacts, [limb]: target } as Contacts)
    if (contactsKey(contacts) === node.key) return 'no change'
    if (!isHand(limb) && !preset && target && typeof target === 'object' && target.kind === 'hold') {
      const other = contacts[limb === 'LF' ? 'RF' : 'LF']
      if (other?.kind === 'hold' && other.id === target.id && (other.patch ?? '') === (target.patch ?? '')) return 'both feet on one hold'
    }
    if (!isHand(limb) && !feetLegal(contacts)) return 'at least one foot has to stay on a hold'

    const stances = this.stanceList(node, limb, contacts)
    let best: Node | null = null
    let bestFail = 'out of reach'
    const cutting = !isHand(limb) && contacts[limb] === null && !node.contacts[limb === 'LF' ? 'RF' : 'LF']
    for (let i = 0; i < stances.length; i++) {
      const stance = stances[i]
      const gate = stanceGate(contacts, stance, ctx)
      if (!gate.ok) {
        bestFail = gate.reason
        continue
      }
      let placed = contacts
      let pr = this.pose(placed, stance)
      if (!pr.feasible && isHand(limb)) {
        const rescued = this.rescueHand(limb, node.pose, placed, pr)
        if (rescued && rescued.pose.feasible && !rescued.dynamic) {
          placed = rescued.contacts
          pr = rescued.pose
        }
      }
      const stretched = Math.max(0, ...Object.values(pr.stretch).map((s) => s ?? 0))
      if (stance === 'square' && (stretched >= 0.9 || !pr.feasible)) {
        const hip = this.hipFor(limb)
        if (!stances.includes(hip)) stances.push(hip)
      }
      if (!pr.feasible) {
        bestFail = `out of reach (${pr.violations.join(', ') || 'no pose'})`
        continue
      }
      const after = evaluateStatics(placed, pr.pose, ctx)
      if (after.barnDoor > 0.08 && !after.opposed) {
        bestFail = 'barn door: no hold opposes the swing'
        continue
      }
      if (after.uMax > 1) {
        bestFail = `too hard to hold (${Math.round(after.uMax * 100)}% of grip capacity)`
        continue
      }
      const uMid = evaluateStatics(placed, pr.pose, ctx, limb, cutting ? 1.25 : 1).uMax
      if (uMid > MOVE_LIMIT) {
        bestFail = `can't let go to move (${Math.round(uMid * 100)}% on the remaining holds)`
        continue
      }
      const child = this.price(node, limb, placed, pr, after, uMid, false, penalty)
      const lateral = isHand(limb) && this.lateralHold(lookup(ctx, placed[limb] as string))
      if (stance === 'square' && after.uMax < 0.75 && stretched < 0.9 && ctx.angleDeg <= 15 && !lateral) return child
      if (!best || child.g < best.g) best = child
    }
    if (best && isHand(limb) && this.gain > 0) {
      const stretched = Math.max(0, ...Object.values(best.stretch).map((s) => s ?? 0))
      if (stretched >= 0.93) {
        const dyn = this.tryDeadpoint(node, limb, contacts, penalty)
        if (dyn && dyn.g < best.g) return dyn
      }
    }
    if (best) return best
    if (isHand(limb)) {
      const dyn = this.tryDeadpoint(node, limb, contacts, penalty)
      if (dyn) return dyn
      if (this.gain > 0 && bestFail.startsWith("can't let go")) return 'deadpoint too hard to catch'
    }
    return bestFail
  }

  startNodes(): { nodes: Node[]; problems: string[] } {
    const { ctx } = this
    const problems: string[] = []
    const handStarts = ctx.startIds.map((id) => lookup(ctx, id)!).filter((h) => h.hand)
    const footStarts = ctx.startIds.map((id) => lookup(ctx, id)!).filter((h) => !h.hand && h.foot)
    if (handStarts.length === 0) return { nodes: [], problems: ['No usable start hold for hands.'] }
    const chosen = [...handStarts].sort((a, b) => a.y - b.y).slice(0, 2).sort((a, b) => a.x - b.x)
    const LH = chosen[0].id
    const RH = chosen[chosen.length - 1].id
    const handsOnly: Contacts = { LH, RH, LF: null, RF: null }
    const pose0 = solvePose(handsOnly, ctx).pose

    let lfOpts: FootContact[]
    let rfOpts: FootContact[]
    const minHand = Math.min(chosen[0].y, chosen[chosen.length - 1].y)
    const opts = (limb: 'LF' | 'RF', preferId?: string): FootContact[] => {
      const yMax = this.footYMax(handsOnly)
      if (preferId) return [{ kind: 'hold', id: preferId }, ...this.wallSmears(pose0, limb, yMax, preferId), null]
      const hip = hipPos(pose0, ctx, side(limb))
      // Any foothold below the start hands. The pose check drops real high-steps.
      const holds = ctx.footHolds
        .filter((h) => h.y < minHand - 0.12 && h.y >= 0.02)
        .filter((h) => Math.hypot(h.x - hip.x, h.y - hip.y) <= ctx.footReach + 0.85)
        .sort((a, b) => {
          const score = (h: (typeof ctx.footHolds)[number]) =>
            Math.abs(h.x - hip.x) + Math.abs(h.y - (pose0.y - 0.5 * ctx.dims.leg)) + (dedicatedFoot(h) ? -0.7 : 0)
          return score(a) - score(b) || a.id.localeCompare(b.id)
        })
        .slice(0, 7)
        .map((h) => ({ kind: 'hold' as const, id: h.id }))
      // One foothold cannot be shared. The other foot smears beside it instead.
      const reserved = holds.length === 1 && holds[0].kind === 'hold' ? holds[0].id : null
      const smears = holds.length < 2 ? this.wallSmears(pose0, limb, yMax, reserved) : []
      return [...holds, ...smears, null]
    }
    if (footStarts.length >= 2) {
      const fs = [...footStarts].sort((a, b) => a.x - b.x)
      lfOpts = opts('LF', fs[0].id)
      rfOpts = opts('RF', fs[fs.length - 1].id)
    } else if (footStarts.length === 1) {
      lfOpts = opts('LF', footStarts[0].id)
      rfOpts = opts('RF')
    } else {
      lfOpts = opts('LF')
      rfOpts = opts('RF')
    }

    const scored: Node[] = []
    const overLimit: Node[] = []
    let bestFail: string | null = null
    for (const lf of lfOpts) {
      for (const rf of rfOpts) {
        if (lf && rf && lf.kind === 'hold' && rf.kind === 'hold' && lf.id === rf.id) continue
        const contacts: Contacts = { LH, RH, LF: lf, RF: rf }
        const pr = this.pose(contacts)
        if (!pr.feasible) {
          bestFail ??= `start position out of reach (${pr.violations.join(', ')})`
          continue
        }
        const st = evaluateStatics(contacts, pr.pose, ctx)
        const offHold = [lf, rf].filter((f) => f?.kind !== 'hold').length
        const besideChip = (f: FootContact) => {
          if (!f || f.kind !== 'hold') return 0
          const h = lookup(ctx, f.id)!
          if (dedicatedFoot(h)) return 0
          return ctx.footHolds.some((o) => o.id !== h.id && dedicatedFoot(o) && Math.hypot(o.x - h.x, o.y - h.y) < 0.4) ? 2.4 : 0
        }
        const node: Node = {
          key: contactsKey(contacts),
          contacts,
          pose: pr.pose,
          stretch: pr.stretch,
          statics: st,
          g: 1.6 * st.uMax ** 2 + offHold * 2.2 + besideChip(lf) + besideChip(rf) + 0.05 * pr.cost,
          h: this.heuristic(contacts),
          depth: 0,
          parent: null,
          move: null,
        }
        if (st.uMax > 1) {
          bestFail = `start position is hard to hold (${Math.round(st.uMax * 100)}% of grip capacity on ${holdName(lookup(ctx, st.hands.sort((a, b) => b.u - a.u)[0]?.holdId ?? ''))})`
          overLimit.push(node)
          continue
        }
        scored.push(node)
      }
    }
    const pool = scored.length > 0 ? scored : overLimit
    if (pool.length === 0 && bestFail) problems.push(bestFail)
    if (scored.length === 0 && pool.length > 0 && bestFail) problems.push(bestFail)
    const uncrossed = pool.filter((n) => !feetCrossed(n.contacts, ctx.byId))
    const starts = uncrossed.length > 0 ? uncrossed : pool
    starts.sort((a, b) => a.g - b.g || a.key.localeCompare(b.key))
    return { nodes: starts.slice(0, 4), problems }
  }

  search(penalty: Map<string, number>, deadline: number): { goal: Node | null; best: Node | null } {
    const { nodes } = this.startNodes()
    let frontier = nodes
    const bestG = new Map<string, number>()
    const goals: Node[] = []
    let firstGoalDepth = Infinity
    let best: Node | null = nodes[0] ?? null
    const progress = (n: Node) => -n.h
    for (const n of nodes) {
      if (this.isGoal(n.contacts)) {
        goals.push(n)
        firstGoalDepth = -1
      }
      bestG.set(n.key, n.g)
    }
    for (let depth = 0; depth < this.opts.maxDepth && frontier.length > 0; depth++) {
      if (goals.length > 0 && depth > firstGoalDepth + 2) break
      if (Date.now() > deadline) break
      const next = new Map<string, Node>()
      for (const node of frontier) {
        this.expanded++
        const consider = (child: Node | string) => {
          if (typeof child === 'string') return
          if (this.isGoal(child.contacts)) {
            goals.push(child)
            firstGoalDepth = Math.min(firstGoalDepth, depth)
            return
          }
          if ((bestG.get(child.key) ?? Infinity) <= child.g) return
          bestG.set(child.key, child.g)
          const prev = next.get(child.key)
          if (!prev || prev.g > child.g) next.set(child.key, child)
          if (!best || progress(child) > progress(best) + 1e-9 || (Math.abs(progress(child) - progress(best)) < 1e-9 && child.g < best.g)) best = child
        }
        for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
          for (const target of this.candidates(node, limb)) consider(this.tryMove(node, limb, target, penalty))
        }
        const lf = node.contacts.LF
        const rf = node.contacts.RF
        if (lf?.kind === 'hold' && rf?.kind === 'hold' && (lf.id !== rf.id || (lf.patch ?? '') !== (rf.patch ?? ''))) {
          consider(this.tryMove(node, 'LF', rf, penalty, { ...node.contacts, LF: rf, RF: lf }))
        }
      }
      const perHands = new Map<string, number>()
      frontier = []
      for (const n of [...next.values()].sort((a, b) => a.g + a.h - (b.g + b.h) || a.key.localeCompare(b.key))) {
        if (frontier.length >= this.opts.beamWidth) break
        const hk = `${holdIdOf(n.contacts.LH)}|${holdIdOf(n.contacts.RH)}`
        const count = perHands.get(hk) ?? 0
        if (count >= this.opts.perHandPair) continue
        perHands.set(hk, count + 1)
        frontier.push(n)
      }
    }
    goals.sort((a, b) => a.g - b.g || a.key.localeCompare(b.key))
    return { goal: goals[0] ?? null, best }
  }

  /** Why can't we progress from this node? Reasons for the nearest hand holds that lead toward the finish. */
  diagnose(node: Node): string[] {
    const { ctx } = this
    const out: string[] = []
    const held = [node.contacts.LH, node.contacts.RH]
    const progressWith = (id: string) => this.heuristic({ ...node.contacts, LH: id, RH: id })
    const here = Math.min(...held.map((id) => (id ? progressWith(id) : Infinity)))
    const hands = held.map((id) => lookup(ctx, id!)!).filter(Boolean)
    const dist = (h: PlannerHold) => Math.min(...hands.map((o) => Math.hypot(h.x - o.x, h.y - o.y)))
    const upward = ctx.handHolds
      .filter((h) => !held.includes(h.id) && progressWith(h.id) < here - 1e-6)
      .sort((a, b) => dist(a) - dist(b) || a.id.localeCompare(b.id))
      .slice(0, 3)
    for (const h of upward) {
      const reasons = (['LH', 'RH'] as const).map((limb) => [limb, this.tryMove(node, limb, h.id, new Map())] as const)
      if (reasons.every(([, r]) => typeof r === 'string')) {
        const text = [...new Set(reasons.map(([limb, r]) => `${limb === 'LH' ? 'left' : 'right'} hand ${r as string}`))]
        out.push(`${holdName(h)}: ${text.join('; ')}`)
      }
    }
    if (out.length === 0 && upward.length === 0) out.push('No usable hand holds closer to the finish.')
    return out
  }
}

function toBeta(goal: Node, ctx: PlannerContext, id: string, label: string): Beta {
  const chain: Node[] = []
  for (let n: Node | null = goal; n; n = n.parent) chain.unshift(n)
  const steps: BetaStep[] = chain.map((n, index) => {
    const kind: MoveKind = n.move?.kind ?? 'start'
    const limb = n.move?.limb ?? null
    const uMid = n.move ? n.move.uMid : null
    const text = describeMove({
      kind,
      limb,
      contacts: n.contacts,
      statics: n.statics,
      uMid,
      stretch: n.stretch,
      dynamic: n.move?.dynamic ?? false,
      ctx,
      pose: n.pose,
    })
    const prev = chain[index - 1]
    const footFreed =
      prev && limb && isHand(limb) && (['LF', 'RF'] as const).some((f) => footKey(n.contacts[f]) !== footKey(prev.contacts[f]))
    const swapped =
      prev && limb && !isHand(limb) && (['LF', 'RF'] as const).every((f) => footKey(n.contacts[f]) !== footKey(prev.contacts[f]) && n.contacts[f] && prev.contacts[f])
    const detail = swapped ? ['Swap the feet in one move so the hips can face the next hold.', ...text.detail] : text.detail
    const title = swapped ? 'Swap the feet' : text.title
    const caveats = footFreed ? [...text.caveats, 'Smeared or flagged a foot to make the reach.'] : [...text.caveats]
    const drawn = skeletonFromPose(n.contacts, n.pose, ctx, { flag: n.statics.flag })
    const ikWorse = drawn.overstretched.filter((l) => (n.stretch[l] ?? 0) <= 1.02)
    if (ikWorse.length > 0) caveats.push('The drawn pose is more stretched than the plan allows.')
    return {
      index,
      kind,
      limb,
      contacts: n.contacts,
      pose: n.pose,
      statics: n.statics,
      uMid,
      stretch: n.stretch,
      dynamic: n.move?.dynamic ?? false,
      title,
      detail,
      caveats,
    }
  })
  const effort = (s: BetaStep) => Math.max(s.statics.uMax, s.uMid ?? 0)
  let cruxStep = 0
  steps.forEach((s, i) => {
    if (effort(s) > effort(steps[cruxStep])) cruxStep = i
  })
  const maxEffort = effort(steps[cruxStep])
  const handMoves = steps.filter((s) => s.limb && isHand(s.limb)).length
  const footMoves = steps.filter((s) => s.limb && !isHand(s.limb)).length
  const dynos = steps.filter((s) => s.dynamic).length
  const verdict =
    maxEffort < 0.55 ? 'Comfortable for you' : maxEffort < 0.75 ? 'Moderate for you' : maxEffort < 0.9 ? 'Hard: close to your max grade' : 'At your limit'
  const summary = [
    `${steps.length - 1} moves (${handMoves} hand, ${footMoves} foot${dynos ? `, ${dynos} dynamic` : ''}).`,
    `Crux: step ${cruxStep}, ${steps[cruxStep].title.toLowerCase()} (${stanceLabel(steps[cruxStep].pose.stance)}) at ~${Math.round(maxEffort * 100)}% of your grip capacity (${effortLabel(maxEffort)}).`,
    `${verdict}.`,
  ].join(' ')
  return { id, label, steps, cost: goal.g, cruxStep, maxEffort, summary, verdict, caveats: [] }
}

const handSequence = (b: Beta) =>
  b.steps
    .filter((s) => s.limb && isHand(s.limb))
    .map((s) => `${s.limb}:${holdIdOf(s.contacts[s.limb as 'LH' | 'RH'])}:${s.pose.stance}:${s.dynamic ? 'd' : 's'}`)
    .join(',')

export function planBeta(route: Route, profile: ClimberProfile, options: PlanOptions = {}): PlanResult {
  const t0 = Date.now()
  const opts: Required<PlanOptions> = { beamWidth: 80, perHandPair: 5, maxDepth: 48, maxBetas: 3, timeBudgetMs: 8000, ...options }
  const ctx = buildContext(route, profile)
  const warnings: string[] = []
  if (!ctx.scaleCalibrated) warnings.push('Scale is uncalibrated, so reach estimates may be off. Calibrate under Wall & scale.')
  if (route.wall.floorV === null) warnings.push('No floor line set: the bottom of the photo is treated as the floor.')
  const guessed = ctx.holds.filter((h) => h.source === 'model' || h.type === 'unknown').length
  if (guessed > 0) warnings.push(`${guessed} hold(s) have auto-detected or unknown types; verify them for a better beta.`)

  const fail = (reason: string, diagnostics: string[], partial: Beta | null = null): PlanResult => ({
    ok: false,
    reason,
    diagnostics,
    warnings,
    partial,
    stats: { expanded: 0, ms: Date.now() - t0 },
  })
  if (ctx.finishIds.length === 0) return fail('Mark a finish hold (hands allowed) first.', [])
  if (ctx.startIds.length === 0) return fail('Mark at least one start hold first.', [])

  const planner = new Planner(ctx, opts)
  const start = planner.startNodes()
  if (start.nodes.length === 0) return fail('Could not find a holdable start position.', start.problems)

  const startHandY = Math.max(...[start.nodes[0].contacts.LH, start.nodes[0].contacts.RH].map((id) => lookup(ctx, id!)!.y))
  const startCaveats: string[] = []
  if (startHandY > ctx.dims.standingReach + 0.05) {
    startCaveats.push(`Jump start: start holds are ~${Math.round((startHandY - ctx.dims.standingReach) * 100)} cm above your standing reach.`)
  } else if (startHandY < ctx.dims.hipHeight) startCaveats.push('Low start: likely a sit start.')

  const deadline = t0 + opts.timeBudgetMs
  const betas: Beta[] = []
  const penalty = new Map<string, number>()
  let lastBest: Node | null = null
  for (let i = 0; i < opts.maxBetas && Date.now() < deadline; i++) {
    const { goal, best } = planner.search(penalty, deadline)
    lastBest ??= best
    if (!goal) break
    const beta = toBeta(goal, ctx, `beta-${i}`, `Beta ${String.fromCharCode(65 + betas.length)}`)
    const seq = handSequence(beta)
    if (!betas.some((b) => handSequence(b) === seq)) betas.push(beta)
    for (const s of beta.steps) {
      if (s.limb && isHand(s.limb)) {
        const k = `${s.limb}:${holdIdOf(s.contacts[s.limb])}:${s.pose.stance}`
        penalty.set(k, (penalty.get(k) ?? 0) + 4)
      }
    }
  }

  const stats = { expanded: planner.expanded, ms: Date.now() - t0 }
  if (betas.length === 0) {
    const diagnostics = lastBest ? planner.diagnose(lastBest) : []
    const partial = lastBest ? toBeta(lastBest, ctx, 'partial', 'Furthest progress') : null
    const top = lastBest ? Math.max(...[lastBest.contacts.LH, lastBest.contacts.RH].map((id) => lookup(ctx, id!)!.y)) : 0
    return {
      ok: false,
      reason: `No complete sequence found for ${profile.name}. Got hands up to ${top.toFixed(2)} m of ${planner.finishTop.toFixed(2)} m.`,
      diagnostics,
      warnings,
      partial,
      stats,
    }
  }
  for (const b of betas) {
    b.caveats = [
      ...startCaveats,
      ...new Set(b.steps.flatMap((s) => s.caveats)),
      'Estimated from a simplified body and grip model. Patch cones, friction, and hold depth are estimates, not measurements.',
    ]
  }
  return { ok: true, betas, warnings, stats }
}
