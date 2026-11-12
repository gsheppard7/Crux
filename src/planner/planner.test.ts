import { describe, expect, it } from 'vitest'
import { addHold, createEmptyRoute, createHold, setWall, toggleFinish, toggleStart } from '../model/route'
import type { Hold, Route } from '../model/schema'
import { bodyDims, DEFAULT_CLIMBER, dynamicGain, inchesToM, type ClimberProfile } from '../climber/profile'
import { sampleRoutes } from '../samples/sampleRoutes'
import { skeletonFromPose } from '../avatar/skeleton'
import { buildContext, canStandOn } from './context'
import { evaluateStatics, flagPoint, solvePose, stanceGate } from './body'
import { directionFactor, handCapacity, holdGripSummary, supportAlignment } from './grip'
import { PRE_CHANGE_BASELINE } from './baseline.snapshot'
import { Planner, isMantle, planBeta, tacticCost } from './search'
import type { Contacts, Statics } from './types'

const W = 1000
const H = 1500
const MPP = 0.003 // 3 m × 4.5 m wall

/** Build a route from wall-local meter coordinates. */
function routeFromMeters(
  holds: (Partial<Hold> & { id: string; x: number; y: number })[],
  opts: { angle?: number; start: string[]; finish: string[]; footRule?: Route['footRule'] },
): Route {
  let r = createEmptyRoute({ image: { name: 't', width: W, height: H, dataUrl: null }, id: 'syn', now: 'x' })
  r = setWall(r, { metersPerPixel: MPP, scaleSource: 'wall-width', angleDeg: opts.angle ?? 0 })
  for (const h of holds) {
    const { x, y, ...rest } = h
    r = addHold(r, createHold({ radius: 0.025, type: 'jug', facingDeg: 0, ...rest, u: x / (W * MPP), v: 1 - y / (H * MPP) }))
  }
  for (const id of opts.start) r = toggleStart(r, id)
  for (const id of opts.finish) r = toggleFinish(r, id)
  return { ...r, footRule: opts.footRule ?? 'open' }
}

const ladder = (angle = 0, type: Hold['type'] = 'jug') =>
  routeFromMeters(
    [
      { id: 's1', x: 1.3, y: 1.6, type },
      { id: 's2', x: 1.7, y: 1.6, type },
      { id: 'a', x: 1.35, y: 2.15, type },
      { id: 'b', x: 1.7, y: 2.65, type },
      { id: 'c', x: 1.35, y: 3.15, type },
      { id: 'd', x: 1.65, y: 3.65, type },
      { id: 'fin', x: 1.5, y: 4.15, type: 'jug', radius: 0.035 },
      { id: 'f1', x: 1.4, y: 0.35, type: 'foot-chip', radius: 0.012, allowHand: false },
      { id: 'f2', x: 1.65, y: 0.6, type: 'foot-chip', radius: 0.012, allowHand: false },
      { id: 'f3', x: 1.35, y: 1.05, type: 'edge', radius: 0.015, allowHand: false },
      { id: 'f4', x: 1.7, y: 1.5 - 0.1, type: 'edge', radius: 0.015, allowHand: false },
      { id: 'f5', x: 1.4, y: 2.0 - 0.1, type: 'edge', radius: 0.015, allowHand: false },
      { id: 'f6', x: 1.65, y: 2.5 - 0.1, type: 'edge', radius: 0.015, allowHand: false },
    ],
    { angle, start: ['s1', 's2'], finish: ['fin'] },
  )

describe('climber profile', () => {
  it('defaults to a 5′11″ climber with ape index 0 and sensible segment lengths', () => {
    expect(DEFAULT_CLIMBER.heightM).toBeCloseTo(1.803, 3)
    expect(DEFAULT_CLIMBER.wingspanM).toBe(DEFAULT_CLIMBER.heightM)
    const d = bodyDims(DEFAULT_CLIMBER)
    expect(d.arm).toBeGreaterThan(0.6)
    expect(d.arm).toBeLessThan(0.75)
    expect(d.leg).toBeCloseTo(0.885, 2)
    expect(d.standingReach).toBeGreaterThan(2.2)
    expect(d.standingReach).toBeLessThan(2.4)
  })
})

