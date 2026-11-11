import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyRoute, createHold, addHold, setSession } from '../model/route'
import { DEFAULT_CLIMBER } from '../climber/profile'
import { sessionFromParts } from '../model/session'
import { DEFAULT_AVATAR_COLOR } from '../ui/avatarTheme'
import { deleteClimb, listClimbs, loadClimb, saveClimb } from './library'

/** Minimal valid 1×1 PNG as a data URL. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function minimalRoute(id = 'r_lib_1') {
  let route = createEmptyRoute({
    id,
    name: 'Library Test',
    now: '2026-03-01T00:00:00.000Z',
    image: { name: 'tiny.png', width: 1, height: 1, dataUrl: TINY_PNG },
  })
  route = { ...route, grade: 'V2', wall: { ...route.wall, angleDeg: 15 } }
  route = addHold(route, createHold({ id: 'h1', u: 0.4, v: 0.6, label: '1' }))
  return route
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('crux')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    req.onblocked = () => resolve()
  })
})

describe('climb library', () => {
  it('save / list / load / delete round-trips a route', async () => {
    expect(await listClimbs()).toEqual([])

    const route = minimalRoute()
    const meta = await saveClimb(route)
    expect(meta.id).toBe(route.id)
    expect(meta.name).toBe('Library Test')
    expect(meta.grade).toBe('V2')
    expect(meta.holdCount).toBe(1)
    expect(meta.angleDeg).toBe(15)
    expect(meta.imageSignature).toBe(`tiny.png|1|1|${TINY_PNG.length}`)
    expect(meta.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const listed = await listClimbs()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(route.id)

    const loaded = await loadClimb(route.id)
    expect(loaded.id).toBe(route.id)
    expect(loaded.name).toBe('Library Test')
    expect(loaded.holds).toHaveLength(1)
    expect(loaded.holds[0].id).toBe('h1')
    expect(loaded.image.dataUrl).toBe(TINY_PNG)
    expect(loaded.wall.angleDeg).toBe(15)

    await deleteClimb(route.id)
    expect(await listClimbs()).toEqual([])
    await expect(loadClimb(route.id)).rejects.toThrow(/not found/i)
  })

  it('persists session (climber, avatar color, beta plan) with the route', async () => {
    const plan = {
      ok: true as const,
      betas: [],
      warnings: [],
      stats: { expanded: 0, ms: 0 },
    }
    const route = setSession(
      minimalRoute('r_session'),
      sessionFromParts(DEFAULT_CLIMBER, DEFAULT_AVATAR_COLOR, plan, 0, 'stamp-1'),
    )
    await saveClimb(route)
    const loaded = await loadClimb(route.id)
    expect(loaded.session?.climber.name).toBe(DEFAULT_CLIMBER.name)
    expect(loaded.session?.avatarColor).toBe(DEFAULT_AVATAR_COLOR)
    expect(loaded.session?.stamp).toBe('stamp-1')
    expect(loaded.session?.plan).toMatchObject({ ok: true })
  })

  it('lists climbs newest-first and reuses thumbs when the image is unchanged', async () => {
    const older = minimalRoute('r_old')
    const newer = minimalRoute('r_new')
    newer.name = 'Newer climb'

    const first = await saveClimb(older)
    await new Promise((r) => setTimeout(r, 5))
    await saveClimb(newer)

    const listed = await listClimbs()
    expect(listed.map((c) => c.id)).toEqual(['r_new', 'r_old'])

    const again = await saveClimb({ ...older, name: 'Renamed', grade: 'V3' })
    expect(again.imageSignature).toBe(first.imageSignature)
    expect(again.thumbDataUrl).toBe(first.thumbDataUrl)
    expect(again.name).toBe('Renamed')
    expect(again.grade).toBe('V3')
  })
})
