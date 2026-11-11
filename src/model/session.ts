import { z } from 'zod'
import { ClimberProfileSchema, type ClimberProfile } from '../climber/profile'
import { DEFAULT_AVATAR_COLOR } from '../ui/avatarTheme'
import type { Beta, PlanResult } from '../planner/types'

const hex = z.string().regex(/^#[0-9a-f]{6}$/i)

/** Persisted with the route: climber snapshot, avatar color, and last beta plan. */
export const ClimbSessionSchema = z.object({
  climber: ClimberProfileSchema,
  avatarColor: hex,
  /** Full `planBeta` output, or null if no plan has been run yet. */
  plan: z.unknown().nullable(),
  betaIndex: z.number().int().min(0).default(0),
  /** Stamp of route + climber when `plan` was computed (for stale detection). */
  stamp: z.string().default(''),
})

export type ClimbSession = z.infer<typeof ClimbSessionSchema>

export function emptySession(climber: ClimberProfile, avatarColor = DEFAULT_AVATAR_COLOR): ClimbSession {
  return { climber, avatarColor, plan: null, betaIndex: 0, stamp: '' }
}

export function isPlanResult(v: unknown): v is PlanResult {
  if (!v || typeof v !== 'object') return false
  const o = v as PlanResult
  return typeof o.ok === 'boolean' && Array.isArray((o as { warnings?: unknown }).warnings)
}

export function parseClimbSession(raw: unknown): ClimbSession | null {
  const p = ClimbSessionSchema.safeParse(raw)
  if (!p.success) return null
  if (p.data.plan != null && !isPlanResult(p.data.plan)) return { ...p.data, plan: null }
  return p.data
}

export function sessionFromParts(
  climber: ClimberProfile,
  avatarColor: string,
  plan: PlanResult | null,
  betaIndex: number,
  stamp: string,
): ClimbSession {
  return { climber, avatarColor, plan, betaIndex, stamp }
}

export function betasFromSession(session: ClimbSession | null | undefined): Beta[] {
  if (!session?.plan || !isPlanResult(session.plan)) return []
  const p = session.plan
  return p.ok ? p.betas : p.partial ? [p.partial] : []
}