describe('grip and statics model', () => {
  it('pulling against a hold’s facing direction weakens it', () => {
    const crimp = { type: 'crimp' as const, facingDeg: 0 }
    expect(directionFactor(crimp, { x: 0, y: -1 })).toBeCloseTo(1) // body below an upward-facing crimp
    expect(directionFactor(crimp, { x: 0, y: 1 })).toBeCloseTo(0.15) // pulling upward off it
    const sidepullFacingLeft = { type: 'sidepull' as const, facingDeg: 270 }
    expect(directionFactor(sidepullFacingLeft, { x: 1, y: 0 })).toBeCloseTo(1) // body to the right
    const diagonal = { type: 'edge' as const, facingDeg: 45 }
    expect(supportAlignment(45, { x: -1, y: -1 })).toBeGreaterThan(0.95)
    expect(supportAlignment(45, { x: 0, y: -1 })).toBeLessThan(0.75)
    expect(directionFactor(diagonal, { x: -1, y: -1 })).toBeGreaterThan(directionFactor(diagonal, { x: 0, y: -1 }) * 1.35)
  })

  it('a jug is "good" and a hard crimp on an overhang is not', () => {
    const r = ladder()
    const ctx = buildContext(r, DEFAULT_CLIMBER)
    const jug = ctx.byId.get('a')!
    expect(holdGripSummary(jug, DEFAULT_CLIMBER, 0).rating).toBe('good')
    const crimp = { ...jug, type: 'crimp' as const, difficulty: 4 }
    const s = holdGripSummary(crimp, DEFAULT_CLIMBER, 35)
    expect(s.rating === 'hard' || s.rating === 'very hard').toBe(true)
    expect(s.oneHandWithFeet).toBe(false)
  })

  it('cannot hold one-handed on a crimp on a 35° overhang, but can on a jug', () => {
    for (const [type, expectHold] of [
      ['crimp', false],
      ['jug', true],
    ] as const) {
      const r = ladder(35, type)
      const ctx = buildContext(r, DEFAULT_CLIMBER)
      const c: Contacts = { LH: 'a', RH: null, LF: { kind: 'hold', id: 'f3' }, RF: { kind: 'hold', id: 'f2' } }
      const pose = solvePose({ ...c, RH: 'a' }, ctx).pose
      const st = evaluateStatics(c, pose, ctx)
      expect(st.uMax <= 1, `${type}: u=${st.uMax.toFixed(2)}`).toBe(expectHold)
    }
  })

  it('good feet take weight off the hands on vertical terrain', () => {
    const ctx = buildContext(ladder(0), DEFAULT_CLIMBER)
    const withFeet: Contacts = { LH: 's1', RH: 's2', LF: { kind: 'hold', id: 'f3' }, RF: { kind: 'hold', id: 'f2' } }
    const pose = solvePose(withFeet, ctx).pose
    const a = evaluateStatics(withFeet, pose, ctx)
    const b = evaluateStatics({ ...withFeet, LF: null, RF: null }, pose, ctx)
    expect(a.handShare).toBeLessThan(0.5)
    expect(b.handShare).toBe(1)
    expect(b.uMax).toBeGreaterThan(a.uMax)
  })
})

