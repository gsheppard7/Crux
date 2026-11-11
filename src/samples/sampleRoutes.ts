import { ROUTE_FORMAT, ROUTE_SCHEMA_VERSION, type Hold, type Route } from '../model/schema'
import { createHold } from '../model/route'
import { renderWallSvg } from './wallArt'

const W = 1200
const H = 1600
const SAMPLE_DATE = '2026-11-01T12:00:00.000Z'

type Spec = Partial<Hold> & Pick<Hold, 'u' | 'v' | 'radius'> & { key: string; stretch?: number }

interface SampleDef {
  id: string
  name: string
  grade: string
  notes: string
  angleDeg: number
  wallWidthM: number
  footRule: Route['footRule']
  color: string
  base: string
  baseDark: string
  seed: number
  holds: Spec[]
  offRoute: (Spec & { color: string })[]
  start: string[]
  finish: string[]
}

const foot = (key: string, u: number, v: number, radius = 0.012): Spec => ({
  key,
  u,
  v,
  radius,
  type: 'foot-chip',
  allowHand: false,
  allowFoot: true,
  depthCm: 2,
  difficulty: 2,
})

const footEdge = (key: string, u: number, v: number): Spec => ({
  ...foot(key, u, v, 0.016),
  type: 'edge',
  facingDeg: 0,
  depthCm: 3,
})

const SAMPLES: SampleDef[] = [
  {
    id: 'sample-tangerine-ladder',
    name: 'Tangerine Ladder',
    grade: 'V1',
    notes: 'Vertical warm-up on big orange jugs. Start matched-ish on the two jugs, top out on the big finish jug.',
    angleDeg: 0,
    wallWidthM: 3.6,
    footRule: 'open',
    color: '#f97316',
    base: '#d6d3d1',
    baseDark: '#a8a29e',
    seed: 11,
    holds: [
      { key: 's1', u: 0.42, v: 0.66, radius: 0.03, type: 'jug', facingDeg: 0, difficulty: 1, depthCm: 7 },
      { key: 's2', u: 0.56, v: 0.645, radius: 0.028, type: 'jug', facingDeg: 0, difficulty: 1, depthCm: 7 },
      { key: 'h3', u: 0.35, v: 0.53, radius: 0.026, type: 'jug', facingDeg: 10, difficulty: 1, depthCm: 6 },
      { key: 'h4', u: 0.59, v: 0.47, radius: 0.022, type: 'edge', facingDeg: 0, difficulty: 2, depthCm: 3, stretch: 1.5 },
      { key: 'h5', u: 0.44, v: 0.37, radius: 0.026, type: 'sidepull', facingDeg: 270, difficulty: 2, depthCm: 5 },
      { key: 'h6', u: 0.63, v: 0.275, radius: 0.025, type: 'jug', facingDeg: 0, difficulty: 1, depthCm: 6 },
      { key: 'h7', u: 0.47, v: 0.18, radius: 0.028, type: 'jug', facingDeg: 0, difficulty: 1, depthCm: 6 },
      { key: 'fin', u: 0.53, v: 0.075, radius: 0.034, type: 'jug', facingDeg: 0, difficulty: 1, depthCm: 8, stretch: 1.3 },
      foot('f1', 0.4, 0.86),
      foot('f2', 0.58, 0.845, 0.014),
      foot('f3', 0.48, 0.77),
    ],
    offRoute: [
      { key: 'x1', u: 0.2, v: 0.4, radius: 0.02, type: 'crimp', color: '#ec4899', inRoute: false, difficulty: 4, depthCm: 2, note: 'Pink problem — off route.' },
    ],
    start: ['s1', 's2'],
    finish: ['fin'],
  },
  {
    id: 'sample-blue-crimp-traverse',
    name: 'Blue Crimp Traverse',
    grade: 'V4',
    notes:
      'Rising traverse on a 25° overhang. Feet follow hands: only blue holds for feet. Matched start on the low positive edge, finish on the jug.',
    angleDeg: 25,
    wallWidthM: 4.2,
    footRule: 'route-only',
    color: '#2563eb',
    base: '#57534e',
    baseDark: '#292524',
    seed: 42,
    holds: [
      { key: 'st', u: 0.17, v: 0.62, radius: 0.026, type: 'edge', facingDeg: 0, difficulty: 2, depthCm: 3, stretch: 1.4 },
      { key: 'b2', u: 0.3, v: 0.55, radius: 0.019, type: 'crimp', facingDeg: 0, difficulty: 3, depthCm: 2, stretch: 1.4 },
      { key: 'b3', u: 0.43, v: 0.5, radius: 0.024, type: 'pinch', facingDeg: 90, difficulty: 3, depthCm: 5, stretch: 0.7 },
      { key: 'b4', u: 0.55, v: 0.415, radius: 0.03, type: 'sloper', facingDeg: null, difficulty: 3, depthCm: 6 },
      { key: 'b5', u: 0.66, v: 0.47, radius: 0.022, type: 'undercling', facingDeg: 180, difficulty: 3, depthCm: 3 },
      { key: 'b6', u: 0.76, v: 0.355, radius: 0.018, type: 'crimp', facingDeg: 0, difficulty: 3, depthCm: 2, stretch: 1.5 },
      { key: 'b7', u: 0.86, v: 0.24, radius: 0.021, type: 'edge', facingDeg: 330, difficulty: 3, depthCm: 3 },
      { key: 'fin', u: 0.79, v: 0.115, radius: 0.03, type: 'jug', facingDeg: 0, difficulty: 1, depthCm: 7, stretch: 1.2 },
      footEdge('ft1', 0.12, 0.86),
      footEdge('ft2', 0.25, 0.81),
      footEdge('ft3', 0.36, 0.765),
      footEdge('ft4', 0.47, 0.725),
      footEdge('ft5', 0.58, 0.695),
      footEdge('ft6', 0.68, 0.64),
      footEdge('ft7', 0.78, 0.6),
      footEdge('ft8', 0.9, 0.55),
    ],
    offRoute: [],
    start: ['st'],
    finish: ['fin'],
  },
]

