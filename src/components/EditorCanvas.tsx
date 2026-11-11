import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Hold, Route } from '../model/schema'
import {
  clamp,
  fitView,
  imageToNormalized,
  isInsideImage,
  normalizedToImage,
  normalizedToScreen,
  normalizedToWall,
  panBy,
  radiusToScreen,
  screenRadiusToNormalized,
  screenToImage,
  viewTransform,
  zoomAt,
  type Point,
  type Size,
  type ViewState,
} from '../model/coords'
import { addHold, createHold, holdRole, MAX_HOLD_RADIUS, MIN_HOLD_RADIUS, moveHold, updateHold } from '../model/route'
import type { CommitOptions } from '../state/useRouteEditor'
import { ROLE_COLORS } from '../ui/theme'

export type Tool = 'select' | 'add'

interface Props {
  route: Route
  selectedId: string | null
  onSelect: (id: string | null) => void
  tool: Tool
  onToolChange: (tool: Tool) => void
  view: ViewState
  onViewChange: (view: ViewState) => void
  apply: (fn: (r: Route) => Route, opts?: CommitOptions) => void
}

type Gesture =
  | { kind: 'move'; id: string; pointerId: number; start: Point; grab: Point; moved: boolean; session: string }
  | { kind: 'resize'; id: string; pointerId: number; session: string }
  | { kind: 'pan'; pointerId: number; start: Point; startView: ViewState; moved: boolean; deselectOnClick: boolean }

