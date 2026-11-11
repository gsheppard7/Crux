import type { HoldRole } from '../model/route'
import type { HoldType } from '../model/schema'

export const ROLE_COLORS: Record<HoldRole, string> = {
  start: '#22c55e',
  finish: '#f43f5e',
  'start-finish': '#22c55e',
  route: '#facc15',
  'off-route': '#a8a29e',
}

export const ROLE_LABELS: Record<HoldRole, string> = {
  start: 'Start',
  finish: 'Finish',
  'start-finish': 'Start + finish',
  route: 'Route',
  'off-route': 'Off route',
}

export const HOLD_TYPE_LABELS: Record<HoldType, string> = {
  jug: 'Jug',
  crimp: 'Crimp',
  edge: 'Edge',
  sloper: 'Sloper',
  pinch: 'Pinch',
  pocket: 'Pocket',
  undercling: 'Undercling',
  sidepull: 'Sidepull',
  volume: 'Volume',
  'foot-chip': 'Foot chip',
  unknown: 'Unknown',
}
