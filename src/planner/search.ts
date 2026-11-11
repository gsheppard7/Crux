import type { Route } from '../model/schema'
import { dynamicGain, type ClimberProfile } from '../climber/profile'
import { buildContext } from './context'
import { contactPoint, evaluateStatics, highStepLimit, hipPos, isHand, shoulderPos, side, solvePose, type PoseResult } from './body'
import { smearEffectiveness } from './grip'
import { describeMove, effortLabel, holdName } from './explain'
import type { Beta, BetaStep, Contacts, FootContact, Limb, MoveKind, PlannerContext, PlannerHold, PlanResult, Pose, Statics } from './types'

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

const footKey = (f: FootContact) => (!f ? '-' : f.kind === 'hold' ? `h:${f.id}` : `s:${f.x.toFixed(2)},${f.y.toFixed(2)}`)
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
    this.finishTop = Math.max(...ctx.finishIds.map((id) => ctx.byId.get(id)!.y))
  }

  pose(c: Contacts): PoseResult {
    const key = contactsKey(c)
    let r = this.poseCache.get(key)
    if (!r) {
      r = solvePose(c, this.ctx)
      this.poseCache.set(key, r)
    }
    return r
  }

  isGoal(c: Contacts): boolean {
    const F = this.ctx.finishIds
    if (!c.LH || !c.RH) return false
    if (F.length === 1) {
      const f = this.ctx.byId.get(F[0])!
      return f.matchable ? c.LH === F[0] && c.RH === F[0] : c.LH === F[0] || c.RH === F[0]
    }
    return F.includes(c.LH) && F.includes(c.RH)
  }

  heuristic(c: Contacts): number {
    const { byId, finishIds, handReach } = this.ctx
    const finishes = finishIds.map((id) => byId.get(id)!)
    const toFinish = (id: string | null) => {
      const h = id ? byId.get(id) : undefined
      if (!h) return 2 * handReach
      return Math.min(...finishes.map((f) => Math.hypot(f.x - h.x, f.y - h.y)))
    }
    const near = Math.min(toFinish(c.LH), toFinish(c.RH))
    const far = Math.max(toFinish(c.LH), toFinish(c.RH))
    const onFinish = [c.LH, c.RH].filter((id) => id && finishIds.includes(id)).length
    // Feet left far below the hands will have to come up before the next big move.
    const topHand = Math.max(...[c.LH, c.RH].map((id) => (id ? byId.get(id)!.y : 0)))
    const footYs = [c.LF, c.RF].map((f) => (!f ? null : f.kind === 'smear' ? f.y : byId.get(f.id)?.y ?? null)).filter((y): y is number => y !== null)
    const bestFoot = footYs.length ? Math.max(...footYs) : 0
    const footLag = Math.max(0, topHand - bestFoot - (this.ctx.footReach + 0.25))
    const offHold = [c.LF, c.RF].filter((f) => f?.kind !== 'hold').length
    return (1.3 * (0.6 * near + 0.4 * far)) / (0.55 * handReach) + (2 - onFinish) * 0.8 + (1.8 * footLag) / handReach + offHold * 1.5
  }

  /** Hip height implied by the current hands, so a low foot doesn't drag the step cap down. */
  naturalHipY(c: Contacts): number {
    const ys = [c.LH, c.RH].map((id) => (id ? this.ctx.byId.get(id)!.y : null)).filter((y): y is number => y !== null)
    const lowHand = ys.length ? Math.min(...ys) : 1
    return lowHand - 0.75 * this.ctx.dims.torso
  }

  /** Highest a foot may be placed: just above that natural hip, and well under the hands. */
  footYMax(c: Contacts): number {
    const topHand = Math.max(...[c.LH, c.RH].map((id) => (id ? this.ctx.byId.get(id)!.y : 0)))
    return Math.min(this.naturalHipY(c) + highStepLimit(this.ctx), topHand - 0.55)
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
      const root = shoulderPos(node.pose, ctx, side(limb))
      const minY = Math.min(...[c.LH, c.RH].map((id) => (id ? ctx.byId.get(id)!.y : 0)))
      const near = ctx.handHolds
        .filter((h) => h.id !== c[limb])
        .filter((h) => h.id !== other || h.matchable || ctx.finishIds.includes(h.id))
        .filter((h) => Math.hypot(h.x - root.x, h.y - root.y) <= ctx.handReach + this.gain + 0.6)
        .filter((h) => h.y >= minY - 0.45)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .slice(0, 9)
        .map((h) => h.id)
      // Always keep finish holds as candidates so the last move isn't pruned by the reach prefilter.
      for (const id of ctx.finishIds) {
        if (!near.includes(id) && id !== c[limb] && (id !== other || ctx.byId.get(id)!.matchable)) near.push(id)
      }
      return near
    }
    const cur = c[limb]
    const curId = cur && cur.kind === 'hold' ? cur.id : null
    const otherFoot = c[limb === 'LF' ? 'RF' : 'LF']
    const otherFootId = otherFoot?.kind === 'hold' ? otherFoot.id : null
    const hip = hipPos(node.pose, ctx, side(limb))
    const maxHandY = Math.max(...[c.LH, c.RH].map((id) => (id ? ctx.byId.get(id)!.y : 0)))
    // Prefer feet that close the gap under the hands when they lag behind.
    const bestFootNow = Math.max(
      ...(['LF', 'RF'] as const).map((l) => {
        const f = c[l]
        if (!f) return 0
        return f.kind === 'smear' ? f.y : (ctx.byId.get(f.id)?.y ?? 0)
      }),
    )
    const needUp = maxHandY - bestFootNow > ctx.footReach + 0.25
    const yMax = this.footYMax(c)
    const hipLine = this.naturalHipY(c)
    const idealY = needUp ? Math.min(yMax, hipLine - 0.05) : hipLine - 0.4 * ctx.dims.leg
    const holds: FootContact[] = ctx.footHolds
      .filter((h) => h.id !== curId && h.id !== otherFootId)
      .filter((h) => h.y >= 0.03 && h.y <= yMax)
      .filter((h) => Math.hypot(h.x - hip.x, h.y - hip.y) <= ctx.footReach + 0.8)
      .sort((a, b) => Math.abs(a.y - idealY) + 0.5 * Math.abs(a.x - hip.x) - (Math.abs(b.y - idealY) + 0.5 * Math.abs(b.x - hip.x)) || a.id.localeCompare(b.id))
      .slice(0, 8)
      .map((h) => ({ kind: 'hold' as const, id: h.id }))
    const smears = this.smearOptions(node.pose, limb as 'LF' | 'RF', c)
    const out = [...holds, ...smears]
    // Flag only when there is no hold and no wall smear (steep terrain). A smear beats sharing one hold.
    if (cur && holds.length === 0 && smears.length === 0) out.push(null)
    return out
  }

  /** Evaluate moving one limb; returns the child node or a failure reason. */
  tryMove(node: Node, limb: Limb, target: string | FootContact, penalty: Map<string, number>): Node | string {
    const { ctx } = this
    const contacts: Contacts = { ...node.contacts, [limb]: target } as Contacts
    const key = contactsKey(contacts)
    if (key === node.key) return 'no change'
    const pr = this.pose(contacts)
    if (!pr.feasible) return `out of reach (${pr.violations.join(', ')})`
    const after = evaluateStatics(contacts, pr.pose, ctx)
    if (after.uMax > 1) return `too hard to hold (${Math.round(after.uMax * 100)}% of grip capacity)`

    if (!isHand(limb) && target && (target as FootContact).kind === 'hold') {
      const other = contacts[limb === 'LF' ? 'RF' : 'LF']
      if (other?.kind === 'hold' && other.id === (target as FootContact & { kind: 'hold' }).id) return 'both feet on one hold'
    }
    if (!isHand(limb) && !feetLegal(contacts)) return 'at least one foot has to stay on a hold'
    const cutting = !isHand(limb) && target === null && !node.contacts[limb === 'LF' ? 'RF' : 'LF']
    let uMid = evaluateStatics(contacts, pr.pose, ctx, limb, cutting ? 1.25 : 1).uMax
    let dynamic = false
    if (uMid > MOVE_LIMIT) {
      if (!isHand(limb) || this.gain <= 0) return `can't let go to move (${Math.round(uMid * 100)}% on the remaining holds)`
      const p = contactPoint(contacts, limb, ctx)!
      const root = shoulderPos(node.pose, ctx, side(limb))
      const launch = evaluateStatics(node.contacts, node.pose, ctx, limb).uMax
      const dist = Math.hypot(p.x - root.x, p.y - root.y)
      if (dist > ctx.handReach + this.gain) return 'out of dynamic range'
      if (launch > 1 + 0.25 * ctx.profile.power || after.uMax > CATCH_LIMIT) return 'deadpoint too hard to catch'
      dynamic = true
      uMid = launch
    }

    const prevHands = [node.contacts.LH, node.contacts.RH]
    let kind: MoveKind
    let cost: number
    if (isHand(limb)) {
      const hold = ctx.byId.get(target as string)!
      const other = contacts[limb === 'LH' ? 'RH' : 'LH']
      const lx = ctx.byId.get(contacts.LH!)!.x
      const rx = ctx.byId.get(contacts.RH!)!.x
      const crossed = lx > rx + 0.08
      const prevY = ctx.byId.get(node.contacts[limb]!)?.y ?? 0
      kind = dynamic ? 'dyno' : other === target ? 'match' : crossed ? 'cross' : 'reach'
      cost = 1.0
      if (crossed) cost += 1.2
      if (hold.y < prevY - 0.1) cost += 0.8
      if (dynamic) cost += 2 + 1.5 * (1 - ctx.profile.power) + (ctx.profile.style === 'dynamic' ? -0.8 : 0)
      cost += penalty.get(`${limb}:${hold.id}`) ?? 0
      if (prevHands.includes(hold.id) && kind !== 'match') cost += 0.5
    } else {
      const f = target as FootContact
      const otherFoot = contacts[limb === 'LF' ? 'RF' : 'LF']
      cost = 0.55
      if (!f) {
        kind = otherFoot ? 'flag' : 'cut'
        cost += otherFoot ? 2.4 : 3
      } else if (f.kind === 'smear') {
        kind = 'smear'
        // A hold is always better than the wall; smearing is a last resort for one foot.
        cost += 2.6
      } else {
        const fy = ctx.byId.get(f.id)!.y
        kind = fy > pr.pose.y - 0.02 ? 'high-step' : 'foot'
        if (kind === 'high-step') cost += 0.9 * (1.2 - ctx.profile.flexibility)
        if (otherFoot && otherFoot.kind === 'hold' && otherFoot.id === f.id) return 'both feet on one hold'
      }
      const lp = contactPoint(contacts, 'LF', ctx)
      const rp = contactPoint(contacts, 'RF', ctx)
      if (lp && rp && lp.x > rp.x + 0.1) cost += 0.6
    }
    const maxStretch = Math.max(...Object.values(pr.stretch).map((s) => s ?? 0))
    if (maxStretch > 0.97) cost += (maxStretch - 0.97) / 0.03
    const offHold = [contacts.LF, contacts.RF].filter((f) => f?.kind !== 'hold').length
    cost += offHold * 0.85
    cost += 1.6 * after.uMax ** 2 + 1.2 * uMid ** 2

    return {
      key,
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

  startNodes(): { nodes: Node[]; problems: string[] } {
    const { ctx } = this
    const problems: string[] = []
    const handStarts = ctx.startIds.map((id) => ctx.byId.get(id)!).filter((h) => h.hand)
    const footStarts = ctx.startIds.map((id) => ctx.byId.get(id)!).filter((h) => !h.hand && h.foot)
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
        .sort((a, b) => Math.abs(a.x - hip.x) + Math.abs(a.y - (pose0.y - 0.5 * ctx.dims.leg)) - (Math.abs(b.x - hip.x) + Math.abs(b.y - (pose0.y - 0.5 * ctx.dims.leg))) || a.id.localeCompare(b.id))
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
        const node: Node = {
          key: contactsKey(contacts),
          contacts,
          pose: pr.pose,
          stretch: pr.stretch,
          statics: st,
          g: 1.6 * st.uMax ** 2 + offHold * 2.2 + 0.05 * pr.cost,
          h: this.heuristic(contacts),
          depth: 0,
          parent: null,
          move: null,
        }
        if (st.uMax > 1) {
          bestFail = `start position is hard to hold (${Math.round(st.uMax * 100)}% of grip capacity on ${holdName(ctx.byId.get(st.hands.sort((a, b) => b.u - a.u)[0]?.holdId ?? ''))})`
          overLimit.push(node)
          continue
        }
        scored.push(node)
      }
    }
    const pool = scored.length > 0 ? scored : overLimit
    if (pool.length === 0 && bestFail) problems.push(bestFail)
    if (scored.length === 0 && pool.length > 0 && bestFail) problems.push(bestFail)
    pool.sort((a, b) => a.g - b.g || a.key.localeCompare(b.key))
    return { nodes: pool.slice(0, 4), problems }
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
        for (const limb of ['LH', 'RH', 'LF', 'RF'] as const) {
          for (const target of this.candidates(node, limb)) {
            const child = this.tryMove(node, limb, target, penalty)
            if (typeof child === 'string') continue
            if (this.isGoal(child.contacts)) {
              goals.push(child)
              firstGoalDepth = Math.min(firstGoalDepth, depth)
              continue
            }
            if ((bestG.get(child.key) ?? Infinity) <= child.g) continue
            bestG.set(child.key, child.g)
            const prev = next.get(child.key)
            if (!prev || prev.g > child.g) next.set(child.key, child)
            if (!best || progress(child) > progress(best) + 1e-9 || (Math.abs(progress(child) - progress(best)) < 1e-9 && child.g < best.g)) best = child
          }
        }
      }
      const perHands = new Map<string, number>()
      frontier = []
      for (const n of [...next.values()].sort((a, b) => a.g + a.h - (b.g + b.h) || a.key.localeCompare(b.key))) {
        if (frontier.length >= this.opts.beamWidth) break
        const hk = `${n.contacts.LH}|${n.contacts.RH}`
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
    const hands = held.map((id) => ctx.byId.get(id!)!).filter(Boolean)
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
    const text = describeMove({ kind, limb, contacts: n.contacts, statics: n.statics, uMid, stretch: n.stretch, dynamic: n.move?.dynamic ?? false, ctx })
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
      title: text.title,
      detail: text.detail,
      caveats: text.caveats,
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
    `Crux: step ${cruxStep}, ${steps[cruxStep].title.toLowerCase()} at ~${Math.round(maxEffort * 100)}% of your grip capacity (${effortLabel(maxEffort)}).`,
    `${verdict}.`,
  ].join(' ')
  return { id, label, steps, cost: goal.g, cruxStep, maxEffort, summary, verdict, caveats: [] }
}

const handSequence = (b: Beta) =>
  b.steps
    .filter((s) => s.limb && isHand(s.limb))
    .map((s) => `${s.limb}:${s.contacts[s.limb as 'LH' | 'RH']}`)
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

  const startHandY = Math.max(...[start.nodes[0].contacts.LH, start.nodes[0].contacts.RH].map((id) => ctx.byId.get(id!)!.y))
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
        const k = `${s.limb}:${s.contacts[s.limb]}`
        penalty.set(k, (penalty.get(k) ?? 0) + 1.6)
      }
    }
  }

  const stats = { expanded: planner.expanded, ms: Date.now() - t0 }
  if (betas.length === 0) {
    const diagnostics = lastBest ? planner.diagnose(lastBest) : []
    const partial = lastBest ? toBeta(lastBest, ctx, 'partial', 'Furthest progress') : null
    const top = lastBest ? Math.max(...[lastBest.contacts.LH, lastBest.contacts.RH].map((id) => ctx.byId.get(id!)!.y)) : 0
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
      'Estimated from a simplified 2D body and grip model; real holds, friction and body shape will differ.',
    ]
  }
  return { ok: true, betas, warnings, stats }
}
