import { describe, expect, it } from 'vitest'
import { parseRouteJson, routeFileName, serializeRoute } from './serialize'
import { addHold, createEmptyRoute, createHold, toggleFinish, toggleStart } from './route'
import { RouteSchema } from './schema'
import { sampleRoutes } from '../samples/sampleRoutes'
import minimalFixture from '../../fixtures/minimal-route.crux.json?raw'

function makeRoute() {
  let r = createEmptyRoute({
    image: { name: 'wall.jpg', width: 1234, height: 1777, dataUrl: 'data:image/jpeg;base64,AAAA' },
    id: 'r1',
    name: 'Test Problem!',
    now: '2026-01-01T00:00:00.000Z',
  })
  // Awkward floats that would expose any rounding in the save path.
  r = addHold(r, createHold({ id: 'a', u: 0.1 + 0.2, v: 1 / 3, radius: Math.PI / 100, facingDeg: 45 }))
  r = addHold(r, createHold({ id: 'b', u: 0.7071067811865476, v: 0.012345678901234567 }))
  return toggleFinish(toggleStart(r, 'a'), 'b')
}

describe('JSON serialization', () => {
  it('round-trips without coordinate drift', () => {
    const r = makeRoute()
    const text = serializeRoute(r, { now: '2026-02-02T00:00:00.000Z' })
    const parsed = parseRouteJson(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.route).toEqual({ ...r, updatedAt: '2026-02-02T00:00:00.000Z' })
    expect(parsed.route.holds[0].u).toBe(0.1 + 0.2)
    expect(parsed.route.holds[1].v).toBe(0.012345678901234567)
  })

  it('is stable across repeated save/load cycles', () => {
    let text = serializeRoute(makeRoute(), { now: 'x' })
    for (let i = 0; i < 5; i++) {
      const p = parseRouteJson(text)
      if (!p.ok) throw new Error(p.errors.join())
      const next = serializeRoute(p.route, { now: 'x' })
      expect(next).toBe(text)
      text = next
    }
  })

  it('can omit the embedded image', () => {
    const p = parseRouteJson(serializeRoute(makeRoute(), { embedImage: false }))
    expect(p.ok && p.route.image.dataUrl).toBe(null)
  })

  it('every sample route is valid and round-trips', () => {
    for (const s of sampleRoutes) {
      const route = s.load()
      expect(RouteSchema.safeParse(route).success).toBe(true)
      const p = parseRouteJson(serializeRoute(route, { now: route.updatedAt }))
      expect(p.ok).toBe(true)
      if (p.ok) {
        expect(p.route).toEqual(route)
        expect(p.issues.filter((i) => i.level !== 'info')).toEqual([])
      }
    }
  })

  it('builds a safe file name', () => {
    expect(routeFileName(makeRoute())).toBe('test-problem.crux.json')
    expect(routeFileName({ ...makeRoute(), name: '***' })).toBe('route.crux.json')
  })
})

describe('fixtures', () => {
  it('fixtures/minimal-route.crux.json parses cleanly', () => {
    const p = parseRouteJson(minimalFixture)
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.route.schemaVersion).toBe(2)
      expect(p.route.session).toBe(null)
      expect(p.route.holds).toHaveLength(5)
      expect(p.issues.filter((i) => i.level !== 'info')).toEqual([])
    }
  })
})

describe('import validation', () => {
  const valid = () => JSON.parse(serializeRoute(makeRoute())) as Record<string, unknown>

  it('rejects malformed JSON', () => {
    const p = parseRouteJson('{nope')
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.errors[0]).toMatch(/Not valid JSON/)
  })

  it('rejects non-route JSON', () => {
    expect(parseRouteJson('[1,2]').ok).toBe(false)
    const p = parseRouteJson('{"hello":"world"}')
    expect(!p.ok && p.errors[0]).toMatch(/Not a Crux route file/)
  })

  it('rejects files from a newer schema version', () => {
    const p = parseRouteJson(JSON.stringify({ ...valid(), schemaVersion: 99 }))
    expect(!p.ok && p.errors[0]).toMatch(/schema version 99/)
  })

  it('rejects missing schema version', () => {
    const { schemaVersion: _v, ...rest } = valid()
    expect(!parseRouteJson(JSON.stringify(rest)).ok).toBe(true)
  })

  it('reports out-of-range hold fields with a path', () => {
    const obj = valid()
    const holds = obj.holds as Record<string, unknown>[]
    holds[1] = { ...holds[1], u: 1.5, type: 'banana' }
    const p = parseRouteJson(JSON.stringify(obj))
    expect(p.ok).toBe(false)
    if (!p.ok) {
      expect(p.errors.some((e) => e.startsWith('holds[1].u:'))).toBe(true)
      expect(p.errors.some((e) => e.startsWith('holds[1].type:'))).toBe(true)
    }
  })

  it('rejects dangling start/finish references', () => {
    const p = parseRouteJson(JSON.stringify({ ...valid(), finishHoldIds: ['ghost'] }))
    expect(!p.ok && p.errors[0]).toMatch(/missing hold "ghost"/)
  })

  it('rejects non-image data URLs', () => {
    const obj = valid()
    obj.image = { ...(obj.image as object), dataUrl: 'data:text/html,<script>' }
    expect(parseRouteJson(JSON.stringify(obj)).ok).toBe(false)
  })

  it('fills optional text fields with defaults', () => {
    const obj = valid()
    delete obj.notes
    delete obj.grade
    const holds = obj.holds as Record<string, unknown>[]
    delete holds[0].note
    const p = parseRouteJson(JSON.stringify(obj))
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.route.notes).toBe('')
      expect(p.route.holds[0].note).toBe('')
    }
  })
})