describe('beta planner', () => {
  it('never grabs a foot chip and keeps at least one foot on a hold', () => {
    const r = ladder(0)
    const chipped = r.holds.map((h) => (h.type === 'foot-chip' ? { ...h, allowHand: true } : h))
    const ctx = buildContext({ ...r, holds: chipped }, DEFAULT_CLIMBER)
    expect(ctx.handHolds.some((h) => h.type === 'foot-chip')).toBe(false)
    expect(ctx.footHolds.some((h) => h.type === 'foot-chip')).toBe(true)

    const res = planBeta(r, DEFAULT_CLIMBER)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    for (const beta of res.betas) {
      for (const step of beta.steps) {
        const hands = [step.contacts.LH, step.contacts.RH].map((id) => (id ? ctx.byId.get(id) : undefined))
        expect(hands.every((h) => !h || h.type !== 'foot-chip')).toBe(true)
        const feet = [step.contacts.LF, step.contacts.RF]
        expect(feet.every((f) => f?.kind === 'hold')).toBe(true)
        const [lf, rf] = feet
        if (lf?.kind === 'hold' && rf?.kind === 'hold') expect(lf.id).not.toBe(rf.id)
      }
    }
  })

  it('smears the second foot instead of stacking both on one hold', () => {
    const r = routeFromMeters(
      [
        { id: 's1', x: 1.3, y: 1.6 },
        { id: 's2', x: 1.7, y: 1.6 },
        { id: 'fin', x: 1.5, y: 2.6, radius: 0.035 },
        { id: 'f', x: 1.5, y: 0.7, type: 'edge', radius: 0.02, allowHand: false },
      ],
      { start: ['s1', 's2'], finish: ['fin'] },
    )
    const res = planBeta(r, DEFAULT_CLIMBER, { maxBetas: 1 })
    const steps = res.ok ? res.betas[0].steps : res.partial?.steps
    expect(steps?.[0].kind).toBe('start')
    for (const step of steps ?? []) {
      const { LF, RF } = step.contacts
      if (LF?.kind === 'hold' && RF?.kind === 'hold') expect(LF.id).not.toBe(RF.id)
    }
    const start = steps![0].contacts
    const planted = [start.LF, start.RF].filter((f) => f?.kind === 'hold')
    const smearing = [start.LF, start.RF].filter((f) => f?.kind === 'smear')
    expect(planted).toHaveLength(1)
    expect(smearing).toHaveLength(1)
  })

  it('still starts when no footholds are marked', () => {
    const r = routeFromMeters(
      [
        { id: 's1', x: 1.3, y: 1.6 },
        { id: 's2', x: 1.7, y: 1.6 },
        { id: 'a', x: 1.5, y: 2.3 },
        { id: 'fin', x: 1.5, y: 3.0, radius: 0.035 },
      ],
      { start: ['s1', 's2'], finish: ['fin'] },
    )
    const res = planBeta(r, DEFAULT_CLIMBER)
    if (!res.ok) expect(res.reason).not.toMatch(/holdable start/)
    const steps = res.ok ? res.betas[0].steps : res.partial?.steps
    expect(steps?.[0].kind).toBe('start')
  })

  it('keeps feet uncrossed when each side has a foothold', () => {
    const r = routeFromMeters(
      [
        { id: 's1', x: 1.2, y: 1.55 },
        { id: 's2', x: 1.8, y: 1.55 },
        { id: 'a', x: 1.5, y: 2.35 },
        { id: 'fin', x: 1.5, y: 3.15, radius: 0.04 },
        { id: 'fl', x: 1.1, y: 0.4, type: 'foot-chip', radius: 0.012, allowHand: false },
        { id: 'fr', x: 1.9, y: 0.45, type: 'foot-chip', radius: 0.012, allowHand: false },
        { id: 'baitL', x: 1.25, y: 1.2, type: 'foot-chip', radius: 0.012, allowHand: false },
        { id: 'baitR', x: 1.75, y: 1.2, type: 'foot-chip', radius: 0.012, allowHand: false },
      ],
      { start: ['s1', 's2'], finish: ['fin'] },
    )
    const ctx = buildContext(r, DEFAULT_CLIMBER)
    const res = planBeta(r, DEFAULT_CLIMBER, { maxBetas: 1, timeBudgetMs: 5000 })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    const xOf = (id: string | null) => (id ? ctx.byId.get(id)?.x ?? null : null)
    for (const step of res.betas[0].steps) {
      const lf = step.contacts.LF
      const rf = step.contacts.RF
      const lx = lf?.kind === 'hold' ? xOf(lf.id) : lf?.kind === 'smear' ? lf.x : null
      const rx = rf?.kind === 'hold' ? xOf(rf.id) : rf?.kind === 'smear' ? rf.x : null
      if (lx != null && rx != null) expect(lx).toBeLessThanOrEqual(rx + 0.05)
    }
  })

  it('does not stand on an undercling or a downward-facing hold', () => {
    expect(canStandOn({ type: 'undercling', facingDeg: 180 })).toBe(false)
    expect(canStandOn({ type: 'edge', facingDeg: 180 })).toBe(false)
    expect(canStandOn({ type: 'jug', facingDeg: 0 })).toBe(true)
    expect(canStandOn({ type: 'volume', facingDeg: 180 })).toBe(true)
    const r = routeFromMeters(
      [
        { id: 's', x: 1.5, y: 1.5, type: 'jug' },
        { id: 'u', x: 1.5, y: 1.0, type: 'undercling', facingDeg: 180, allowFoot: true },
        { id: 'e', x: 1.6, y: 0.6, type: 'edge', facingDeg: 0, allowHand: false },
      ],
      { start: ['s'], finish: ['s'] },
    )
    const ctx = buildContext(r, DEFAULT_CLIMBER)
    expect(ctx.footHolds.map((h) => h.id)).not.toContain('u')
    expect(ctx.footHolds.map((h) => h.id)).toContain('e')
    expect(ctx.byId.get('u')?.patches.some((p) => p.role === 'foot-edge')).toBe(false)
  })

  it('flags each foot on its own side and keeps steps below the hands', () => {
    const r = routeFromMeters(
      [
        { id: 's1', x: 1.3, y: 1.6 },
        { id: 's2', x: 1.7, y: 1.6 },
      ],
      { start: ['s1', 's2'], finish: ['s2'] },
    )
    const ctx = buildContext(r, DEFAULT_CLIMBER)
    const pose = { x: 1.5, y: 1.15, lean: 0, stance: 'flag-outside-L' as const }
    const left = flagPoint(pose, ctx, 'LF')
    const right = flagPoint({ ...pose, stance: 'flag-outside-R' }, ctx, 'RF')
    expect(left.x).toBeLessThan(pose.x - 0.1)
    expect(right.x).toBeGreaterThan(pose.x + 0.1)
    expect(left.y).toBeLessThan(pose.y - 0.3)
    expect(right.y).toBeLessThan(pose.y - 0.3)
    const planner = new Planner(ctx, { beamWidth: 8, perHandPair: 2, maxDepth: 4, maxBetas: 1, timeBudgetMs: 1000 })
    const cap = planner.footYMax({ LH: 's1', RH: 's2', LF: null, RF: null })
    expect(cap).toBeLessThan(1.6 - 0.15)
    expect(cap).toBeGreaterThan(1.2)
  })

  it('steps the right foot out and gives its hold to the left foot', () => {
    const r = routeFromMeters(
      [
        { id: 's1', x: 1.3, y: 1.7 },
        { id: 's2', x: 1.7, y: 1.7 },
        { id: 'wasRight', x: 1.25, y: 0.7, type: 'edge', allowHand: false, radius: 0.016 },
        { id: 'left', x: 1.05, y: 0.65, type: 'edge', allowHand: false, radius: 0.016 },
        { id: 'out', x: 1.85, y: 0.72, type: 'edge', allowHand: false, radius: 0.016 },
      ],
      { start: ['s1', 's2'], finish: ['s2'] },
    )
    const ctx = buildContext(r, DEFAULT_CLIMBER)
    const planner = new Planner(ctx, { beamWidth: 8, perHandPair: 2, maxDepth: 4, maxBetas: 1, timeBudgetMs: 1000 })
    const pose = solvePose(
      { LH: 's1', RH: 's2', LF: { kind: 'hold', id: 'left' }, RF: { kind: 'hold', id: 'wasRight' } },
      ctx,
    ).pose
    const node = {
      key: 't',
      contacts: { LH: 's1', RH: 's2', LF: { kind: 'hold' as const, id: 'left' }, RF: { kind: 'hold' as const, id: 'wasRight' } },
      pose: { ...pose, x: 1.5 },
      stretch: {},
      statics: evaluateStatics(
        { LH: 's1', RH: 's2', LF: { kind: 'hold', id: 'left' }, RF: { kind: 'hold', id: 'wasRight' } },
        { ...pose, x: 1.5 },
        ctx,
      ),
      g: 0,
      h: 0,
      depth: 0,
      parent: null,
      move: null,
    }
    const swaps = planner.footSwaps(node)
    const stepped = swaps.find((c) => c.RF?.kind === 'hold' && c.RF.id === 'out' && c.LF?.kind === 'hold' && c.LF.id === 'wasRight')
    expect(stepped).toBeTruthy()
    const crossed = swaps.find((c) => {
      const lx = c.LF?.kind === 'hold' ? ctx.byId.get(c.LF.id)?.x : null
      const rx = c.RF?.kind === 'hold' ? ctx.byId.get(c.RF.id)?.x : null
      return lx != null && rx != null && lx > rx
    })
    expect(crossed).toBeUndefined()
  })

  it('matches instead of crossing, and prefers a nearby foothold', () => {
    const r = routeFromMeters(
      [
        { id: 's1', x: 1.2, y: 1.6 },
        { id: 's2', x: 1.8, y: 1.6 },
        { id: 'far', x: 2.25, y: 2.15 },
        { id: 'fin', x: 2.1, y: 3.05, radius: 0.04 },
        { id: 'jug', x: 1.45, y: 0.7, type: 'jug', radius: 0.03 },
        { id: 'chip', x: 1.55, y: 0.62, type: 'foot-chip', radius: 0.012, allowHand: false },
        { id: 'f2', x: 1.9, y: 0.55, type: 'foot-chip', radius: 0.012, allowHand: false },
      ],
      { start: ['s1', 's2'], finish: ['fin'] },
    )
    const ctx = buildContext(r, DEFAULT_CLIMBER)
    const planner = new Planner(ctx, { beamWidth: 20, perHandPair: 4, maxDepth: 20, maxBetas: 1, timeBudgetMs: 4000 })
    const start = planner.startNodes().nodes[0]
    expect(start).toBeTruthy()
    const left = planner.candidates(start, 'LH').filter((id): id is string => typeof id === 'string')
    expect(left).toContain(start.contacts.RH)
    const planted = [start.contacts.LF, start.contacts.RF].filter((f) => f?.kind === 'hold').map((f) => (f && f.kind === 'hold' ? f.id : ''))
    if (planted.includes('jug') || planted.includes('chip')) expect(planted).toContain('chip')
    expect(planted).not.toContain('jug')
  })

  it('climbs a vertical jug ladder and explains each move', () => {
    const res = planBeta(ladder(0), DEFAULT_CLIMBER)
    expect(res.ok, res.ok ? '' : `${res.reason} ${res.diagnostics.join('; ')}`).toBe(true)
    if (!res.ok) return
    const beta = res.betas[0]
    const last = beta.steps.at(-1)!
    expect(last.contacts.LH).toBe(last.contacts.RH)
    expect(beta.steps[0].kind).toBe('start')
    expect(beta.steps.every((s) => s.title.length > 0)).toBe(true)
    expect(beta.steps.every((s) => s.statics.uMax <= 1)).toBe(true)
    expect(beta.summary).toMatch(/moves/)
  })

  it('is deterministic', () => {
    const a = planBeta(ladder(20), DEFAULT_CLIMBER)
    const b = planBeta(ladder(20), DEFAULT_CLIMBER)
    const strip = (r: typeof a) => JSON.stringify(r.ok ? r.betas : r.reason)
    expect(strip(a)).toBe(strip(b))
  })

  it('returns distinct alternatives when they exist', () => {
    const res = planBeta(ladder(0), DEFAULT_CLIMBER)
    expect(res.ok && res.betas.length).toBeGreaterThanOrEqual(2)
    if (!res.ok || res.betas.length < 2) return
    const hands = (i: number) =>
      res.betas[i].steps
        .filter((s) => s.limb === 'LH' || s.limb === 'RH')
        .map((s) => `${s.limb}:${s.contacts[s.limb as 'LH' | 'RH']}`)
        .join()
    const feet = (i: number) =>
      res.betas[i].steps
        .flatMap((s) => [s.contacts.LF, s.contacts.RF])
        .map((f) => (f?.kind === 'hold' ? f.id : f?.kind ?? '-'))
        .join()
    expect(hands(0) !== hands(1) || feet(0) !== feet(1)).toBe(true)
    expect(new Set(res.betas.map((b) => b.label))).toHaveLength(res.betas.length)
    expect(res.betas[0].label).toMatch(/Straight/)
  })

  it('finishes a hold that is only a short reach past the planted feet', () => {
    const r = routeFromMeters(
      [
        { id: 's1', x: 1.35, y: 1.5 },
        { id: 's2', x: 1.7, y: 1.5 },
        { id: 'a', x: 1.45, y: 2.55 },
        { id: 'b', x: 1.6, y: 3.45 },
        { id: 'fin', x: 1.5, y: 3.85, radius: 0.04 },
        { id: 'f1', x: 1.3, y: 0.45, type: 'foot-chip', radius: 0.012, allowHand: false },
        { id: 'f2', x: 1.75, y: 0.6, type: 'foot-chip', radius: 0.012, allowHand: false },
      ],
      { start: ['s1', 's2'], finish: ['fin'] },
    )
    const res = planBeta(r, DEFAULT_CLIMBER, { maxBetas: 1 })
    expect(res.ok, res.ok ? '' : `${res.reason} ${res.diagnostics.join(' | ')}`).toBe(true)
  })

  it('reports a reach failure when a gap is too big, and a taller climber makes it', () => {
    const gap = (dy: number) =>
      routeFromMeters(
        [
          { id: 's', x: 1.5, y: 1.7, radius: 0.04 },
          { id: 'fin', x: 1.5, y: 1.7 + dy, radius: 0.04 },
          { id: 'f1', x: 1.4, y: 0.5, type: 'edge', allowHand: false },
          { id: 'f2', x: 1.6, y: 0.5, type: 'edge', allowHand: false },
          { id: 'f3', x: 1.5, y: 0.95, type: 'edge', allowHand: false },
        ],
        { start: ['s'], finish: ['fin'] },
      )
    const res = planBeta(gap(1.6), DEFAULT_CLIMBER)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.diagnostics.join(' ')).toMatch(/reach|range|hold/)
    const tall: ClimberProfile = { ...DEFAULT_CLIMBER, heightM: inchesToM(80), wingspanM: inchesToM(84), style: 'dynamic', power: 1 }
    const shortRes = planBeta(gap(1.0), { ...DEFAULT_CLIMBER, heightM: 1.5, wingspanM: 1.5, style: 'static' })
    const tallRes = planBeta(gap(1.0), tall)
    expect(tallRes.ok).toBe(true)
    expect(shortRes.ok).toBe(false)
  })

  it(
    'solves both sample routes for the default climber',
    () => {
      for (const s of sampleRoutes) {
        const res = planBeta(s.load(), DEFAULT_CLIMBER, { maxBetas: 1, timeBudgetMs: 15000 })
        expect(res.ok, `${s.name}: ${res.ok ? '' : res.reason + ' ' + res.diagnostics.join('; ')}`).toBe(true)
      }
    },
    30000,
  )
})

