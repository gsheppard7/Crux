import {
  ROUTE_FORMAT,
  ROUTE_SCHEMA_VERSION,
  type FootRule,
  type Hold,
  type Route,
  type RouteImage,
  type Wall,
} from './schema'
import { clamp, defaultMetersPerPixel } from './coords'

export const DEFAULT_HOLD_RADIUS = 0.022
export const MIN_HOLD_RADIUS = 0.004
export const MAX_HOLD_RADIUS = 0.25

export function createId(prefix = 'h'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `${prefix}_${rand}`
}

export function createEmptyRoute(opts: {
  image: RouteImage
  name?: string
  id?: string
  now?: string
}): Route {
  const now = opts.now ?? new Date().toISOString()
  return {
    format: ROUTE_FORMAT,
    schemaVersion: ROUTE_SCHEMA_VERSION,
    id: opts.id ?? createId('r'),
    name: opts.name ?? 'Untitled route',
    grade: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    image: opts.image,
    wall: {
      angleDeg: 0,
      metersPerPixel: defaultMetersPerPixel(opts.image),
      scaleSource: 'default',
    },
    footRule: 'open',
    holds: [],
    startHoldIds: [],
    finishHoldIds: [],
  }
}

export function createHold(fields: Partial<Hold> & Pick<Hold, 'u' | 'v'>): Hold {
  return {
    id: fields.id ?? createId('h'),
    label: fields.label ?? '',
    u: clamp(fields.u, 0, 1),
    v: clamp(fields.v, 0, 1),
    radius: clamp(fields.radius ?? DEFAULT_HOLD_RADIUS, MIN_HOLD_RADIUS, MAX_HOLD_RADIUS),
    type: fields.type ?? 'unknown',
    facingDeg: fields.facingDeg ?? null,
    inRoute: fields.inRoute ?? true,
    allowHand: fields.allowHand ?? true,
    allowFoot: fields.allowFoot ?? true,
    difficulty: fields.difficulty ?? null,
    depthCm: fields.depthCm ?? null,
    confidence: fields.confidence ?? 1,
    source: fields.source ?? 'manual',
    note: fields.note ?? '',
  }
}

export function nextHoldLabel(route: Route): string {
  const max = route.holds.reduce((acc, h) => {
    const n = Number.parseInt(h.label, 10)
    return Number.isFinite(n) && String(n) === h.label.trim() ? Math.max(acc, n) : acc
  }, 0)
  return String(max + 1)
}

export function addHold(route: Route, hold: Hold): Route {
  const labelled = hold.label ? hold : { ...hold, label: nextHoldLabel(route) }
  return { ...route, holds: [...route.holds, labelled] }
}

export function getHold(route: Route, id: string | null | undefined): Hold | undefined {
  return id ? route.holds.find((h) => h.id === id) : undefined
}

function normalizeFacing(deg: number | null): number | null {
  if (deg === null || !Number.isFinite(deg)) return null
  return ((Math.round(deg) % 360) + 360) % 360
}

export function updateHold(route: Route, id: string, patch: Partial<Omit<Hold, 'id'>>): Route {
  let changed = false
  const holds = route.holds.map((h) => {
    if (h.id !== id) return h
    changed = true
    const next: Hold = { ...h, ...patch }
    next.u = clamp(next.u, 0, 1)
    next.v = clamp(next.v, 0, 1)
    next.radius = clamp(next.radius, MIN_HOLD_RADIUS, MAX_HOLD_RADIUS)
    next.confidence = clamp(next.confidence, 0, 1)
    next.facingDeg = normalizeFacing(next.facingDeg)
    if (next.difficulty !== null) next.difficulty = clamp(Math.round(next.difficulty), 1, 5)
    if (next.depthCm !== null) next.depthCm = clamp(next.depthCm, 0, 200)
    return next
  })
  if (!changed) return route
  let next = { ...route, holds }
  const updated = getHold(next, id)
  // Leaving the route also drops start/finish membership.
  if (updated && !updated.inRoute) {
    next = {
      ...next,
      startHoldIds: next.startHoldIds.filter((x) => x !== id),
      finishHoldIds: next.finishHoldIds.filter((x) => x !== id),
    }
  }
  return next
}

export function moveHold(route: Route, id: string, to: { u: number; v: number }): Route {
  return updateHold(route, id, to)
}

