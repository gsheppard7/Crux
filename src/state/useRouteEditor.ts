import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Route } from '../model/schema'
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from '../model/history'
import { parseRouteJson, serializeRoute } from '../model/serialize'
import { loadDefaultSample } from '../samples/sampleRoutes'

export const DRAFT_STORAGE_KEY = 'crux:draft:v1'

export interface CommitOptions {
  coalesceKey?: string
  sticky?: boolean
}

type Action =
  | { type: 'commit'; route: Route; opts?: CommitOptions }
  | { type: 'apply'; fn: (r: Route) => Route; opts?: CommitOptions }
  | { type: 'undo' }
  | { type: 'redo' }

function reducer(state: History<Route>, action: Action): History<Route> {
  switch (action.type) {
    case 'commit':
      return commit(state, action.route, action.opts)
    case 'apply':
      return commit(state, action.fn(state.present), action.opts)
    case 'undo':
      return undo(state)
    case 'redo':
      return redo(state)
  }
}

export type DraftStatus = 'saved' | 'saved-without-image' | 'failed' | 'idle'

export function loadDraft(storage: Storage | undefined = globalThis.localStorage): Route | null {
  try {
    const text = storage?.getItem(DRAFT_STORAGE_KEY)
    if (!text) return null
    const parsed = parseRouteJson(text)
    return parsed.ok ? parsed.route : null
  } catch {
    return null
  }
}

function saveDraft(route: Route): DraftStatus {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, serializeRoute(route))
    return 'saved'
  } catch {
    // Most likely a quota error from a large embedded photo.
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, serializeRoute(route, { embedImage: false }))
      return 'saved-without-image'
    } catch {
      return 'failed'
    }
  }
}

export function useRouteEditor(initial?: () => Route) {
  const [history, dispatch] = useReducer(reducer, undefined, () =>
    createHistory(initial ? initial() : (loadDraft() ?? loadDefaultSample())),
  )
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('idle')
  const route = history.present

  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDraftStatus(saveDraft(route)), 400)
    return () => window.clearTimeout(timer.current)
  }, [route])

  const apply = useCallback((fn: (r: Route) => Route, opts?: CommitOptions) => {
    dispatch({ type: 'apply', fn, opts })
  }, [])
  const replace = useCallback((next: Route) => dispatch({ type: 'commit', route: next }), [])
  const doUndo = useCallback(() => dispatch({ type: 'undo' }), [])
  const doRedo = useCallback(() => dispatch({ type: 'redo' }), [])

  return useMemo(
    () => ({
      route,
      apply,
      replace,
      undo: doUndo,
      redo: doRedo,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      draftStatus,
    }),
    [route, apply, replace, doUndo, doRedo, history, draftStatus],
  )
}

export type RouteEditor = ReturnType<typeof useRouteEditor>