/** Realistic terrain used to compare planner changes. Timings are machine-local. */
export const realismFixtures: { name: string; route: Route; expectOk: boolean }[] = [
  { name: 'vertical', route: ladder(0), expectOk: true },
  { name: 'slab', route: ladder(-12), expectOk: true },
  { name: 'overhang-30', route: ladder(30), expectOk: true },
  {
    name: 'sidepull-cluster',
    route: routeFromMeters(
      [
        { id: 's1', x: 1.15, y: 1.45, type: 'sidepull', facingDeg: 90, radius: 0.02 },
        { id: 's2', x: 1.35, y: 1.55, type: 'sidepull', facingDeg: 90, radius: 0.02 },
        { id: 'a', x: 1.2, y: 2.15, type: 'sidepull', facingDeg: 90, radius: 0.02 },
        { id: 'fin', x: 1.45, y: 2.85, type: 'jug', radius: 0.035 },
        { id: 'f1', x: 1.1, y: 0.55, type: 'edge', facingDeg: 90, radius: 0.012, allowHand: false },
        { id: 'f2', x: 1.28, y: 0.9, type: 'edge', facingDeg: 90, radius: 0.012, allowHand: false },
      ],
      { angle: 25, start: ['s1', 's2'], finish: ['fin'] },
    ),
    expectOk: true,
  },
  {
    name: 'sloper-high',
    route: routeFromMeters(
      [
        { id: 's1', x: 1.35, y: 1.4, type: 'jug' },
        { id: 's2', x: 1.7, y: 1.4, type: 'jug' },
        { id: 'sl', x: 1.5, y: 2.35, type: 'sloper', facingDeg: 0, radius: 0.04, difficulty: 3 },
        { id: 'fin', x: 1.5, y: 3.15, type: 'jug', radius: 0.035 },
        { id: 'f1', x: 1.4, y: 0.5, type: 'edge', allowHand: false, radius: 0.015 },
        { id: 'f2', x: 1.65, y: 0.7, type: 'edge', allowHand: false, radius: 0.015 },
      ],
      { angle: 15, start: ['s1', 's2'], finish: ['fin'] },
    ),
    expectOk: false,
  },
  {
    name: 'volume',
    route: routeFromMeters(
      [
        { id: 's1', x: 1.3, y: 1.4, type: 'jug' },
        { id: 's2', x: 1.75, y: 1.45, type: 'jug' },
        { id: 'vol', x: 1.5, y: 2.2, type: 'volume', facingDeg: 270, radius: 0.06, depthCm: 28 },
        { id: 'fin', x: 1.55, y: 3.2, type: 'jug', radius: 0.035 },
        { id: 'f1', x: 1.35, y: 0.45, type: 'foot-chip', radius: 0.012, allowHand: false },
        { id: 'f2', x: 1.7, y: 0.6, type: 'foot-chip', radius: 0.012, allowHand: false },
      ],
      { angle: 20, start: ['s1', 's2'], finish: ['fin'] },
    ),
    expectOk: false,
  },
]

