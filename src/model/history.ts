export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** Key + time of the last committed change, used to coalesce rapid edits. */
  lastKey: string | null
  lastAt: number
}

export const HISTORY_LIMIT = 200
export const COALESCE_WINDOW_MS = 1200

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 }
}

/**
 * Commit a new state. Consecutive commits sharing a `coalesceKey` within the
 * time window (e.g. drag ticks, slider scrubs, typing in one field) replace
 * the present instead of creating a new undo step. `sticky` keys (unique per
 * gesture, e.g. one drag) coalesce regardless of elapsed time.
 */
export function commit<T>(
  h: History<T>,
  next: T,
  opts: { coalesceKey?: string; sticky?: boolean; now?: number } = {},
): History<T> {
  if (Object.is(next, h.present)) return h
  const now = opts.now ?? Date.now()
  const key = opts.coalesceKey ?? null
  if (key !== null && key === h.lastKey && (opts.sticky || now - h.lastAt <= COALESCE_WINDOW_MS)) {
    return { ...h, present: next, future: [], lastAt: now }
  }
  const past = [...h.past, h.present]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return { past, present: next, future: [], lastKey: key, lastAt: now }
}

/** Replace the whole history (e.g. on load) without an undo step. */
export function reset<T>(present: T): History<T> {
  return createHistory(present)
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  const past = h.past.slice(0, -1)
  return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null, lastAt: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const [present, ...future] = h.future
  return { past: [...h.past, h.present], present, future, lastKey: null, lastAt: 0 }
}

export const canUndo = <T,>(h: History<T>) => h.past.length > 0
export const canRedo = <T,>(h: History<T>) => h.future.length > 0
