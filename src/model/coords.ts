/**
 * Coordinate systems (see docs/route-schema.md):
 *
 *  - normalized  (u, v)  ∈ [0,1]²  — stored in the route file. Origin top-left
 *                                    of the image, v grows downward.
 *  - image       (px)              — u·W, v·H for the route's image size.
 *  - screen      (px)              — CSS pixels inside the editor viewport.
 *                                    Derived from image px by a ViewTransform.
 *  - wall-local  (m)               — origin at the bottom-left of the photo,
 *                                    x right, y up *along* the wall surface,
 *                                    z out of the wall toward the climber.
 *  - world       (m, three.js)     — y up, wall base on the floor at z = 0,
 *                                    x centered on the wall, +z toward viewer.
 */

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Normalized {
  u: number
  v: number
}

export interface WallPoint {
  x: number
  y: number
  z: number
}

export type Vec3 = [number, number, number]

/** screen = image · scale + offset */
export interface ViewTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/** Resolution-independent view: zoom relative to "fit", centered on an image point. */
export interface ViewState {
  zoom: number
  center: Point
}

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 12

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function fitScale(container: Size, image: Size, padding = 16): number {
  const w = Math.max(1, container.width - padding * 2)
  const h = Math.max(1, container.height - padding * 2)
  return Math.min(w / image.width, h / image.height)
}

export function fitView(image: Size): ViewState {
  return { zoom: 1, center: { x: image.width / 2, y: image.height / 2 } }
}

export function viewTransform(container: Size, image: Size, view: ViewState): ViewTransform {
  const scale = fitScale(container, image) * view.zoom
  return {
    scale,
    offsetX: container.width / 2 - view.center.x * scale,
    offsetY: container.height / 2 - view.center.y * scale,
  }
}

export function imageToScreen(t: ViewTransform, p: Point): Point {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY }
}

export function screenToImage(t: ViewTransform, p: Point): Point {
  return { x: (p.x - t.offsetX) / t.scale, y: (p.y - t.offsetY) / t.scale }
}

export function normalizedToImage(image: Size, n: Normalized): Point {
  return { x: n.u * image.width, y: n.v * image.height }
}

export function imageToNormalized(image: Size, p: Point): Normalized {
  return {
    u: clamp(p.x / image.width, 0, 1),
    v: clamp(p.y / image.height, 0, 1),
  }
}

export function normalizedToScreen(t: ViewTransform, image: Size, n: Normalized): Point {
  return imageToScreen(t, normalizedToImage(image, n))
}

export function screenToNormalized(t: ViewTransform, image: Size, p: Point): Normalized {
  return imageToNormalized(image, screenToImage(t, p))
}

export function isInsideImage(image: Size, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= image.width && p.y <= image.height
}

/** Hold radius is stored as a fraction of image width. */
export function radiusToImage(image: Size, radius: number): number {
  return radius * image.width
}

export function radiusToScreen(t: ViewTransform, image: Size, radius: number): number {
  return radius * image.width * t.scale
}

export function screenRadiusToNormalized(t: ViewTransform, image: Size, screenRadius: number): number {
  return screenRadius / t.scale / image.width
}

/** Zoom by `factor`, keeping the image point under `screenPoint` fixed. */
export function zoomAt(
  view: ViewState,
  container: Size,
  image: Size,
  screenPoint: Point,
  factor: number,
): ViewState {
  const before = viewTransform(container, image, view)
  const anchor = screenToImage(before, screenPoint)
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  const scale = fitScale(container, image) * zoom
  const offsetX = screenPoint.x - anchor.x * scale
  const offsetY = screenPoint.y - anchor.y * scale
  return {
    zoom,
    center: {
      x: (container.width / 2 - offsetX) / scale,
      y: (container.height / 2 - offsetY) / scale,
    },
  }
}

export function panBy(view: ViewState, container: Size, image: Size, dx: number, dy: number): ViewState {
  const { scale } = viewTransform(container, image, view)
  return { zoom: view.zoom, center: { x: view.center.x - dx / scale, y: view.center.y - dy / scale } }
}

// ---------------------------------------------------------------------------
// Real-world scale
// ---------------------------------------------------------------------------

/** Used until the user calibrates: assume the photo spans this much wall height. */
export const DEFAULT_PHOTO_HEIGHT_M = 4.5

export function defaultMetersPerPixel(image: Size): number {
  return DEFAULT_PHOTO_HEIGHT_M / image.height
}