describe('realism fixtures', () => {
  it('plans each terrain inside the interactive budget', () => {
    expect(PRE_CHANGE_BASELINE.map((row) => row.name)).toEqual(realismFixtures.map((f) => f.name))
    for (const f of realismFixtures) {
      const res = planBeta(f.route, DEFAULT_CLIMBER, { maxBetas: 1, timeBudgetMs: 8000 })
      expect(res.stats.ms, f.name).toBeLessThan(8000)
      if (f.expectOk) expect(res.ok, f.name).toBe(true)
    }
  })

  it('keeps a vertical jug ladder mostly square', () => {
    const res = planBeta(ladder(0), DEFAULT_CLIMBER, { maxBetas: 1 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const steps = res.betas[0].steps
    const square = steps.filter((s) => s.pose.stance === 'square').length
    expect(square).toBeGreaterThanOrEqual(steps.length / 2)
    expect(res.betas[0].summary).toMatch(/hips square|hip in|drop knee|flag/)
    const ctx = buildContext(ladder(0), DEFAULT_CLIMBER)
    for (const step of steps) {
      const drawn = skeletonFromPose(step.contacts, step.pose, ctx, { flag: step.statics.flag })
      const worse = drawn.overstretched.filter((l) => (step.stretch[l] ?? 0) <= 1.02)
      if (worse.length > 0) expect(step.caveats.join(' ')).toMatch(/drawn pose/)
      else expect(step.caveats.join(' ')).not.toMatch(/drawn pose/)
    }
  })
})

describe('hold patches', () => {
  it('gives a foot chip no heel and a volume several contacts', () => {
    const chip = buildContext(ladder(0), DEFAULT_CLIMBER).byId.get('f1')!
    expect(chip.patches.some((p) => p.role === 'heel' || p.role === 'hand')).toBe(false)
    expect(chip.patches.every((p) => p.role === 'foot-edge')).toBe(true)
    const vol = buildContext(realismFixtures.find((f) => f.name === 'volume')!.route, DEFAULT_CLIMBER).byId.get('vol')!
    expect(vol.patches.filter((p) => p.role === 'hand').length).toBeGreaterThan(1)
    expect(vol.patches.some((p) => p.role === 'heel')).toBe(true)
    expect(vol.patches.some((p) => p.role === 'smear')).toBe(true)
  })

  it('raises utilization when the pull goes off a sloper', () => {
    const route = realismFixtures.find((f) => f.name === 'sloper-high')!.route
    const sl = buildContext(route, DEFAULT_CLIMBER).byId.get('sl')!
    const off = handCapacity(sl, DEFAULT_CLIMBER, 15, { x: 0, y: -0.1, z: 0.35 }, 0.9)
    const intoWall = handCapacity(sl, DEFAULT_CLIMBER, 15, { x: 0, y: -0.45, z: -0.12 }, 0.9)
    expect(off).toBeLessThan(intoWall)
    const load = 0.4
    expect(load / off).toBeGreaterThan(load / intoWall)
  })

  it('rejects an unopposed sidepull and accepts one with an opposing foot', () => {
    const route = routeFromMeters(
      [
        { id: 'sp', x: 1.2, y: 1.6, type: 'sidepull', facingDeg: 90, radius: 0.02 },
        { id: 'f', x: 1.15, y: 0.8, type: 'edge', facingDeg: 90, radius: 0.015, allowHand: false },
        { id: 'opp', x: 1.15, y: 0.9, type: 'edge', facingDeg: 270, radius: 0.015, allowHand: false },
      ],
      { start: ['sp'], finish: ['sp'] },
    )
    const ctx = buildContext(route, DEFAULT_CLIMBER)
    const pose = { x: 1.85, y: 1.15, lean: 0, stance: 'square' as const }
    const bare: Contacts = { LH: 'sp', RH: null, LF: { kind: 'hold', id: 'f' }, RF: null }
    const bad = evaluateStatics(bare, pose, ctx)
    expect(bad.barnDoor).toBeGreaterThan(0.08)
    expect(bad.opposed).toBe(false)
    const helped = evaluateStatics({ ...bare, LF: { kind: 'hold', id: 'opp' } }, pose, ctx)
    expect(helped.opposed).toBe(true)
  })
})

describe('stances', () => {
  it('drop knee reaches past square hips and is not labeled a dyno', () => {
    const make = (y: number) =>
      routeFromMeters(
        [
          { id: 's1', x: 1.25, y: 1.65, type: 'jug' },
          { id: 's2', x: 1.6, y: 1.65, type: 'jug' },
          { id: 'up', x: 1.9, y, type: 'jug', radius: 0.04 },
          { id: 'hi', x: 1.05, y: 1.5, type: 'edge', radius: 0.016, allowHand: false },
          { id: 'lo', x: 1.7, y: 0.85, type: 'edge', radius: 0.016, allowHand: false },
        ],
        { start: ['s1', 's2'], finish: ['up'] },
      )
    const opts = { beamWidth: 8, perHandPair: 2, maxDepth: 8, maxBetas: 1, timeBudgetMs: 2000 }
    let movedStance = ''
    const notes: string[] = []
    for (let y = 2.7; y <= 3.3; y += 0.05) {
      const candidate = make(Number(y.toFixed(2)))
      const c = buildContext(candidate, DEFAULT_CLIMBER)
      const contacts: Contacts = { LH: 's1', RH: 'up', LF: { kind: 'hold', id: 'hi' }, RF: { kind: 'hold', id: 'lo' } }
      const sq = solvePose(contacts, c, 'square').feasible
      const hip = solvePose(contacts, c, 'hip-in-L').feasible
      const dk = solvePose(contacts, c, 'drop-knee-L').feasible
      const planner = new Planner(c, opts)
      const start = planner.startNodes().nodes.find((n) => n.contacts.LF?.kind === 'hold' && n.contacts.LF.id === 'hi')
      const moved = start ? planner.tryMove(start, 'RH', 'up', new Map()) : 'no start'
      const stance = typeof moved === 'string' ? moved : `${moved.pose.stance}${moved.move?.dynamic ? ' dyn' : ''}`
      notes.push(`${y.toFixed(2)} sq=${sq} hip=${hip} dk=${dk} move=${stance}`)
      if (!sq && !hip && dk && typeof moved !== 'string' && moved.pose.stance === 'drop-knee-L' && !moved.move?.dynamic) {
        movedStance = stance
        break
      }
    }
    expect(movedStance, notes.join('\n')).toBe('drop-knee-L')
    const gateRoute = make(2.9)
    const gateCtx = buildContext(gateRoute, DEFAULT_CLIMBER)
    const planted: Contacts = { LH: 's1', RH: 'up', LF: { kind: 'hold', id: 'hi' }, RF: { kind: 'hold', id: 'lo' } }
    const stiff = solvePose(planted, buildContext(gateRoute, { ...DEFAULT_CLIMBER, flexibility: 0 }), 'drop-knee-L')
    expect(stiff.feasible).toBe(false)
    expect(stiff.violations.join(' ')).toMatch(/flexibility/)
    expect(stanceGate({ ...planted, LF: { kind: 'smear', x: 1.05, y: 1.4 } }, 'drop-knee-L', gateCtx).ok).toBe(false)
  })

  it('flags the outside leg on the swing side harder than the old constant', () => {
    const route = routeFromMeters(
      [
        { id: 'a', x: 1.2, y: 1.6, type: 'jug' },
        { id: 'b', x: 1.35, y: 1.65, type: 'jug' },
        { id: 'f', x: 1.25, y: 0.8, type: 'edge', allowHand: false, radius: 0.015 },
      ],
      { start: ['a', 'b'], finish: ['b'] },
    )
    const ctx = buildContext(route, DEFAULT_CLIMBER)
    const contacts: Contacts = { LH: 'a', RH: 'b', LF: { kind: 'hold', id: 'f' }, RF: null }
    const pose = { x: 1.75, y: 1.1, lean: 0, stance: 'square' as const }
    const square = evaluateStatics(contacts, pose, ctx)
    const correct = evaluateStatics(contacts, { ...pose, stance: 'flag-outside-R' }, ctx)
    const wrong = evaluateStatics(
      { LH: 'a', RH: 'b', LF: null, RF: { kind: 'hold', id: 'f' } },
      { ...pose, stance: 'flag-outside-L' },
      ctx,
    )
    const oldReduction = 0.12 + 0.1 * DEFAULT_CLIMBER.flexibility
    expect(square.barnDoor - correct.barnDoor).toBeGreaterThan(oldReduction)
    expect(correct.barnDoor).toBeLessThan(wrong.barnDoor)
  })

  it('prefers a straight hip-in on an overhang to a bent square stance', () => {
    const ctx = buildContext(ladder(30), DEFAULT_CLIMBER)
    const hold = ctx.byId.get('a')!
    const statics = {
      uMax: 0.4,
      hands: [],
      handShare: 0.6,
      barnDoor: 0,
      flag: null,
      opposed: true,
      feet: [
        { limb: 'LF' as const, effectiveness: 0.8 },
        { limb: 'RF' as const, effectiveness: 0.8 },
      ],
    } satisfies Statics
    const square = tacticCost({ x: 1.5, y: 1.2, lean: 0, stance: 'square' }, { LH: 0.5, RH: 0.55 }, statics, ctx, false, hold)
    const hip = tacticCost({ x: 1.5, y: 1.2, lean: 0, stance: 'hip-in-L' }, { LH: 0.88, RH: 0.9 }, statics, ctx, false, hold)
    expect(hip).toBeLessThan(square)
  })
})

describe('deadpoints', () => {
  it('dynos a gap past a static reach, and a static climber cannot', () => {
    expect(dynamicGain({ ...DEFAULT_CLIMBER, style: 'static' })).toBe(0)
    const jumping = { ...DEFAULT_CLIMBER, style: 'dynamic' as const, power: 1 }
    const planted = { ...DEFAULT_CLIMBER, style: 'static' as const, power: 0 }
    const opts = { beamWidth: 6, perHandPair: 2, maxDepth: 6, maxBetas: 1, timeBudgetMs: 2000 }
    const make = (y: number) =>
      routeFromMeters(
        [
          { id: 's1', x: 1.15, y: 1.6, type: 'jug', radius: 0.04 },
          { id: 's2', x: 1.5, y: 1.6, type: 'jug', radius: 0.04 },
          { id: 'up', x: y, y: 1.85, type: 'jug', radius: 0.045 },
          { id: 'f1', x: 1.2, y: 0.7, type: 'edge', allowHand: false, radius: 0.016 },
          { id: 'f2', x: 1.55, y: 0.85, type: 'edge', allowHand: false, radius: 0.016 },
        ],
        { start: ['s1', 's2'], finish: ['up'] },
      )
    const reach = (profile: ClimberProfile, y: number) => {
      const ctx = buildContext(make(y), profile)
      const planner = new Planner(ctx, opts)
      const start = planner.startNodes().nodes[0]
      if (!start) return 'no start'
      const moved = planner.tryMove(start, 'RH', 'up', new Map())
      return typeof moved === 'string' ? moved : moved
    }
    let found = false
    const notes: string[] = []
    for (let y = 2.75; y <= 2.95; y += 0.01) {
      const dyn = reach(jumping, Number(y.toFixed(2)))
      const stat = reach(planted, Number(y.toFixed(2)))
      const dynText = typeof dyn === 'string' ? dyn : dyn.move?.dynamic ? 'dyno' : dyn.pose.stance
      const statText = typeof stat === 'string' ? stat : stat.pose.stance
      notes.push(`${y.toFixed(2)} dyn=${dynText} stat=${statText}`)
      if (typeof dyn !== 'string' && dyn.move?.dynamic && typeof stat === 'string') {
        found = true
        expect(stat).toMatch(/reach|range|deadpoint|catch|hold/)
        break
      }
    }
    expect(found, notes.join('\n')).toBe(true)
  })

  it('treats a press on a wide upward jug as a mantle', () => {
    const jug = buildContext(ladder(0), DEFAULT_CLIMBER).byId.get('fin')!
    expect(isMantle(jug, 0.25)).toBe(true)
    const sloper = buildContext(realismFixtures.find((f) => f.name === 'sloper-high')!.route, DEFAULT_CLIMBER).byId.get('sl')!
    expect(isMantle(sloper, 0.25)).toBe(false)
  })
})
