import type { z } from 'zod'
import { ROUTE_FORMAT, ROUTE_SCHEMA_VERSION, RouteSchema, type Route } from './schema'
import { validateRoute, type RouteIssue } from './route'

export interface SerializeOptions {
  /** Embed the photo as a data URL (portable but large). Default true. */
  embedImage?: boolean
  now?: string
}

export function serializeRoute(route: Route, opts: SerializeOptions = {}): string {
  const out: Route = {
    ...route,
    updatedAt: opts.now ?? new Date().toISOString(),
    image: { ...route.image, dataUrl: opts.embedImage === false ? null : route.image.dataUrl },
  }
  return JSON.stringify(out, null, 2)
}

export type ParseResult =
  | { ok: true; route: Route; issues: RouteIssue[]; migratedFrom?: number }
  | { ok: false; errors: string[] }

/**
 * Upgrade steps keyed by the version they upgrade *from*. Each step receives
 * the raw object at version N and returns it at version N + 1.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path
      .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
      .join('')
    return path ? `${path}: ${issue.message}` : issue.message
  })
}

export function parseRouteJson(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] }
  }
  return parseRouteObject(raw)
}

export function parseRouteObject(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['Expected a JSON object at the top level.'] }
  }
  let obj = raw as Record<string, unknown>
  if (obj.format !== ROUTE_FORMAT) {
    return { ok: false, errors: [`Not a Crux route file (expected "format": "${ROUTE_FORMAT}").`] }
  }
  const version = obj.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ['Missing or invalid "schemaVersion".'] }
  }
  if (version > ROUTE_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `This file uses schema version ${version}, but this app only understands up to ${ROUTE_SCHEMA_VERSION}. Update Crux to open it.`,
      ],
    }
  }
  let current = version
  while (current < ROUTE_SCHEMA_VERSION) {
    const step = MIGRATIONS[current]
    if (!step) return { ok: false, errors: [`No migration available from schema version ${current}.`] }
    obj = { ...step(obj), schemaVersion: current + 1 }
    current += 1
  }

  const parsed = RouteSchema.safeParse(obj)
  if (!parsed.success) return { ok: false, errors: formatZodIssues(parsed.error) }

  const issues = validateRoute(parsed.data)
  const errors = issues.filter((i) => i.level === 'error').map((i) => i.message)
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    route: parsed.data,
    issues,
    ...(version !== ROUTE_SCHEMA_VERSION ? { migratedFrom: version } : {}),
  }
}

export function routeFileName(route: Route): string {
  const slug = route.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'route'}.crux.json`
}