function buildSample(def: SampleDef): Route {
  const toHold = (s: Spec, i: number, inRoute: boolean): Hold => {
    const { key, stretch, ...rest } = s
    return createHold({
      ...rest,
      id: `${def.id}:${key}`,
      label: rest.label ?? String(i + 1),
      inRoute: rest.inRoute ?? inRoute,
      source: 'sample',
      confidence: 1,
    })
  }
  const holds = [
    ...def.holds.map((s, i) => toHold(s, i, true)),
    ...def.offRoute.map((s, i) => toHold({ ...s, label: `x${i + 1}` }, i, false)),
  ]
  const dataUrl = renderWallSvg({
    width: W,
    height: H,
    seed: def.seed,
    base: def.base,
    baseDark: def.baseDark,
    distractorColors: ['#16a34a', '#a855f7', '#dc2626', '#f5f5f4', '#14b8a6', '#1c1917'],
    distractorCount: 34,
    holds: [
      ...def.holds.map((s, i) => ({ u: s.u, v: s.v, r: s.radius, color: def.color, seed: def.seed * 100 + i, stretch: s.stretch })),
      ...def.offRoute.map((s, i) => ({ u: s.u, v: s.v, r: s.radius, color: s.color, seed: def.seed * 1000 + i })),
    ],
  })
  return {
    format: ROUTE_FORMAT,
    schemaVersion: ROUTE_SCHEMA_VERSION,
    id: def.id,
    name: def.name,
    grade: def.grade,
    notes: def.notes,
    createdAt: SAMPLE_DATE,
    updatedAt: SAMPLE_DATE,
    image: { name: `${def.id}.svg`, width: W, height: H, dataUrl },
    wall: { angleDeg: def.angleDeg, metersPerPixel: def.wallWidthM / W, scaleSource: 'wall-width', floorV: null },
    footRule: def.footRule,
    holds,
    startHoldIds: def.start.map((k) => `${def.id}:${k}`),
    finishHoldIds: def.finish.map((k) => `${def.id}:${k}`),
    session: null,
  }
}

export interface SampleInfo {
  id: string
  name: string
  grade: string
  load: () => Route
}

export const sampleRoutes: SampleInfo[] = SAMPLES.map((def) => ({
  id: def.id,
  name: def.name,
  grade: def.grade,
  load: () => buildSample(def),
}))

export const loadDefaultSample = (): Route => sampleRoutes[0].load()
