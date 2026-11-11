import { useState } from 'react'
import type { Hold, Route } from '../model/schema'
import {
  defaultMetersPerPixel,
  metersPerPixelFromReferenceHold,
  metersPerPixelFromWallWidth,
  wallProfile,
  wallSize,
} from '../model/coords'
import { setMeta, setWall } from '../model/route'
import type { CommitOptions } from '../state/useRouteEditor'
import { Button, Field, NumberInput, Section, Segmented, TextInput, inputClass } from './form'

interface Props {
  route: Route
  selected: Hold | undefined
  apply: (fn: (r: Route) => Route, opts?: CommitOptions) => void
}

const ANGLE_PRESETS = [
  { value: -10, label: 'Slab −10°' },
  { value: 0, label: 'Vertical' },
  { value: 20, label: '20°' },
  { value: 30, label: '30°' },
  { value: 45, label: '45°' },
  { value: 70, label: 'Roof 70°' },
]

const SCALE_LABELS: Record<Route['wall']['scaleSource'], string> = {
  default: 'uncalibrated default',
  'wall-width': 'from visible wall width',
  'reference-hold': 'from a reference hold',
}

export function RoutePanel({ route, selected, apply }: Props) {
  const { widthM, heightM } = wallSize(route.image, route.wall.metersPerPixel)
  const [widthInput, setWidthInput] = useState<number | null>(null)
  const [refCm, setRefCm] = useState<number | null>(null)

  return (
    <>
      <Section title="Route">
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label="Name">
            {(id) => <TextInput id={id} value={route.name} maxLength={120} onChange={(name) => apply((r) => setMeta(r, { name }), { coalesceKey: 'meta:name' })} />}
          </Field>
          <Field label="Grade">
            {(id) => (
              <TextInput id={id} value={route.grade} maxLength={20} placeholder="V3" onChange={(grade) => apply((r) => setMeta(r, { grade }), { coalesceKey: 'meta:grade' })} />
            )}
          </Field>
        </div>
        <Field label="Feet">
          {() => (
            <Segmented
              ariaLabel="Foot rule"
              value={route.footRule}
              onChange={(footRule) => apply((r) => setMeta(r, { footRule }))}
              options={[
                { value: 'open', label: 'Open feet', title: 'Any foothold on the wall' },
                { value: 'route-only', label: 'Feet follow hands', title: 'Only route holds for feet' },
              ]}
            />
          )}
        </Field>
        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              className={inputClass}
              value={route.notes}
              maxLength={5000}
              onChange={(e) => apply((r) => setMeta(r, { notes: e.target.value }), { coalesceKey: 'meta:notes' })}
            />
          )}
        </Field>
      </Section>

      <Section title="Wall & scale" right={<span className="text-xs text-stone-400 capitalize">{wallProfile(route.wall.angleDeg)}</span>}>
        <Field label={`Wall angle: ${route.wall.angleDeg}° ${route.wall.angleDeg > 0 ? 'overhang' : route.wall.angleDeg < 0 ? 'slab' : '(vertical)'}`}>
          {(id) => (
            <div className="flex items-center gap-2">
              <input
                id={id}
                type="range"
                min={-30}
                max={90}
                step={1}
                value={route.wall.angleDeg}
                onChange={(e) => apply((r) => setWall(r, { angleDeg: Number(e.target.value) }), { coalesceKey: 'wall:angle' })}
                className="w-full accent-amber-500"
              />
              <div className="w-16 shrink-0">
                <NumberInput
                  ariaLabel="Wall angle degrees"
                  value={route.wall.angleDeg}
                  min={-45}
                  max={90}
                  onChange={(v) => v !== null && apply((r) => setWall(r, { angleDeg: v }), { coalesceKey: 'wall:angle' })}
                />
              </div>
            </div>
          )}
        </Field>
        <Segmented
          ariaLabel="Wall angle presets"
          value={route.wall.angleDeg}
          onChange={(angleDeg) => apply((r) => setWall(r, { angleDeg }))}
          options={ANGLE_PRESETS}
        />

        <div className="rounded-md border border-stone-800 bg-stone-950/60 p-2.5 text-xs text-stone-400">
          Photo covers ≈ <b className="text-stone-200">{widthM.toFixed(2)} × {heightM.toFixed(2)} m</b> of wall ({SCALE_LABELS[route.wall.scaleSource]}).
          <br />
          {(route.wall.metersPerPixel * 1000).toFixed(2)} mm per image pixel.
        </div>

        <Field label="Calibrate: visible wall width (m)" hint="Width of the wall area spanned by the photo's full width.">
          {(id) => (
            <div className="flex gap-2">
              <NumberInput id={id} value={widthInput} nullable min={0.2} max={50} step={0.1} placeholder={widthM.toFixed(2)} onChange={setWidthInput} />
              <Button
                disabled={widthInput === null}
                onClick={() =>
                  widthInput !== null &&
                  apply((r) => setWall(r, { metersPerPixel: metersPerPixelFromWallWidth(widthInput, r.image), scaleSource: 'wall-width' }))
                }
              >
                Apply
              </Button>
            </div>
          )}
        </Field>

        <Field
          label="Calibrate: selected hold diameter (cm)"
          hint={selected ? `Uses hold ${selected.label || selected.id}'s drawn circle as the reference.` : 'Select a hold of known size first.'}
        >
          {(id) => (
            <div className="flex gap-2">
              <NumberInput id={id} value={refCm} nullable min={1} max={300} step={1} placeholder="e.g. 20" onChange={setRefCm} />
              <Button
                disabled={!selected || refCm === null}
                onClick={() =>
                  selected &&
                  refCm !== null &&
                  apply((r) =>
                    setWall(r, {
                      metersPerPixel: metersPerPixelFromReferenceHold(refCm / 100, selected.radius, r.image),
                      scaleSource: 'reference-hold',
                    }),
                  )
                }
              >
                Apply
              </Button>
            </div>
          )}
        </Field>
        {route.wall.scaleSource !== 'default' && (
          <Button
            variant="ghost"
            className="px-0 text-xs"
            onClick={() => apply((r) => setWall(r, { metersPerPixel: defaultMetersPerPixel(r.image), scaleSource: 'default' }))}
          >
            Reset to uncalibrated default
          </Button>
        )}
      </Section>
    </>
  )
}
