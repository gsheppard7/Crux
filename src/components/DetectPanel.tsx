import { useState } from 'react'
import type { Hold, Route } from '../model/schema'
import { NAMED_COLORS, type NamedColorName, type Rgb } from '../detect/color'
import { detectHolds, type DetectResult } from '../detect/detect'
import { Button, Field, Section, Toggle } from './form'

export interface DetectPanelProps {
  route: Route
  /** Called after a successful run. Parent merges holds / floorV into the route. */
  onApply: (holds: Hold[], floorV: number | null, replaceModelHolds: boolean, meta?: DetectResult) => void
  pickMode: boolean
  onRequestPick: () => void
  sampledColor: Rgb | null
  onClearSample: () => void
}

function rgbCss(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
}

export function DetectPanel({
  route,
  onApply,
  pickMode,
  onRequestPick,
  sampledColor,
  onClearSample,
}: DetectPanelProps) {
  const [named, setNamed] = useState<NamedColorName>('pink')
  const [sensitivity, setSensitivity] = useState(0.55)
  const [includeOther, setIncludeOther] = useState(false)
  const [replaceModel, setReplaceModel] = useState(true)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const canRun = Boolean(route.image.dataUrl) && !busy

  async function run() {
    if (!route.image.dataUrl) {
      setWarnings(['Load a wall photo before running detection.'])
      return
    }
    setBusy(true)
    setSummary(null)
    setWarnings([])
    try {
      const img = await loadImage(route.image.dataUrl)
      const result = await detectHolds(img, {
        color: sampledColor ? { rgb: sampledColor, tolerance: 18 } : named,
        sensitivity,
        includeOtherColors: includeOther,
        metersPerPixel: route.wall.metersPerPixel,
        wallAngleDeg: route.wall.angleDeg,
      })
      setWarnings(result.warnings)
      setSummary(
        `${result.stats.targetCount} route hold${result.stats.targetCount === 1 ? '' : 's'}` +
          (result.stats.count > result.stats.targetCount
            ? ` (+${result.stats.count - result.stats.targetCount} other)`
            : '') +
          (result.floorV != null ? ` · floor at v=${result.floorV.toFixed(2)}` : ''),
      )
      onApply(result.holds, result.floorV, replaceModel, result)
    } catch (e) {
      setWarnings([e instanceof Error ? e.message : 'Detection failed.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Auto-detect">
      <Field label="Route color">
        {() => (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Named hold colors">
              {NAMED_COLORS.map((c) => {
                const selected = !sampledColor && named === c.name
                return (
                  <button
                    key={c.name}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    title={c.label}
                    onClick={() => {
                      onClearSample()
                      setNamed(c.name)
                    }}
                    className={`h-7 w-7 rounded-md border-2 transition ${
                      selected ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-stone-700 hover:border-stone-500'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={pickMode ? 'primary' : 'default'}
                onClick={onRequestPick}
                title="Click the photo to sample a hold color"
              >
                {pickMode ? 'Click photo…' : 'Pick from photo'}
              </Button>
              {sampledColor && (
                <>
                  <span
                    className="inline-block h-6 w-6 rounded border border-stone-600"
                    style={{ backgroundColor: rgbCss(sampledColor) }}
                    title="Sampled color"
                  />
                  <Button variant="ghost" onClick={onClearSample}>
                    Clear sample
                  </Button>
                </>
              )}
            </div>
            <p className="text-[11px] text-stone-500">
              {sampledColor
                ? 'Matching pixels near the sampled color (Lab ΔE).'
                : `Matching named color: ${named}.`}
            </p>
          </div>
        )}
      </Field>

      <Field label={`Sensitivity: ${sensitivity.toFixed(2)}`} hint="Higher finds more holds (and more noise).">
        {(id) => (
          <input
            id={id}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        )}
      </Field>

      <Toggle
        checked={includeOther}
        onChange={setIncludeOther}
        label="Include other-color holds"
        title="Keep non-route holds as off-route annotations"
      />
      <Toggle
        checked={replaceModel}
        onChange={setReplaceModel}
        label="Replace previous auto holds"
        title="Remove holds with source=model before applying"
      />

      <Button variant="primary" disabled={!canRun} onClick={() => void run()} className="w-full">
        {busy ? 'Detecting…' : 'Run detection'}
      </Button>

      {summary && <p className="text-sm text-stone-200">{summary}</p>}
      {warnings.length > 0 && (
        <ul className="space-y-1 text-[11px] leading-snug text-amber-200/90">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the route photo.'))
    img.src = src
  })
}
