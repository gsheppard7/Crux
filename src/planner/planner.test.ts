import { describe, expect, it } from 'vitest'
import { addHold, createEmptyRoute, createHold, setWall, toggleFinish, toggleStart } from '../model/route'
import type { Hold, Route } from '../model/schema'
import { bodyDims, DEFAULT_CLIMBER, inchesToM, type ClimberProfile } from '../climber/profile'
import { sampleRoutes } from '../samples/sampleRoutes'
import { buildContext } from './context'
import { evaluateStatics, solvePose } from './body'
import { directionFactor, holdGripSummary } from './grip'
import { planBeta } from './search'
import type { Contacts } from './types'

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
    if (res.ok && res.betas.length >= 2) {
      const seq = (i: number) => res.betas[i].steps.map((s) => `${s.limb}:${s.limb ? JSON.stringify(s.contacts[s.limb]) : ''}`).join()
      expect(seq(0)).not.toBe(seq(1))
    }
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
