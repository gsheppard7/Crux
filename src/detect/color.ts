/** RGB in 0–255. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** CIE L*a*b*. */
export interface Lab {
  L: number
  a: number
  b: number
}

/** HSV: h in [0,360), s/v in [0,1]. */
export interface Hsv {
  h: number
  s: number
  v: number
}

export type NamedColorName =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'black'
  | 'white'
  | 'gray'
  | 'brown'

export interface NamedColor {
  name: NamedColorName
  hex: string
  label: string
}

/** UI swatches + canonical names for route-color picking. */
export const NAMED_COLORS: readonly NamedColor[] = [
  { name: 'red', hex: '#e11d48', label: 'Red' },
  { name: 'orange', hex: '#f97316', label: 'Orange' },
  { name: 'yellow', hex: '#eab308', label: 'Yellow' },
  { name: 'green', hex: '#22c55e', label: 'Green' },
  { name: 'teal', hex: '#14b8a6', label: 'Teal' },
  { name: 'blue', hex: '#3b82f6', label: 'Blue' },
  { name: 'purple', hex: '#a855f7', label: 'Purple' },
  { name: 'pink', hex: '#ec4899', label: 'Pink' },
  { name: 'black', hex: '#1c1917', label: 'Black' },
  { name: 'white', hex: '#fafaf9', label: 'White' },
  { name: 'gray', hex: '#78716c', label: 'Gray' },
  { name: 'brown', hex: '#92400e', label: 'Brown' },
] as const

export function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  let h = 0
  if (d > 1e-9) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max <= 1e-9 ? 0 : d / max
  return { h, s, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [rp, gp, bp] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return {
    r: clampByte((rp + m) * 255),
    g: clampByte((gp + m) * 255),
    b: clampByte((bp + m) * 255),
  }
}

function srgbToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  const x = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return clampByte(x * 255)
}

/** RGB → CIE L*a*b* (D65). */
export function rgbToLab({ r, g, b }: Rgb): Lab {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
  // D65 white
  const xn = X / 0.95047
  const yn = Y / 1
  const zn = Z / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(xn)
  const fy = f(yn)
  const fz = f(zn)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** Approximate Lab → RGB (for swatches / debugging). */
export function labToRgb({ L, a, b }: Lab): Rgb {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const inv = (t: number) => {
    const t3 = t * t * t
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787
  }
  const X = 0.95047 * inv(fx)
  const Y = 1 * inv(fy)
  const Z = 1.08883 * inv(fz)
  const R = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314
  const G = X * -0.969266 + Y * 1.8760108 + Z * 0.041556
  const B = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) }
}

/** CIE76 ΔE. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)
}

function inHue(h: number, lo: number, hi: number): boolean {
  if (lo <= hi) return h >= lo && h < hi
  return h >= lo || h < hi
}

/**
 * Named-color rules in HSV. Pink vs red: pink is lighter / less saturated or
 * sits in the magenta band; saturated dark crimson stays red.
 */
export function matchesNamedColor(rgb: Rgb, name: NamedColorName): boolean {
  const { h, s, v } = rgbToHsv(rgb)
  switch (name) {
    case 'black':
      return v < 0.22 && s < 0.55
    case 'white':
      return v > 0.82 && s < 0.18
    case 'gray':
      return s < 0.18 && v >= 0.22 && v <= 0.82
    case 'brown':
      return s >= 0.18 && s <= 0.7 && v >= 0.15 && v <= 0.55 && inHue(h, 10, 45)
    case 'red':
      // Saturated red/orange-red; exclude light pinks and magenta-leaning pinks.
      if (!(s >= 0.35 && v >= 0.18 && v <= 0.92 && inHue(h, 345, 18))) return false
      if (v > 0.72 && s < 0.55) return false // light dusty → pink
      if (inHue(h, 320, 345) && v > 0.55) return false
      return true
    case 'pink': {
      if (v < 0.35) return false
      // Magenta–rose band (not saturated crimson).
      if (inHue(h, 300, 345) && s >= 0.15 && s <= 0.95 && v >= 0.4) return true
      // Pastel / light reddish only — keep saturated reds out.
      if (inHue(h, 345, 20) && s >= 0.15 && s < 0.7 && v > 0.72) return true
      return false
    }
    case 'orange':
      return s >= 0.35 && v >= 0.35 && inHue(h, 15, 42)
    case 'yellow':
      return s >= 0.3 && v >= 0.45 && inHue(h, 42, 72)
    case 'green':
      return s >= 0.25 && v >= 0.2 && inHue(h, 72, 160)
    case 'teal':
      return s >= 0.25 && v >= 0.25 && inHue(h, 160, 195)
    case 'blue':
      return s >= 0.25 && v >= 0.2 && inHue(h, 195, 255)
    case 'purple':
      return s >= 0.25 && v >= 0.2 && inHue(h, 255, 300)
    default:
      return false
  }
}

/** Eyedropper match: Lab ΔE ≤ tolerance against the sampled RGB. */
export function matchesEyedropper(sample: Rgb, pixel: Rgb, tolerance: number): boolean {
  return deltaE(rgbToLab(sample), rgbToLab(pixel)) <= tolerance
}

export function meanRgb(pixels: Rgb[]): Rgb {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0 }
  let r = 0
  let g = 0
  let b = 0
  for (const p of pixels) {
    r += p.r
    g += p.g
    b += p.b
  }
  const n = pixels.length
  return { r: r / n, g: g / n, b: b / n }
}

export function medianLab(labs: Lab[]): Lab {
  if (labs.length === 0) return { L: 50, a: 0, b: 0 }
  const Ls = labs.map((x) => x.L).sort((a, b) => a - b)
  const as = labs.map((x) => x.a).sort((a, b) => a - b)
  const bs = labs.map((x) => x.b).sort((a, b) => a - b)
  const mid = (arr: number[]) => {
    const m = Math.floor(arr.length / 2)
    return arr.length % 2 ? arr[m]! : (arr[m - 1]! + arr[m]!) / 2
  }
  return { L: mid(Ls), a: mid(as), b: mid(bs) }
}
