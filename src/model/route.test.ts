import { describe, expect, it } from 'vitest'
import {
  addHold,
  createEmptyRoute,
  createHold,
  holdRole,
  holdsByHeight,
  MAX_HOLD_RADIUS,
  moveHold,
  nextHoldLabel,
  removeHold,
  replaceImage,
  setWall,
  toggleFinish,
  toggleInRoute,
  toggleStart,
  updateHold,
  validateRoute,
} from './route'
import type { Route } from './schema'

const image = { name: 'wall.jpg', width: 1000, height: 1500, dataUrl: null }

function routeWith(...holds: ReturnType<typeof createHold>[]): Route {
  return holds.reduce(addHold, createEmptyRoute({ image, id: 'r1', now: '2026-01-01T00:00:00.000Z' }))
}

describe('hold modifications', () => {
  it('adds holds with sequential labels', () => {
    const r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.2 }), createHold({ id: 'b', u: 0.3, v: 0.4 }))
    expect(r.holds.map((h) => h.label)).toEqual(['1', '2'])
    expect(nextHoldLabel(r)).toBe('3')
  })

  it('does not mutate the input route', () => {
    const r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.2 }))
    const frozen = JSON.stringify(r)
    moveHold(r, 'a', { u: 0.9, v: 0.9 })
    removeHold(r, 'a')
    toggleStart(r, 'a')
    expect(JSON.stringify(r)).toBe(frozen)
  })

  it('moves and clamps coordinates to the image', () => {
    const r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.2 }))
    expect(moveHold(r, 'a', { u: 0.55, v: 0.66 }).holds[0]).toMatchObject({ u: 0.55, v: 0.66 })
    expect(moveHold(r, 'a', { u: 1.4, v: -0.2 }).holds[0]).toMatchObject({ u: 1, v: 0 })
  })

  it('normalizes edited metadata', () => {
    const r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.2 }))
    const h = updateHold(r, 'a', { radius: 9, facingDeg: -90, difficulty: 7.4, confidence: 3, depthCm: -1 }).holds[0]
    expect(h.radius).toBe(MAX_HOLD_RADIUS)
    expect(h.facingDeg).toBe(270)
    expect(h.difficulty).toBe(5)
    expect(h.confidence).toBe(1)
    expect(h.depthCm).toBe(0)
  })

  it('returns the same route when the hold does not exist', () => {
    const r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.2 }))
    expect(updateHold(r, 'zzz', { u: 0.5 })).toBe(r)
    expect(removeHold(r, 'zzz')).toBe(r)
  })

  it('removing a hold also removes it from start/finish', () => {
    let r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.9 }), createHold({ id: 'b', u: 0.1, v: 0.1 }))
    r = toggleFinish(toggleStart(r, 'a'), 'b')
    r = removeHold(removeHold(r, 'a'), 'b')
    expect(r.startHoldIds).toEqual([])
    expect(r.finishHoldIds).toEqual([])
  })

  it('start/finish toggles force route membership; leaving the route clears them', () => {
    let r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.9, inRoute: false }))
    r = toggleStart(r, 'a')
    expect(r.holds[0].inRoute).toBe(true)
    expect(holdRole(r, r.holds[0])).toBe('start')
    r = toggleFinish(r, 'a')
    expect(holdRole(r, r.holds[0])).toBe('start-finish')
    r = toggleInRoute(r, 'a')
    expect(r.startHoldIds).toEqual([])
    expect(r.finishHoldIds).toEqual([])
    expect(holdRole(r, r.holds[0])).toBe('off-route')
    expect(toggleStart(toggleStart(r, 'a'), 'a').startHoldIds).toEqual([])
  })

  it('orders holds bottom-to-top', () => {
    const r = routeWith(createHold({ id: 'top', u: 0.5, v: 0.1 }), createHold({ id: 'low', u: 0.5, v: 0.9 }))
    expect(holdsByHeight(r).map((h) => h.id)).toEqual(['low', 'top'])
  })

  it('setWall clamps angle and rejects invalid scale', () => {
    const r = routeWith()
    expect(setWall(r, { angleDeg: 120 }).wall.angleDeg).toBe(90)
    expect(setWall(r, { metersPerPixel: -1 }).wall.metersPerPixel).toBe(r.wall.metersPerPixel)
  })

  it('replaceImage preserves calibrated real-world width across resolutions', () => {
    let r = routeWith(createHold({ id: 'a', u: 0.25, v: 0.5 }))
    r = setWall(r, { metersPerPixel: 0.004, scaleSource: 'wall-width' }) // 4 m wide
    const half = replaceImage(r, { ...image, width: 500, height: 750 }, true)
    expect(half.wall.metersPerPixel * 500).toBeCloseTo(4)
    expect(half.holds[0]).toMatchObject({ u: 0.25, v: 0.5 })
    expect(replaceImage(r, image, false).holds).toEqual([])
  })
})

describe('semantic validation', () => {
  it('flags missing start/finish as warnings', () => {
    const r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.2 }))
    const msgs = validateRoute(r).map((i) => `${i.level}:${i.message}`)
    expect(msgs).toContain('warning:No start hold selected.')
    expect(msgs).toContain('warning:No finish hold selected.')
  })

  it('flags dangling references and duplicates as errors', () => {
    const r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.2 }))
    const bad: Route = { ...r, holds: [...r.holds, r.holds[0]], startHoldIds: ['ghost'] }
    const errors = validateRoute(bad).filter((i) => i.level === 'error')
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining(['Duplicate hold id "a".', 'Start references missing hold "ghost".']),
    )
  })

  it('a complete route has no errors or warnings', () => {
    let r = routeWith(createHold({ id: 'a', u: 0.1, v: 0.9 }), createHold({ id: 'b', u: 0.1, v: 0.1 }))
    r = toggleFinish(toggleStart(r, 'a'), 'b')
    r = setWall(r, { scaleSource: 'wall-width' })
    expect(validateRoute(r).filter((i) => i.level !== 'info')).toEqual([])
  })
})