export function metersPerPixelFromWallWidth(widthM: number, image: Size): number {
  return widthM / image.width
}

/** Calibrate from a hold whose real diameter is known. */
export function metersPerPixelFromReferenceHold(diameterM: number, radius: number, image: Size): number {
  return diameterM / (2 * radiusToImage(image, radius))
}

export function wallSize(image: Size, metersPerPixel: number): { widthM: number; heightM: number } {
  return { widthM: image.width * metersPerPixel, heightM: image.height * metersPerPixel }
}

/**
 * Normalized image → wall-local meters. Assumes a frontal (fronto-parallel)
 * photo of a planar wall with negligible lens distortion. `floorV` is the
 * image row of the wall base (default: the photo's bottom edge).
 */
export function normalizedToWall(image: Size, metersPerPixel: number, n: Normalized, depthM = 0, floorV = 1): WallPoint {
  return { x: n.u * image.width * metersPerPixel, y: (floorV - n.v) * image.height * metersPerPixel, z: depthM }
}

export function wallToNormalized(image: Size, metersPerPixel: number, p: Pick<WallPoint, 'x' | 'y'>, floorV = 1): Normalized {
  return { u: p.x / (image.width * metersPerPixel), v: floorV - p.y / (image.height * metersPerPixel) }
}

export interface WallFrame {
  image: Size
  metersPerPixel: number
  angleDeg: number
  floorV: number
  widthM: number
  /** Climbable height: floor line to the top of the photo. */
  heightM: number
  toWall: (n: Normalized, z?: number) => WallPoint
  toNormalized: (p: Pick<WallPoint, 'x' | 'y'>) => Normalized
}

export function wallFrame(image: Size, wall: { metersPerPixel: number; angleDeg: number; floorV: number | null }): WallFrame {
  const floorV = wall.floorV ?? 1
  const mpp = wall.metersPerPixel
  return {
    image,
    metersPerPixel: mpp,
    angleDeg: wall.angleDeg,
    floorV,
    widthM: image.width * mpp,
    heightM: floorV * image.height * mpp,
    toWall: (n, z = 0) => normalizedToWall(image, mpp, n, z, floorV),
    toNormalized: (p) => wallToNormalized(image, mpp, p, floorV),
  }
}

/** Calibrate from the real height between the floor line and the photo's top edge. */
export function metersPerPixelFromFloorHeight(heightM: number, image: Size, floorV: number): number {
  return heightM / (floorV * image.height)
}

const deg = (d: number) => (d * Math.PI) / 180

/** Unit vector pointing up along the wall surface, in world coordinates. */
export function wallUp(angleDeg: number): Vec3 {
  const a = deg(angleDeg)
  return [0, Math.cos(a), Math.sin(a)]
}

/** Unit normal pointing out of the wall toward the climber, in world coordinates. */
export function wallNormal(angleDeg: number): Vec3 {
  const a = deg(angleDeg)
  return [0, -Math.sin(a), Math.cos(a)]
}

/**
 * Wall-local → world. The wall pivots about its bottom edge (on the floor);
 * a positive angle leans the top toward the viewer (+z), i.e. overhang.
 * `baseY` raises the pivot (e.g. a vertical kicker panel below a steep wall).
 */
export function wallToWorld(p: WallPoint, angleDeg: number, wallWidthM: number, baseY = 0): Vec3 {
  const up = wallUp(angleDeg)
  const n = wallNormal(angleDeg)
  return [
    p.x - wallWidthM / 2,
    baseY + up[1] * p.y + n[1] * p.z,
    up[2] * p.y + n[2] * p.z,
  ]
}

/**
 * Preview-only pivot height: steep walls would otherwise lie on the floor,
 * so lift them until the top edge sits at ~`topM`. Vertical/slab walls stay
 * on the ground.
 */
export function previewBaseHeight(angleDeg: number, heightM: number, topM = 4.5): number {
  if (angleDeg < 35) return 0
  const top = heightM * Math.cos((angleDeg * Math.PI) / 180)
  return Math.max(0.4, topM - top)
}

/** Classify the wall profile from its angle. */
export function wallProfile(angleDeg: number): 'slab' | 'vertical' | 'overhang' | 'steep' | 'roof' {
  if (angleDeg < -2) return 'slab'
  if (angleDeg <= 5) return 'vertical'
  if (angleDeg <= 30) return 'overhang'
  if (angleDeg < 75) return 'steep'
  return 'roof'
}
