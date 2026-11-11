import { useEffect, useMemo, useState } from 'react'
import type { ClimberProfile } from '../climber/profile'
import { buildContext } from '../planner/context'
import { planBeta, type PlanOptions } from '../planner/search'
import type { Beta, BetaStep, PlanResult } from '../planner/types'
import type { Route } from '../model/schema'
import { usePlayback } from '../state/usePlayback'
import { Button, Section } from './form'

export interface BetaPlayback {
  beta: Beta | null
  time: number
  ctx: ReturnType<typeof buildContext> | null
}

function computeRouteStamp(route: Route, profile: ClimberProfile) {
  return `${route.id}|${route.updatedAt}|${route.holds.length}|${route.wall.angleDeg}|${profile.name}|${profile.heightM}`
}

export function BetaPanel({
  route,
  profile,
  sessionStamp,
  initialPlan,
  initialBetaIndex,
  onEditClimber,
  onPlayback,
  onPlanSaved,
}: {
  route: Route
  profile: ClimberProfile
  /** When the parent loads a saved climb, pass `route.session?.stamp` to restore plan state. */
  sessionStamp: string
  initialPlan: PlanResult | null
  initialBetaIndex: number
  onEditClimber: () => void
  onPlayback: (p: BetaPlayback) => void
  onPlanSaved: (plan: PlanResult, betaIndex: number, stamp: string) => void
}) {
  const [result, setResult] = useState<PlanResult | null>(initialPlan)
  const [busy, setBusy] = useState(false)
  const [betaIndex, setBetaIndex] = useState(initialBetaIndex)
  const [speed, setSpeed] = useState(1)
  const [savedStamp, setSavedStamp] = useState(sessionStamp)
  const stamp = computeRouteStamp(route, profile)
  const betas = result?.ok ? result.betas : result?.partial ? [result.partial] : []
  const beta = betas[Math.min(betaIndex, Math.max(0, betas.length - 1))] ?? null
  const stale = result !== null && savedStamp !== stamp

  const run = (opts?: PlanOptions) => {
    setBusy(true)
    window.setTimeout(() => {
      try {
        const res = planBeta(route, profile, opts)
        setResult(res)
        setBetaIndex(0)
        setSavedStamp(stamp)
        onPlanSaved(res, 0, stamp)
      } finally {
        setBusy(false)
      }
    }, 20)
  }

  return (
    <Section
      title="Beta"
      right={
        <button type="button" className="text-[11px] text-amber-400 hover:underline" onClick={onEditClimber}>
          Edit climber
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => run()}>
          {busy ? 'Working…' : 'Find beta ▶'}
        </Button>
        {stale && <span className="text-[11px] text-amber-400">Route or climber changed — re-run or save to refresh</span>}
      </div>

      {result && (
        <BetaResult
          key={`${beta?.id ?? 'none'}-${sessionStamp}`}
          result={result}
          betas={betas}
          beta={beta}
          betaIndex={betaIndex}
          setBetaIndex={(i) => {
            setBetaIndex(i)
            if (result) onPlanSaved(result, i, savedStamp)
          }}
          speed={speed}
          setSpeed={setSpeed}
          route={route}
          profile={profile}
          onPlayback={onPlayback}
        />
      )}
    </Section>
  )
}

function BetaResult({
  result,
  betas,
  beta,
  betaIndex,
  setBetaIndex,
  speed,
  setSpeed,
  route,
  profile,
  onPlayback,
}: {
  result: PlanResult
  betas: Beta[]
  beta: Beta | null
  betaIndex: number
  setBetaIndex: (i: number) => void
  speed: number
  setSpeed: (s: number) => void
  route: Route
  profile: ClimberProfile
  onPlayback: (p: BetaPlayback) => void
}) {
  const playback = usePlayback(beta?.steps.length ?? 0, speed)
  const ctx = useMemo(() => (beta ? buildContext(route, profile) : null), [beta, route, profile])

  useEffect(() => {
    onPlayback({ beta, time: playback.time, ctx })
  }, [beta, playback.time, ctx, onPlayback])

  const effort = (s: BetaStep) => Math.max(s.statics.uMax, s.uMid ?? 0)

  return (
    <div className="space-y-2 text-xs text-stone-300">
      {result.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-amber-300/90">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {!result.ok && (
        <div className="rounded-md border border-rose-900/60 bg-rose-950/40 p-2 text-rose-200">
          <div className="font-medium">{result.reason}</div>
          {result.diagnostics.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[11px] text-rose-300/90">
              {result.diagnostics.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result.ok && betas.length > 1 && (
        <div className="flex gap-1">
          {betas.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBetaIndex(i)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${i === betaIndex ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {beta && (
        <>
          <p className="text-stone-200">{beta.summary}</p>
          <p className="text-[11px] text-stone-500">
            Verdict: <span className="text-stone-300">{beta.verdict}</span>
            {beta.caveats.length > 0 ? ` · ${beta.caveats.join(' · ')}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" onClick={playback.first} aria-label="First">
              ⏮
            </Button>
            <Button variant="ghost" onClick={playback.prev} aria-label="Previous">
              ◀
            </Button>
            <Button onClick={playback.toggle}>{playback.playing ? 'Pause' : 'Play'}</Button>
            <Button variant="ghost" onClick={playback.next} aria-label="Next">
              ▶
            </Button>
            <Button variant="ghost" onClick={playback.last} aria-label="Last">
              ⏭
            </Button>
            <select
              className="ml-auto rounded border border-stone-700 bg-stone-950 px-1.5 py-1 text-[11px]"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label="Playback speed"
            >
              {[0.5, 1, 1.5, 2].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, beta.steps.length - 1)}
            step={0.01}
            value={playback.time}
            onChange={(e) => {
              playback.pause()
              playback.setTime(Number(e.target.value))
            }}
            className="w-full accent-amber-500"
          />
          <ol className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {beta.steps.map((s) => {
              const active = s.index === playback.stepIndex
              const e = effort(s)
              return (
                <li key={s.index}>
                  <button
                    type="button"
                    onClick={() => playback.setStep(s.index)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${active ? 'bg-amber-500/15 ring-1 ring-amber-500/40' : 'hover:bg-stone-800/80'}`}
                  >
                    <span className="w-5 shrink-0 text-[10px] text-stone-500">{s.index}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-stone-100">{s.title}</span>
                      {s.detail[0] && <span className="block text-[10px] text-stone-500">{s.detail[0]}</span>}
                    </span>
                    <span className="mt-1 h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-stone-800">
                      <span
                        className={`block h-full ${e > 1 ? 'bg-rose-500' : e > 0.75 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.min(100, e * 100)}%` }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="text-[10px] text-stone-600">
            Searched {result.stats.expanded} positions in {result.stats.ms} ms
          </p>
        </>
      )}
    </div>
  )
}
