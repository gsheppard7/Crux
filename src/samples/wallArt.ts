/** Procedural "gym wall photo" rendered as SVG, used by the sample routes. */

export interface PaintedHold {
  u: number
  v: number
  /** Fraction of image width. */
  r: number
  color: string
  seed: number
  /** Elongation; >1 = wider than tall. */
  stretch?: number
}

export interface WallArtOptions {
  width: number
  height: number
  seed: number
  base: string
  baseDark: string
  holds: PaintedHold[]
  distractorColors: string[]
  distractorCount: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n: number) => n.toFixed(1)

function blobPath(cx: number, cy: number, r: number, seed: number, stretch = 1): string {
  const rand = mulberry32(seed)
  const n = 9
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const rr = r * (0.78 + rand() * 0.34)
    return [cx + Math.cos(a) * rr * stretch, cy + Math.sin(a) * rr] as const
  })
  const mid = (i: number) => {
    const p = pts[i % n]
    const q = pts[(i + 1) % n]
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const
  }
  const start = mid(n - 1)
  let d = `M${f(start[0])},${f(start[1])}`
  for (let i = 0; i < n; i++) {
    const m = mid(i)
    d += ` Q${f(pts[i][0])},${f(pts[i][1])} ${f(m[0])},${f(m[1])}`
  }
  return d + 'Z'
}

function holdSvg(cx: number, cy: number, r: number, color: string, seed: number, stretch = 1): string {
  const d = blobPath(cx, cy, r, seed, stretch)
  const shadow = blobPath(cx + r * 0.12, cy + r * 0.18, r, seed, stretch)
  return (
    `<path d="${shadow}" fill="#000" opacity="0.35"/>` +
    `<path d="${d}" fill="${color}" stroke="#000" stroke-opacity="0.25" stroke-width="2"/>` +
    `<path d="${d}" fill="url(#shine)"/>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(Math.max(2.5, r * 0.12))}" fill="#1c1917" opacity="0.7"/>`
  )
}

export function renderWallSvg(o: WallArtOptions): string {
  const { width: W, height: H } = o
  const rand = mulberry32(o.seed)
  const parts: string[] = []

  parts.push(
    `<defs>` +
      `<linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${o.base}"/><stop offset="1" stop-color="${o.baseDark}"/></linearGradient>` +
      `<radialGradient id="shine" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient>` +
      `<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient>` +
      `</defs>`,
  )
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`)

  // Plywood panel seams and T-nut grid.
  const panel = W / 3
  for (let x = panel; x < W; x += panel) {
    parts.push(`<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${H}" stroke="#000" stroke-opacity="0.25" stroke-width="3"/>`)
  }
  for (let y = panel; y < H; y += panel) {
    parts.push(`<line x1="0" y1="${f(y)}" x2="${W}" y2="${f(y)}" stroke="#000" stroke-opacity="0.25" stroke-width="3"/>`)
  }
  const step = W / 18
  let dots = ''
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      dots += `M${f(x)},${f(y)}h0.01`
    }
  }
  parts.push(`<path d="${dots}" stroke="#0c0a09" stroke-opacity="0.55" stroke-width="7" stroke-linecap="round"/>`)

  // Paint speckle so the photo isn't perfectly clean.
  let speckle = ''
  for (let i = 0; i < 260; i++) {
    speckle += `M${f(rand() * W)},${f(rand() * H)}h0.01`
  }
  parts.push(`<path d="${speckle}" stroke="#fff" stroke-opacity="0.07" stroke-width="5" stroke-linecap="round"/>`)

  // Distractor holds from other problems, kept clear of the annotated ones.
  const placed = o.holds.map((h) => ({ x: h.u * W, y: h.v * H, r: h.r * W }))
  let attempts = 0
  let count = 0
  while (count < o.distractorCount && attempts < o.distractorCount * 30) {
    attempts++
    const r = W * (0.01 + rand() * 0.022)
    const x = r + rand() * (W - 2 * r)
    const y = r + rand() * (H * 0.97 - 2 * r)
    if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + W * 0.012)) continue
    placed.push({ x, y, r })
    const color = o.distractorColors[Math.floor(rand() * o.distractorColors.length)]
    parts.push(holdSvg(x, y, r, color, Math.floor(rand() * 1e9), 0.8 + rand() * 0.6))
    count++
  }

  for (const h of o.holds) {
    parts.push(holdSvg(h.u * W, h.v * H, h.r * W, h.color, h.seed, h.stretch))
  }

  parts.push(`<rect width="${W}" height="${H}" fill="url(#vignette)"/>`)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