const DRAG_THRESHOLD_PX = 3
let sessionCounter = 0

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 800, height: 600 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize({ width: r.width, height: r.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export function EditorCanvas({ route, selectedId, onSelect, tool, onToolChange, view, onViewChange, apply }: Props) {
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const [hover, setHover] = useState<Point | null>(null)
  const image = route.image
  const t = viewTransform(size, image, view)

  // Latest values for the native wheel listener.
  const latest = useRef({ view, size, image, onViewChange })
  useEffect(() => {
    latest.current = { view, size, image, onViewChange }
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view, size, image, onViewChange } = latest.current
      const rect = el.getBoundingClientRect()
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const speed = e.ctrlKey ? 0.01 : 0.0015
      onViewChange(zoomAt(view, size, image, p, Math.exp(-e.deltaY * speed)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef])

  useEffect(() => {
    const isTyping = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const capture = (e: ReactPointerEvent) => {
    try {
      svgRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
  }

  const addAt = useCallback(
    (p: Point, opts?: CommitOptions): string | null => {
      const imgPt = screenToImage(t, p)
      if (!isInsideImage(image, imgPt)) return null
      const n = imageToNormalized(image, imgPt)
      const hold = createHold({ ...n })
      apply((r) => addHold(r, hold), opts)
      onSelect(hold.id)
      return hold.id
    },
    [apply, image, onSelect, t],
  )

  const onHoldPointerDown = (e: ReactPointerEvent, hold: Hold) => {
    if (e.button !== 0 || spaceDown) return
    e.stopPropagation()
    onSelect(hold.id)
    const p = localPoint(e)
    const imgPt = screenToImage(t, p)
    const center = normalizedToImage(image, hold)
    gesture.current = {
      kind: 'move',
      id: hold.id,
      pointerId: e.pointerId,
      start: p,
      grab: { x: imgPt.x - center.x, y: imgPt.y - center.y },
      moved: false,
      session: `move:${hold.id}:${++sessionCounter}`,
    }
    capture(e)
  }

  const onHandlePointerDown = (e: ReactPointerEvent, hold: Hold) => {
    if (e.button !== 0) return
    e.stopPropagation()
    gesture.current = { kind: 'resize', id: hold.id, pointerId: e.pointerId, session: `resize:${hold.id}:${++sessionCounter}` }
    capture(e)
  }

  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    const p = localPoint(e)
    const wantsPan = e.button === 1 || spaceDown || (e.button === 0 && tool === 'select')
    if (e.button === 0 && tool === 'add' && !spaceDown) {
      // Add + the drag that follows share one undo step.
      const session = `add:${++sessionCounter}`
      const id = addAt(p, { coalesceKey: session, sticky: true })
      if (id) {
        const imgPt = screenToImage(t, p)
        const center = normalizedToImage(image, imageToNormalized(image, imgPt))
        gesture.current = {
          kind: 'move',
          id,
          pointerId: e.pointerId,
          start: p,
          grab: { x: imgPt.x - center.x, y: imgPt.y - center.y },
          moved: false,
          session,
        }
        capture(e)
      }
      return
    }
    if (wantsPan) {
      e.preventDefault()
      gesture.current = { kind: 'pan', pointerId: e.pointerId, start: p, startView: view, moved: false, deselectOnClick: e.button === 0 && !spaceDown }
      setPanning(true)
      capture(e)
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const p = localPoint(e)
    setHover(p)
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (g.kind === 'pan') {
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_THRESHOLD_PX) return
      g.moved = true
      onViewChange(panBy(g.startView, size, image, p.x - g.start.x, p.y - g.start.y))
    } else if (g.kind === 'move') {
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_THRESHOLD_PX) return
      g.moved = true
      const imgPt = screenToImage(t, p)
      const n = imageToNormalized(image, { x: imgPt.x - g.grab.x, y: imgPt.y - g.grab.y })
      apply((r) => moveHold(r, g.id, n), { coalesceKey: g.session, sticky: true })
    } else if (g.kind === 'resize') {
      const hold = route.holds.find((h) => h.id === g.id)
      if (!hold) return
      const c = normalizedToScreen(t, image, hold)
      const radius = clamp(screenRadiusToNormalized(t, image, Math.hypot(p.x - c.x, p.y - c.y)), MIN_HOLD_RADIUS, MAX_HOLD_RADIUS)
      apply((r) => updateHold(r, g.id, { radius }), { coalesceKey: g.session, sticky: true })
    }
  }

  const endGesture = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (g.kind === 'pan' && !g.moved && g.deselectOnClick) onSelect(null)
    gesture.current = null
    setPanning(false)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool === 'select' && e.target === svgRef.current) addAt(localPoint(e))
  }

  const zoomBy = (factor: number) =>
    onViewChange(zoomAt(view, size, image, { x: size.width / 2, y: size.height / 2 }, factor))

  const imgW = image.width * t.scale
  const imgH = image.height * t.scale
  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : tool === 'add' ? 'crosshair' : 'default'

  const hoverInfo = (() => {
    if (!hover) return null
    const ip = screenToImage(t, hover)
    if (!isInsideImage(image, ip)) return null
    const n = imageToNormalized(image, ip)
    const w = normalizedToWall(image, route.wall.metersPerPixel, n)
    return { n, w }
  })()

  // Draw the selected hold last so it sits on top.
  const ordered = [...route.holds].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId))

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-stone-900 select-none"
      data-testid="editor-canvas"
    >
      {image.dataUrl ? (
        <img
          src={image.dataUrl}
          alt="Wall photo"
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{ left: t.offsetX, top: t.offsetY, width: imgW, height: imgH }}
        />
      ) : (
        <div
          className="pointer-events-none absolute flex items-center justify-center border border-dashed border-stone-500 bg-stone-800 text-sm text-stone-400"
          style={{
            left: t.offsetX,
            top: t.offsetY,
            width: imgW,
            height: imgH,
            backgroundImage:
              'linear-gradient(#44403c 1px, transparent 1px), linear-gradient(90deg, #44403c 1px, transparent 1px)',
            backgroundSize: `${imgW / 10}px ${imgH / 10}px`,
          }}
        >
          <span className="rounded bg-stone-900/80 px-3 py-1">
            Photo not embedded ({image.width}×{image.height}) — attach it from the toolbar
          </span>
        </div>
      )}

      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label="Hold annotation canvas"
      >
        {ordered.map((hold) => {
          const c = normalizedToScreen(t, image, hold)
          const r = Math.max(3, radiusToScreen(t, image, hold.radius))
          const role = holdRole(route, hold)
          const color = ROLE_COLORS[role]
          const selected = hold.id === selectedId
          const footOnly = hold.allowFoot && !hold.allowHand
          const dash = role === 'off-route' ? '4 4' : footOnly ? '2 3' : undefined
          const facing = hold.facingDeg === null ? null : (hold.facingDeg * Math.PI) / 180
          return (
            <g
              key={hold.id}
              data-testid={`hold-${hold.id}`}
              onPointerDown={(e) => onHoldPointerDown(e, hold)}
              style={{ cursor: spaceDown ? undefined : 'move' }}
              opacity={role === 'off-route' && !selected ? 0.7 : 1}
            >
              <circle cx={c.x} cy={c.y} r={Math.max(r, 10)} fill="transparent" />
              {selected && <circle cx={c.x} cy={c.y} r={r + 5} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={2} />}
              <circle
                cx={c.x}
                cy={c.y}
                r={r}
                fill={color}
                fillOpacity={selected ? 0.22 : 0.08}
                stroke={color}
                strokeWidth={selected ? 3 : 2.25}
                strokeDasharray={dash}
                style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,.9))' }}
              />
              {role === 'start-finish' && (
                <circle cx={c.x} cy={c.y} r={r + 3} fill="none" stroke={ROLE_COLORS.finish} strokeWidth={2} strokeDasharray="5 3" />
              )}
              {facing !== null && (
                <line
                  x1={c.x}
                  y1={c.y}
                  x2={c.x + Math.sin(facing) * r * 0.85}
                  y2={c.y - Math.cos(facing) * r * 0.85}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,.9))' }}
                />
              )}
              <text
                x={c.x + r * 0.72 + 3}
                y={c.y - r * 0.72 - 3}
                fontSize={12}
                fontWeight={700}
                fill="#fff"
                stroke="#000"
                strokeWidth={3}
                paintOrder="stroke"
                className="pointer-events-none"
              >
                {role === 'start' || role === 'start-finish' ? `S ${hold.label}` : role === 'finish' ? `F ${hold.label}` : hold.label}
              </text>
              {selected && (
                <circle
                  data-testid="resize-handle"
                  cx={c.x + r}
                  cy={c.y}
                  r={6}
                  fill="#fff"
                  stroke="#0c0a09"
                  strokeWidth={2}
                  style={{ cursor: 'ew-resize' }}
                  onPointerDown={(e) => onHandlePointerDown(e, hold)}
                />
              )}
            </g>
          )
        })}
      </svg>

      <div className="absolute top-3 left-3 flex gap-1 rounded-lg border border-stone-700 bg-stone-900/90 p-1 shadow-lg backdrop-blur">
        <ToolButton active={tool === 'select'} onClick={() => onToolChange('select')} title="Select / move (V). Drag background to pan; double-click to add.">
          Select
        </ToolButton>
        <ToolButton active={tool === 'add'} onClick={() => onToolChange('add')} title="Add holds (A). Click to place, drag to adjust.">
          + Add hold
        </ToolButton>
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1 rounded-lg border border-stone-700 bg-stone-900/90 p-1 text-sm shadow-lg backdrop-blur">
        <ToolButton onClick={() => zoomBy(1 / 1.25)} title="Zoom out">−</ToolButton>
        <span className="w-12 text-center tabular-nums text-stone-300" data-testid="zoom-level">
          {Math.round(view.zoom * 100)}%
        </span>
        <ToolButton onClick={() => zoomBy(1.25)} title="Zoom in">+</ToolButton>
        <ToolButton onClick={() => onViewChange(fitView(image))} title="Fit photo (0)">Fit</ToolButton>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-stone-900/85 px-3 py-1.5 text-xs text-stone-300">
        <Legend color={ROLE_COLORS.start} label="Start" />
        <Legend color={ROLE_COLORS.finish} label="Finish" />
        <Legend color={ROLE_COLORS.route} label="Route" />
        <Legend color={ROLE_COLORS['off-route']} label="Off route" dashed />
        <span className="text-stone-500">dotted = feet only · tick = facing</span>
      </div>

      {hoverInfo && (
        <div className="pointer-events-none absolute top-14 right-3 rounded-lg bg-stone-900/85 px-3 py-1.5 font-mono text-xs text-stone-300 tabular-nums">
          u {hoverInfo.n.u.toFixed(3)} v {hoverInfo.n.v.toFixed(3)} · x {hoverInfo.w.x.toFixed(2)} m y {hoverInfo.w.y.toFixed(2)} m
        </div>
      )}
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-sm font-medium transition ${
        active ? 'bg-amber-500 text-stone-950' : 'text-stone-200 hover:bg-stone-700'
      }`}
    >
      {children}
    </button>
  )
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="12" height="12">
        <circle cx="6" cy="6" r="4.5" fill="none" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '2 2' : undefined} />
      </svg>
      {label}
    </span>
  )
}
