import type { Hold, Route } from '../model/schema'
import { HOLD_TYPES } from '../model/schema'
import { holdRole, removeHold, toggleFinish, toggleStart, updateHold } from '../model/route'
import { radiusToImage, wallFrame } from '../model/coords'
import { loadClimber } from '../climber/profile'
import { DEFAULT_DEPTH_CM, holdGripSummary } from '../planner/grip'
import type { CommitOptions } from '../state/useRouteEditor'
import { HOLD_TYPE_LABELS, ROLE_COLORS, ROLE_LABELS } from '../ui/theme'
import { Button, Field, NumberInput, Section, Segmented, TextInput, Toggle, inputClass } from './form'

interface Props {
  route: Route
  hold: Hold | undefined
  apply: (fn: (r: Route) => Route, opts?: CommitOptions) => void
  onSelect: (id: string | null) => void
}

const FACING_PRESETS = [
  { value: 0, label: '↑', title: 'Faces up (down-pull)' },
  { value: 45, label: '↗', title: 'Faces up-right' },
  { value: 90, label: '→', title: 'Faces right' },
  { value: 135, label: '↘', title: 'Faces down-right' },
  { value: 180, label: '↓', title: 'Faces down (undercling)' },
  { value: 225, label: '↙', title: 'Faces down-left' },
  { value: 270, label: '←', title: 'Faces left' },
  { value: 315, label: '↖', title: 'Faces up-left' },
]