export function removeHold(route: Route, id: string): Route {
  if (!getHold(route, id)) return route
  return {
    ...route,
    holds: route.holds.filter((h) => h.id !== id),
    startHoldIds: route.startHoldIds.filter((x) => x !== id),
    finishHoldIds: route.finishHoldIds.filter((x) => x !== id),
  }
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

/** Toggling a hold into start/finish also puts it in the route. */
export function toggleStart(route: Route, id: string): Route {
  const hold = getHold(route, id)
  if (!hold) return route
  const startHoldIds = toggleIn(route.startHoldIds, id)
  const holds = startHoldIds.includes(id) && !hold.inRoute
    ? route.holds.map((h) => (h.id === id ? { ...h, inRoute: true } : h))
    : route.holds
  return { ...route, holds, startHoldIds }
}

export function toggleFinish(route: Route, id: string): Route {
  const hold = getHold(route, id)
  if (!hold) return route
  const finishHoldIds = toggleIn(route.finishHoldIds, id)
  const holds = finishHoldIds.includes(id) && !hold.inRoute
    ? route.holds.map((h) => (h.id === id ? { ...h, inRoute: true } : h))
    : route.holds
  return { ...route, holds, finishHoldIds }
}

export function toggleInRoute(route: Route, id: string): Route {
  const hold = getHold(route, id)
  return hold ? updateHold(route, id, { inRoute: !hold.inRoute }) : route
}

export function setWall(route: Route, patch: Partial<Wall>): Route {
  const wall = { ...route.wall, ...patch }
  wall.angleDeg = clamp(wall.angleDeg, -45, 90)
  if (!(wall.metersPerPixel > 0) || !Number.isFinite(wall.metersPerPixel)) {
    wall.metersPerPixel = route.wall.metersPerPixel
  }
  return { ...route, wall }
}

export function setMeta(
  route: Route,
  patch: Partial<Pick<Route, 'name' | 'grade' | 'notes'>> & { footRule?: FootRule },
): Route {
  return { ...route, ...patch }
}

/**
 * Swap the photo. Hold coordinates are normalized, so they survive any
 * resolution change; they only stay *aligned* if the aspect ratio matches.
 */
export function replaceImage(route: Route, image: RouteImage, keepHolds: boolean): Route {
  const next: Route = { ...route, image }
  if (route.wall.scaleSource === 'default') {
    next.wall = { ...route.wall, metersPerPixel: defaultMetersPerPixel(image) }
  } else {
    // Preserve the calibrated real-world wall width across a resolution change.
    const widthM = route.image.width * route.wall.metersPerPixel
    next.wall = { ...route.wall, metersPerPixel: widthM / image.width }
  }
  if (!keepHolds) {
    next.holds = []
    next.startHoldIds = []
    next.finishHoldIds = []
  }
  return next
}

export function aspectRatioMismatch(a: { width: number; height: number }, b: { width: number; height: number }): number {
  return Math.abs(a.width / a.height - b.width / b.height) / (a.width / a.height)
}

export type HoldRole = 'start' | 'finish' | 'start-finish' | 'route' | 'off-route'

export function holdRole(route: Route, hold: Hold): HoldRole {
  const s = route.startHoldIds.includes(hold.id)
  const f = route.finishHoldIds.includes(hold.id)
  if (s && f) return 'start-finish'
  if (s) return 'start'
  if (f) return 'finish'
  return hold.inRoute ? 'route' : 'off-route'
}

/** Holds ordered bottom-to-top (rough climbing order), then left-to-right. */
export function holdsByHeight(route: Route): Hold[] {
  return [...route.holds].sort((a, b) => b.v - a.v || a.u - b.u)
}

// ---------------------------------------------------------------------------
// Semantic validation (beyond the structural Zod schema)
// ---------------------------------------------------------------------------

export interface RouteIssue {
  level: 'error' | 'warning' | 'info'
  message: string
  holdId?: string
}

export function validateRoute(route: Route): RouteIssue[] {
  const issues: RouteIssue[] = []
  const ids = new Set<string>()
  for (const h of route.holds) {
    if (ids.has(h.id)) issues.push({ level: 'error', message: `Duplicate hold id "${h.id}".`, holdId: h.id })
    ids.add(h.id)
  }
  for (const [list, name] of [
    [route.startHoldIds, 'Start'],
    [route.finishHoldIds, 'Finish'],
  ] as const) {
    for (const id of list) {
      if (!ids.has(id)) issues.push({ level: 'error', message: `${name} references missing hold "${id}".` })
    }
    if (new Set(list).size !== list.length) {
      issues.push({ level: 'error', message: `${name} hold list contains duplicates.` })
    }
  }
  for (const h of route.holds) {
    const name = `Hold ${h.label || h.id}`
    if (!h.allowHand && !h.allowFoot) {
      issues.push({ level: 'warning', message: `${name} allows neither hands nor feet.`, holdId: h.id })
    }
    if ((route.startHoldIds.includes(h.id) || route.finishHoldIds.includes(h.id)) && !h.inRoute) {
      issues.push({ level: 'error', message: `${name} is start/finish but not in the route.`, holdId: h.id })
    }
    if (route.finishHoldIds.includes(h.id) && !h.allowHand) {
      issues.push({ level: 'warning', message: `${name} is a finish hold but hands are not allowed.`, holdId: h.id })
    }
    if (route.startHoldIds.includes(h.id) && route.finishHoldIds.includes(h.id)) {
      issues.push({ level: 'warning', message: `${name} is both start and finish.`, holdId: h.id })
    }
  }
  const routeHolds = route.holds.filter((h) => h.inRoute)
  if (route.holds.length === 0) {
    issues.push({ level: 'info', message: 'No holds yet. Use the Add tool or double-click the photo.' })
  } else {
    if (route.startHoldIds.length === 0) issues.push({ level: 'warning', message: 'No start hold selected.' })
    if (route.finishHoldIds.length === 0) issues.push({ level: 'warning', message: 'No finish hold selected.' })
    const startHands = route.startHoldIds.filter((id) => getHold(route, id)?.allowHand).length
    if (startHands > 2) {
      issues.push({ level: 'warning', message: `${startHands} hand-start holds marked; most problems start on 1–2.` })
    }
    if (route.finishHoldIds.length > 2) {
      issues.push({ level: 'warning', message: 'More than 2 finish holds marked.' })
    }
    if (route.footRule === 'route-only' && !routeHolds.some((h) => h.allowFoot)) {
      issues.push({ level: 'warning', message: 'Feet are restricted to route holds, but no route hold allows feet.' })
    }
  }
  if (route.wall.scaleSource === 'default') {
    issues.push({ level: 'info', message: 'Scale is uncalibrated (assumes the photo spans ~4.5 m of wall).' })
  }
  return issues
}
