import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commit, createHistory, HISTORY_LIMIT, redo, undo } from './history'

describe('history', () => {
  it('undoes and redoes', () => {
    let h = createHistory(1)
    h = commit(h, 2, { now: 0 })
    h = commit(h, 3, { now: 10_000 })
    expect(h.present).toBe(3)
    h = undo(h)
    expect(h.present).toBe(2)
    h = undo(h)
    expect(h.present).toBe(1)
    expect(canUndo(h)).toBe(false)
    h = redo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(true)
  })

  it('a new commit clears the redo stack', () => {
    let h = commit(createHistory('a'), 'b')
    h = undo(h)
    h = commit(h, 'c')
    expect(canRedo(h)).toBe(false)
    expect(h.past).toEqual(['a'])
  })

  it('coalesces rapid edits with the same key', () => {
    let h = createHistory(0)
    h = commit(h, 1, { coalesceKey: 'k', now: 0 })
    h = commit(h, 2, { coalesceKey: 'k', now: 500 })
    h = commit(h, 3, { coalesceKey: 'k', now: 1000 })
    expect(h.past).toEqual([0])
    h = commit(h, 4, { coalesceKey: 'k', now: 5000 })
    expect(h.past).toEqual([0, 3])
  })

  it('sticky keys coalesce regardless of time (one drag = one undo step)', () => {
    let h = createHistory(0)
    h = commit(h, 1, { coalesceKey: 'drag1', sticky: true, now: 0 })
    h = commit(h, 2, { coalesceKey: 'drag1', sticky: true, now: 60_000 })
    expect(h.past).toEqual([0])
    expect(undo(h).present).toBe(0)
  })

  it('undo breaks coalescing', () => {
    let h = createHistory(0)
    h = commit(h, 1, { coalesceKey: 'k', now: 0 })
    h = undo(h)
    h = commit(h, 2, { coalesceKey: 'k', now: 1 })
    expect(h.past).toEqual([0])
    expect(h.present).toBe(2)
  })

  it('ignores no-op commits and caps history length', () => {
    let h = createHistory(0)
    expect(commit(h, 0)).toBe(h)
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = commit(h, i)
    expect(h.past.length).toBe(HISTORY_LIMIT)
  })
})