export function HoldInspector({ route, hold, apply, onSelect }: Props) {
  if (!hold) {
    return (
      <Section title="Selected hold">
        <p className="text-sm text-stone-400">
          Select a hold on the photo or in the list. Use <Kbd>A</Kbd> to add holds, or double-click the photo.
        </p>
      </Section>
    )
  }

  const id = hold.id
  const role = holdRole(route, hold)
  const edit = (patch: Partial<Hold>, field: string) =>
    apply((r) => updateHold(r, id, patch), { coalesceKey: `edit:${id}:${field}` })
  const isStart = route.startHoldIds.includes(id)
  const isFinish = route.finishHoldIds.includes(id)
  const frame = wallFrame(route.image, route.wall)
  const wall = frame.toWall(hold)
  const diameterCm = radiusToImage(route.image, hold.radius) * 2 * frame.metersPerPixel * 100
  const climber = loadClimber()
  const grip = hold.allowHand
    ? holdGripSummary(
        {
          id: hold.id,
          label: hold.label,
          x: wall.x,
          y: wall.y,
          r: hold.radius * route.image.width * frame.metersPerPixel,
          depth: (hold.depthCm ?? DEFAULT_DEPTH_CM[hold.type]) / 100,
          type: hold.type,
          facingDeg: hold.facingDeg,
          difficulty: hold.difficulty,
          hand: hold.allowHand,
          foot: hold.allowFoot,
          matchable: false,
          confidence: hold.confidence,
          source: hold.source,
        },
        climber,
        route.wall.angleDeg,
      )
    : null

  return (
    <Section
      title="Selected hold"
      right={
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: ROLE_COLORS[role] }}>
          ● {ROLE_LABELS[role]}
        </span>
      }
    >
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Label">{(fid) => <TextInput id={fid} value={hold.label} maxLength={40} onChange={(label) => edit({ label }, 'label')} />}</Field>
        <Button
          variant="danger"
          onClick={() => {
            apply((r) => removeHold(r, id))
            onSelect(null)
          }}
          title="Delete hold (Del)"
        >
          Delete
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <RoleButton active={isStart} color={ROLE_COLORS.start} onClick={() => apply((r) => toggleStart(r, id))} title="Toggle start (S)">
          Start
        </RoleButton>
        <RoleButton active={isFinish} color={ROLE_COLORS.finish} onClick={() => apply((r) => toggleFinish(r, id))} title="Toggle finish (F)">
          Finish
        </RoleButton>
        <RoleButton
          active={hold.inRoute}
          color={ROLE_COLORS.route}
          onClick={() => apply((r) => updateHold(r, id, { inRoute: !hold.inRoute }))}
          title="Toggle route membership (R)"
        >
          In route
        </RoleButton>
      </div>

      <div className="flex gap-4">
        <Toggle checked={hold.allowHand} onChange={(allowHand) => apply((r) => updateHold(r, id, { allowHand }))} label="Hands" />
        <Toggle checked={hold.allowFoot} onChange={(allowFoot) => apply((r) => updateHold(r, id, { allowFoot }))} label="Feet" />
      </div>

      {grip && (
        <div className="rounded-md border border-stone-800 bg-stone-950/50 px-2.5 py-2 text-xs text-stone-400">
          For {climber.name}: <b className="text-stone-200 capitalize">{grip.rating}</b> ({(grip.capacity * 100).toFixed(0)}% BW one-hand capacity)
          {!grip.oneHandWithFeet && route.wall.angleDeg > 10 ? ' · not a one-hand rest on this wall' : ''}
        </div>
      )}

      <Field label="Type">
        {(fid) => (
          <select
            id={fid}
            className={inputClass}
            value={hold.type}
            onChange={(e) => {
              const type = e.target.value as Hold['type']
              apply((r) => updateHold(r, id, type === 'foot-chip' ? { type, allowHand: false, allowFoot: true } : { type }))
            }}
          >
            {HOLD_TYPES.map((t) => (
              <option key={t} value={t}>
                {HOLD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label="Facing (usable surface direction)" hint="Clockwise from up. ↑ = classic down-pull, ↓ = undercling.">
        {(fid) => (
          <div className="flex items-center gap-2">
            <Segmented
              ariaLabel="Facing presets"
              value={hold.facingDeg ?? -1}
              onChange={(v) => edit({ facingDeg: v < 0 ? null : v }, 'facing')}
              options={[{ value: -1, label: '?', title: 'Unknown / omnidirectional' }, ...FACING_PRESETS]}
            />
            <div className="w-16 shrink-0">
              <NumberInput
                id={fid}
                ariaLabel="Facing degrees"
                value={hold.facingDeg}
                nullable
                min={0}
                max={359}
                placeholder="—"
                onChange={(v) => edit({ facingDeg: v }, 'facing')}
              />
            </div>
          </div>
        )}
      </Field>

      <Field label="Grip difficulty (estimate)">
        {() => (
          <Segmented
            ariaLabel="Grip difficulty"
            value={hold.difficulty ?? 0}
            onChange={(v) => edit({ difficulty: v === 0 ? null : v }, 'difficulty')}
            options={[
              { value: 0, label: '?', title: 'Unknown' },
              { value: 1, label: '1', title: 'Very good' },
              { value: 2, label: '2' },
              { value: 3, label: '3' },
              { value: 4, label: '4' },
              { value: 5, label: '5', title: 'Very poor' },
            ]}
          />
        )}
      </Field>

      <Field
        label={`Size — ≈ ${diameterCm.toFixed(0)} cm across`}
        hint={route.wall.scaleSource === 'default' ? 'Uncalibrated scale; calibrate under Wall & scale.' : undefined}
      >
        {(fid) => (
          <input
            id={fid}
            type="range"
            min={0.004}
            max={0.12}
            step={0.001}
            value={Math.min(hold.radius, 0.12)}
            onChange={(e) => edit({ radius: Number(e.target.value) }, 'radius')}
            className="w-full accent-amber-500"
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Depth (cm, estimate)">
          {(fid) => (
            <NumberInput id={fid} value={hold.depthCm} nullable min={0} max={200} step={0.5} placeholder="unknown" onChange={(depthCm) => edit({ depthCm }, 'depth')} />
          )}
        </Field>
        <Field label={`Confidence ${(hold.confidence * 100).toFixed(0)}%`}>
          {(fid) => (
            <input
              id={fid}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={hold.confidence}
              onChange={(e) => edit({ confidence: Number(e.target.value) }, 'confidence')}
              className="mt-2 w-full accent-amber-500"
            />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="u (0–1)">
          {(fid) => <NumberInput id={fid} value={hold.u} min={0} max={1} step={0.001} precision={4} onChange={(u) => u !== null && edit({ u }, 'u')} />}
        </Field>
        <Field label="v (0–1)">
          {(fid) => <NumberInput id={fid} value={hold.v} min={0} max={1} step={0.001} precision={4} onChange={(v) => v !== null && edit({ v }, 'v')} />}
        </Field>
      </div>
      <p className="font-mono text-[11px] text-stone-500">
        wall x {wall.x.toFixed(2)} m · y {wall.y.toFixed(2)} m · source {hold.source} · id {hold.id}
      </p>

      <Field label="Note">
        {(fid) => (
          <textarea
            id={fid}
            rows={2}
            maxLength={500}
            className={inputClass}
            value={hold.note}
            onChange={(e) => edit({ note: e.target.value }, 'note')}
          />
        )}
      </Field>
    </Section>
  )
}

function RoleButton({
  active,
  color,
  onClick,
  title,
  children,
}: {
  active: boolean
  color: string
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-semibold transition"
      style={
        active
          ? { borderColor: color, background: `${color}26`, color }
          : { borderColor: '#44403c', color: '#a8a29e' }
      }
    >
      {active ? '✓ ' : ''}
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-stone-600 bg-stone-800 px-1 py-px font-mono text-[11px] text-stone-300">{children}</kbd>
}
