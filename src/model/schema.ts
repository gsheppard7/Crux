import { z } from 'zod'
import { ClimbSessionSchema } from './session'

/**
 * Route file format, version 1. See docs/route-schema.md for the full
 * description of every field and of the coordinate systems.
 *
 * Bump ROUTE_SCHEMA_VERSION on any breaking change and add a migration step
 * in serialize.ts.
 */
export const ROUTE_SCHEMA_VERSION = 2 as const
export const ROUTE_FORMAT = 'crux.route' as const

export const HOLD_TYPES = [
  'jug',
  'crimp',
  'edge',
  'sloper',
  'pinch',
  'pocket',
  'undercling',
  'sidepull',
  'volume',
  'foot-chip',
  'unknown',
] as const

export const HOLD_SOURCES = ['manual', 'sample', 'model'] as const
export const FOOT_RULES = ['open', 'route-only'] as const
export const SCALE_SOURCES = ['default', 'wall-width', 'reference-hold', 'floor-height'] as const

const unit = z.number().finite().min(0).max(1)

export const HoldSchema = z.object({
  id: z.string().min(1),
  /** Short user-facing label, e.g. "7" or "LH start". */
  label: z.string().max(40).default(''),
  /** Normalized image x in [0,1], left → right. */
  u: unit,
  /** Normalized image y in [0,1], top → bottom. */
  v: unit,
  /** Radius as a fraction of the image width. */
  radius: z.number().finite().gt(0).max(0.5),
  type: z.enum(HOLD_TYPES),
  /**
   * Direction the usable surface faces, in degrees clockwise from "up" in the
   * wall plane. 0 = faces up (down-pull), 90 = faces right, 180 = faces down
   * (undercling), 270 = faces left. null = unknown / omnidirectional.
   */
  facingDeg: z.number().finite().min(0).lt(360).nullable(),
  /** Member of the current problem (vs. other holds on the wall). */
  inRoute: z.boolean(),
  allowHand: z.boolean(),
  allowFoot: z.boolean(),
  /** Subjective grip difficulty 1 (easy) – 5 (hard); null = unknown. */
  difficulty: z.number().int().min(1).max(5).nullable(),
  /** Estimated protrusion from the wall surface in cm; null = unknown. */
  depthCm: z.number().finite().min(0).max(200).nullable(),
  /** Confidence in this annotation, 0–1. Manual annotations default to 1. */
  confidence: unit,
  source: z.enum(HOLD_SOURCES),
  note: z.string().max(500).default(''),
  /** Observed hold color as #rrggbb (set by auto-detection), or null. */
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .default(null),
})

export const RouteImageSchema = z.object({
  name: z.string(),
  /** Pixel dimensions of the image the normalized coordinates refer to. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Embedded image as a data: URL, or null if the file was exported without it. */
  dataUrl: z.string().startsWith('data:image/').nullable(),
})

export const WallSchema = z.object({
  /** 0 = vertical, positive = overhanging, negative = slab. 90 = roof. */
  angleDeg: z.number().finite().min(-45).max(90),
  /** Real-world meters per image pixel, assuming a frontal photo of a planar wall. */
  metersPerPixel: z.number().finite().positive(),
  scaleSource: z.enum(SCALE_SOURCES),
  /**
   * Normalized image row where the wall meets the floor / top of the mats.
   * Wall-local y = 0 there. null = the photo's bottom edge is the floor.
   */
  floorV: unit.nullable().default(null),
})

export const RouteSchema = z.object({
  format: z.literal(ROUTE_FORMAT),
  schemaVersion: z.literal(ROUTE_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().max(120),
  grade: z.string().max(20).default(''),
  notes: z.string().max(5000).default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  image: RouteImageSchema,
  wall: WallSchema,
  footRule: z.enum(FOOT_RULES),
  holds: z.array(HoldSchema),
  startHoldIds: z.array(z.string()),
  finishHoldIds: z.array(z.string()),
  /** Saved climber, avatar color, and beta plan for this problem. */
  session: ClimbSessionSchema.nullable().default(null),
})

export type Hold = z.infer<typeof HoldSchema>
export type HoldType = (typeof HOLD_TYPES)[number]
export type RouteImage = z.infer<typeof RouteImageSchema>
export type Wall = z.infer<typeof WallSchema>
export type FootRule = (typeof FOOT_RULES)[number]
export type Route = z.infer<typeof RouteSchema>
