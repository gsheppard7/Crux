import type { ContactPatch, HoldType, PatchRole } from '../model/schema'
import type { PlannerHold } from './types'

/**
 * Contact spots derived from the fields a user can actually set.
 * Normals and cone angles are planning priors. A photo does not measure
 * friction, incut, or the usable lip.
 */
const SHAPE: Record<HoldType, { nz: number; cone: number }> = {
  jug: { nz: 0.45, cone: 70 },
  edge: { nz: 0.28, cone: 42 },
  crimp: { nz: 0.18, cone: 28 },
  sloper: { nz: 0.86, cone: 78 },
  pinch: { nz: 0.4, cone: 100 },
  pocket: { nz: 0.22, cone: 30 },
  undercling: { nz: 0.22, cone: 36 },
  sidepull: { nz: 0.22, cone: 34 },
  volume: { nz: 0.35, cone: 50 },
  'foot-chip': { nz: 0.3, cone: 32 },
  unknown: { nz: 0.5, cone: 85 },
}

/** Protrusion at which a non-jug is treated as having a lip a heel can use. */
const LIP_M = 0.05

const REF_SEP = '@'

export function hasLip(hold: Pick<PlannerHold, 'type' | 'depth'>): boolean {
  if (hold.type === 'sloper' || hold.type === 'foot-chip' || hold.type === 'pinch' || hold.type === 'crimp') return false
  if (hold.type === 'jug' || hold.type === 'volume') return true
  return hold.depth >= LIP_M
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function unit(x: number, y: number, z: number): { nx: number; ny: number; nz: number } {
  const len = Math.hypot(x, y, z) || 1
  return { nx: x / len, ny: y / len, nz: z / len }
}

/** Outward normal from a facing angle and an out-of-wall component. */
export function normalFromFacing(facingDeg: number | null, nz: number): { nx: number; ny: number; nz: number } {
  const z = clamp(nz, -0.95, 0.95)
  const inPlane = Math.sqrt(Math.max(0, 1 - z * z))
  if (facingDeg === null) return unit(0, inPlane * 0.2, z)
  const f = (facingDeg * Math.PI) / 180
  return unit(Math.sin(f) * inPlane, Math.cos(f) * inPlane, z)
}

function widthOf(hold: Pick<PlannerHold, 'r'>): number {
  return Math.max(0.02, hold.r * 2)
}

function patch(
  id: string,
  role: PatchRole,
  hold: Pick<PlannerHold, 'r' | 'facingDeg'>,
  dx: number,
  dy: number,
  dz: number,
  nz: number,
  coneDeg: number,
  widthM = widthOf(hold),
): ContactPatch {
  return { id, role, dx, dy, dz, ...normalFromFacing(hold.facingDeg, nz), coneDeg, widthM }
}

export function derivePatches(hold: Pick<PlannerHold, 'type' | 'facingDeg' | 'depth' | 'r' | 'hand' | 'foot'>): ContactPatch[] {
  const shape = SHAPE[hold.type]
  const lip = hasLip(hold)
  if (hold.type === 'foot-chip' || !hold.hand) {
    return hold.foot ? [patch('foot', 'foot-edge', hold, 0, 0, hold.depth * 0.4, shape.nz, shape.cone, Math.max(0.015, hold.r * 2))] : []
  }
  if (hold.type === 'volume') {
    const out: ContactPatch[] = [
      patch('lip', 'hand', { ...hold, facingDeg: hold.facingDeg ?? 0 }, 0, hold.r * 0.65, hold.depth * 0.35, 0.4, 55, Math.max(0.08, hold.r * 1.4)),
      patch('lip-heel', 'heel', { ...hold, facingDeg: hold.facingDeg ?? 0 }, 0, hold.r * 0.7, hold.depth * 0.45, 0.35, 40, Math.max(0.06, hold.r)),
      patch('face', 'smear', { ...hold, facingDeg: null }, 0, 0, hold.depth * 0.55, 0.9, 55, Math.max(0.08, hold.r * 1.6)),
    ]
    if (hold.foot) out.push(patch('lip-foot', 'foot-edge', { ...hold, facingDeg: 0 }, 0, hold.r * 0.55, hold.depth * 0.3, 0.4, 45, Math.max(0.04, hold.r)))
    if (hold.facingDeg !== null) {
      const f = (hold.facingDeg * Math.PI) / 180
      out.push(
        patch('side', 'hand', hold, Math.sin(f) * hold.r * 0.7, Math.cos(f) * hold.r * 0.2, hold.depth * 0.3, shape.nz, shape.cone, Math.max(0.05, hold.r)),
      )
    }
    return out
  }
  if (hold.type === 'sloper') {
    const out: ContactPatch[] = [patch('hand', 'hand', hold, 0, 0, hold.depth * 0.45, shape.nz, shape.cone)]
    if (hold.foot) out.push(patch('foot', 'smear', hold, 0, -hold.r * 0.2, hold.depth * 0.35, 0.8, 60, Math.max(0.03, hold.r)))
    return out
  }
  const out: ContactPatch[] = []
  if (hold.hand) out.push(patch('hand', 'hand', hold, 0, 0, hold.depth * 0.35, shape.nz, shape.cone))
  if (hold.foot && hold.type !== 'pinch') out.push(patch('foot', 'foot-edge', hold, 0, -hold.r * 0.15, hold.depth * 0.25, Math.min(0.55, shape.nz + 0.1), shape.cone))
  if (lip && hold.hand) out.push(patch('heel', 'heel', hold, 0, hold.r * 0.35, hold.depth * 0.5, 0.3, 36, Math.max(0.03, hold.r)))
  return out
}

export function patchesOfRole(hold: PlannerHold, role: PatchRole): ContactPatch[] {
  return hold.patches.filter((p) => p.role === role)
}

export function primaryPatch(hold: { patches: ContactPatch[] }, kind: 'hand' | 'foot'): ContactPatch | undefined {
  if (kind === 'hand') return hold.patches.find((p) => p.role === 'hand')
  return hold.patches.find((p) => p.role === 'foot-edge' || p.role === 'smear' || p.role === 'heel' || p.role === 'toe')
}

export function patchById(hold: PlannerHold, id: string | null | undefined): ContactPatch | undefined {
  if (!id) return undefined
  return hold.patches.find((p) => p.id === id)
}

/** Primary hand spot keeps the bare hold id so existing contact keys still match. */
export function handTarget(hold: PlannerHold, patchId: string): string {
  const primary = primaryPatch(hold, 'hand')
  if (!primary || patchId === primary.id) return hold.id
  return `${hold.id}${REF_SEP}${patchId}`
}

export function parseRef(ref: string | null | undefined): { id: string; patch: string | null } | null {
  if (!ref) return null
  const i = ref.indexOf(REF_SEP)
  if (i < 0) return { id: ref, patch: null }
  return { id: ref.slice(0, i), patch: ref.slice(i + 1) }
}

export function holdIdOf(ref: string | null | undefined): string | null {
  return parseRef(ref)?.id ?? null
}

export function handPatch(hold: PlannerHold, ref: string | null | undefined): ContactPatch | undefined {
  const wanted = parseRef(ref)?.patch
  return (wanted && patchById(hold, wanted)) || primaryPatch(hold, 'hand')
}

export function footPatch(hold: PlannerHold, patchId: string | null | undefined): ContactPatch | undefined {
  return (patchId && patchById(hold, patchId)) || primaryPatch(hold, 'foot')
}

/**
 * True when some reaction inside the cone has a horizontal component against
 * the swing. `swingSign` +1 means the mass is to the right of every contact.
 * This is a dot-product test, not a friction measurement.
 */
export function patchCanOppose(patch: ContactPatch, swingSign: -1 | 1): boolean {
  const along = clamp(patch.nx * swingSign, -1, 1)
  const alpha = (patch.coneDeg * Math.PI) / 180
  const lateral = Math.sqrt(Math.max(0, 1 - along * along))
  const best = along * Math.cos(alpha) - Math.sin(alpha) * lateral
  return best < -0.25
}
