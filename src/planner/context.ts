import type { Hold, Route } from '../model/schema'
import { wallFrame } from '../model/coords'
import { bodyDims, type ClimberProfile } from '../climber/profile'
import { DEFAULT_DEPTH_CM } from './grip'
import type { PlannerContext, PlannerHold } from './types'

/** Body offsets from the wall plane when reaching (chest in) and standing (hips). */
export const SHOULDER_WALL_OFFSET = 0.15
export const HIP_WALL_OFFSET = 0.18

const MATCHABLE_TYPES = new Set(['jug', 'volume', 'sloper'])

export function toPlannerHold(h: Hold, route: Route): PlannerHold {
  const frame = wallFrame(route.image, route.wall)
  const p = frame.toWall(h)
  const r = h.radius * route.image.width * route.wall.metersPerPixel
  return {
    id: h.id,
    label: h.label,
    x: p.x,
    y: p.y,
    r,
    depth: (h.depthCm ?? DEFAULT_DEPTH_CM[h.type]) / 100,
    type: h.type,
    facingDeg: h.facingDeg,
    difficulty: h.difficulty,
    hand: h.allowHand,
    foot: h.allowFoot,
    matchable: h.type !== 'foot-chip' && (MATCHABLE_TYPES.has(h.type) || 2 * r >= 0.09),
    confidence: h.confidence,
    source: h.source,
  }
}

/**
 * Which holds the planner may use:
 *  - hands: in-route holds that allow hands, plus any volume;
 *  - feet: holds that allow feet; with "feet follow hands" only in-route
 *    holds and volumes. The bare wall (smearing) is always available.
 */
export function buildContext(route: Route, profile: ClimberProfile): PlannerContext {
  const frame = wallFrame(route.image, route.wall)
  const dims = bodyDims(profile)
  const holds: PlannerHold[] = []
  const handHolds: PlannerHold[] = []
  const footHolds: PlannerHold[] = []
  for (const h of route.holds) {
    const ph = toPlannerHold(h, route)
    if (ph.y < -0.05) continue
    const inPlay = h.inRoute || h.type === 'volume'
    const hand = ph.hand && inPlay
    const foot = ph.foot && (route.footRule === 'open' || inPlay)
    if (!hand && !foot) continue
    const usable = { ...ph, hand, foot }
    holds.push(usable)
    if (hand) handHolds.push(usable)
    if (foot) footHolds.push(usable)
  }
  const byId = new Map(holds.map((h) => [h.id, h]))
  return {
    holds,
    byId,
    handHolds,
    footHolds,
    startIds: route.startHoldIds.filter((id) => byId.has(id)),
    finishIds: route.finishHoldIds.filter((id) => byId.get(id)?.hand),
    angleDeg: route.wall.angleDeg,
    frame,
    profile,
    dims,
    handReach: Math.sqrt(dims.arm ** 2 - SHOULDER_WALL_OFFSET ** 2),
    footReach: Math.sqrt(dims.leg ** 2 - HIP_WALL_OFFSET ** 2),
    scaleCalibrated: route.wall.scaleSource !== 'default',
  }
}
