import { HOLD_TYPE_LABELS } from '../ui/theme'
import type { Contacts, FootContact, Limb, MoveKind, PlannerContext, PlannerHold, Statics } from './types'

export const LIMB_NAMES: Record<Limb, string> = { LH: 'left hand', RH: 'right hand', LF: 'left foot', RF: 'right foot' }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function holdName(h: PlannerHold | undefined): string {
  if (!h) return 'hold'
  return `${h.label ? `#${h.label} ` : ''}${HOLD_TYPE_LABELS[h.type].toLowerCase()}`
}

export function effortLabel(u: number): string {
  if (u < 0.45) return 'easy'
  if (u < 0.7) return 'moderate'
  if (u < 0.88) return 'hard'
  if (u <= 1.0) return 'max effort'
  return 'beyond capacity'
}

function footText(f: FootContact, ctx: PlannerContext): string {
  if (!f) return 'free'
  if (f.kind === 'smear') return 'smearing'
  return `on ${holdName(ctx.byId.get(f.id))}`
}

export function feetSummary(c: Contacts, ctx: PlannerContext): string {
  return `Feet: left ${footText(c.LF, ctx)}, right ${footText(c.RF, ctx)}.`
}

/** Body-position hint for a directional hand hold, from its facing. */
function directionHint(h: PlannerHold, limb: Limb): string | null {
  const t = h.type
  if (t === 'undercling' || (h.facingDeg !== null && h.facingDeg >= 135 && h.facingDeg <= 225)) {
    return 'Undercling: keep it low relative to your body, get feet high and stand up into it.'
  }
  if (h.facingDeg !== null && ((h.facingDeg >= 45 && h.facingDeg < 135) || (h.facingDeg > 225 && h.facingDeg <= 315))) {
    const facesRight = h.facingDeg < 180
    const lean = facesRight ? 'left' : 'right'
    const gaston = (limb === 'LH' && !facesRight) || (limb === 'RH' && facesRight)
    return gaston
      ? `Gaston: elbow out, push ${facesRight ? 'right' : 'left'} against it while your body stays ${lean} of the hold.`
      : `Sidepull: lean ${lean} away from it and oppose with your feet.`
  }
  return null
}

const TYPE_HINT: Partial<Record<PlannerHold['type'], string>> = {
  crimp: 'Crimp it (half-crimp is kinder to fingers); hips close to the wall.',
  edge: 'Open-hand or half-crimp the edge.',
  sloper: 'Open hand, arm straight, hips low and under it; friction depends on body position.',
  pinch: 'Squeeze with the thumb; pinches are less direction-sensitive.',
  pocket: 'Choose the strongest fingers that fit.',
  jug: 'Good hold: a place to shake out.',
  volume: 'Use the volume’s edge or friction; it is always in play.',
}

export interface MoveDescriptionInput {
  kind: MoveKind
  limb: Limb | null
  contacts: Contacts
  statics: Statics
  uMid: number | null
  stretch: Partial<Record<Limb, number>>
  dynamic: boolean
  ctx: PlannerContext
}

export function describeMove(m: MoveDescriptionInput): { title: string; detail: string[]; caveats: string[] } {
  const { kind, limb, contacts, ctx } = m
  const detail: string[] = []
  const caveats: string[] = []

  if (kind === 'start' || !limb) {
    const lh = ctx.byId.get(contacts.LH ?? '')
    const rh = ctx.byId.get(contacts.RH ?? '')
    const title = contacts.LH === contacts.RH ? `Start matched on ${holdName(lh)}` : `Start: left hand ${holdName(lh)}, right hand ${holdName(rh)}`
    detail.push(feetSummary(contacts, ctx))
    detail.push(`Hands carry ~${Math.round(m.statics.handShare * 100)}% of your weight; grip effort ${Math.round(m.statics.uMax * 100)}% (${effortLabel(m.statics.uMax)}).`)
    return { title, detail, caveats }
  }

  const target = limb === 'LH' || limb === 'RH' ? contacts[limb] : null
  const hold = target ? ctx.byId.get(target) : undefined
  const foot = limb === 'LF' || limb === 'RF' ? contacts[limb] : null
  const footHold = foot && foot.kind === 'hold' ? ctx.byId.get(foot.id) : undefined
  const name = cap(LIMB_NAMES[limb])

  let title: string
  switch (kind) {
    case 'match':
      title = `Match ${holdName(hold)} with your ${LIMB_NAMES[limb]}`
      detail.push('Bring the second hand onto the hold; make room by shifting fingers over.')
      break
    case 'cross':
      title = `Cross ${LIMB_NAMES[limb]} over to ${holdName(hold)}`
      detail.push('Cross-through: turn the hips toward the moving hand to free up reach.')
      break
    case 'dyno':
      title = `Deadpoint ${LIMB_NAMES[limb]} to ${holdName(hold)}`
      detail.push('Sink low, drive with the legs and pull through; catch the hold at the top of the motion (deadpoint).')
      caveats.push('Dynamic move: a static lock-off here would exceed your estimated strength.')
      break
    case 'reach':
      title = `${name} → ${holdName(hold)}`
      break
    case 'high-step':
      title = `High-step ${LIMB_NAMES[limb]} to ${holdName(footHold)}`
      detail.push('Bring the knee up toward the chest, rock over the foot and stand up on it.')
      break
    case 'smear':
      title = `Smear ${LIMB_NAMES[limb]} on the wall`
      detail.push('Press the rubber flat against the wall; heel low, weight over the toes.')
      break
    case 'flag':
      title = `Flag ${limb === 'LF' ? 'left' : 'right'} leg`
      detail.push('Take the foot off and extend the leg as a counterweight to stop the body swinging (barn-dooring).')
      break
    case 'cut':
      title = `Cut feet (${LIMB_NAMES[limb]} off)`
      detail.push('Both feet come off: hold the swing with straight arms and tight core, then bring feet back on.')
      caveats.push('Feet-off position: hands carry all the weight.')
      break
    default:
      title = `${name} → ${holdName(footHold)}`
  }

  if (hold) {
    const hint = directionHint(hold, limb)
    if (hint) detail.push(hint)
    else if (TYPE_HINT[hold.type]) detail.push(TYPE_HINT[hold.type]!)
    const s = m.stretch[limb]
    if (s !== undefined && s > 0.95) {
      detail.push(`Near full extension (${Math.max(0, Math.round((1 - s) * ctx.handReach * 100))} cm to spare): get hips close to the wall and extend through the shoulder.`)
    }
    if (hold.confidence < 0.6 || hold.type === 'unknown') caveats.push(`${holdName(hold)} type/quality is a guess: check it in person.`)
  }

  if (limb === 'LH' || limb === 'RH' || kind === 'flag' || kind === 'cut') detail.push(feetSummary(contacts, ctx))
  if (m.statics.flag && kind !== 'flag') detail.push(`Flag the ${m.statics.flag === 'LF' ? 'left' : 'right'} leg for balance.`)
  if (m.statics.barnDoor > 0.08) caveats.push('Body sits outside the contacts: expect a barn-door swing; keep tension.')

  if (m.uMid !== null) {
    const moving = limb === 'LH' || limb === 'RH' ? 'the other hand' : 'your hands'
    detail.push(
      `While moving, ${moving} work at ~${Math.round(m.uMid * 100)}% of grip capacity (${effortLabel(m.uMid)}); after the move ${Math.round(m.statics.uMax * 100)}%.`,
    )
  }
  return { title, detail, caveats }
}
