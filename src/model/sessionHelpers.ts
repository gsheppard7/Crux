import type { ClimbSession } from './session'
import type { PlanResult } from '../planner/types'

/** Helper for parents restoring from `route.session`. */
export function sessionPlan(session: ClimbSession | null | undefined): {
  plan: PlanResult | null
  betaIndex: number
  stamp: string
} {
  if (!session) return { plan: null, betaIndex: 0, stamp: '' }
  const plan = session.plan as PlanResult | null
  return { plan, betaIndex: session.betaIndex, stamp: session.stamp }
}
