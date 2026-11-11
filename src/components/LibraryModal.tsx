import { useEffect, useState } from 'react'
import type { Route } from '../model/schema'
import { listClimbs, loadClimb, type ClimbMeta } from '../lib/library'
import { sampleRoutes } from '../samples/sampleRoutes'
import { Modal } from './Modal'
import { Button } from './form'

function formatRelativeDate(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const sec = Math.round((now - t) / 1000)
  if (sec < 45) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 14) return `${Math.floor(sec / 86400)}d ago`
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatAngle(deg: number): string {
  if (deg === 0) return 'vertical'
  if (deg > 0) return `${deg}° overhang`
  return `${Math.abs(deg)}° slab`
}

export function LibraryModal({
  open,
  onClose,
  onLoad,
  onDelete,
}: {
  open: boolean
  onClose: () => void
  onLoad: (route: Route, message: string) => void
  onDelete: (id: string) => void | Promise<void>
}) {
  const [climbs, setClimbs] = useState<ClimbMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listClimbs()
      .then((rows) => {
        if (cancelled) return
        setClimbs(rows)
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || 'Could not read the climb library.')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <Modal title="Climb library" onClose={onClose}>
      {error && <p className="rounded-md border border-rose-900 bg-rose-950/60 px-3 py-2 text-rose-200">{error}</p>}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wider text-stone-400 uppercase">Saved climbs</h3>
        {climbs.length === 0 ? (
          <p className="text-sm text-stone-500">No saved climbs yet. Export or save a route to keep it here.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Saved climbs">
            {climbs.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-stone-800 bg-stone-950/50 px-3 py-2"
              >
                {c.thumbDataUrl ? (
                  <img
                    src={c.thumbDataUrl}
                    alt=""
                    className="h-12 w-9 shrink-0 rounded object-cover ring-1 ring-stone-700"
                  />
                ) : (
                  <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-stone-800 text-[10px] text-stone-500 ring-1 ring-stone-700">
                    —
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-stone-100">
                    {c.name || 'Untitled route'}
                    {c.grade ? <span className="ml-2 text-amber-400/90">{c.grade}</span> : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-stone-500">
                    {c.holdCount} hold{c.holdCount === 1 ? '' : 's'} · {formatAngle(c.angleDeg)} ·{' '}
                    {formatRelativeDate(c.updatedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <Button
                    variant="primary"
                    disabled={busyId === c.id}
                    onClick={async () => {
                      setBusyId(c.id)
                      try {
                        const route = await loadClimb(c.id)
                        onLoad(route, `Loaded “${route.name}”`)
                        onClose()
                      } catch (e) {
                        setError((e as Error).message || 'Could not load climb.')
                      } finally {
                        setBusyId(null)
                      }
                    }}
                  >
                    Open
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busyId === c.id}
                    onClick={async () => {
                      setBusyId(c.id)
                      try {
                        await onDelete(c.id)
                        setClimbs((prev) => prev.filter((x) => x.id !== c.id))
                      } catch (e) {
                        setError((e as Error).message || 'Could not delete climb.')
                      } finally {
                        setBusyId(null)
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 border-t border-stone-800 pt-3">
        <h3 className="text-xs font-semibold tracking-wider text-stone-400 uppercase">Samples</h3>
        <ul className="space-y-1" aria-label="Sample routes">
          {sampleRoutes.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-stone-800/70"
            >
              <div className="min-w-0">
                <span className="font-medium text-stone-100">{s.name}</span>
                <span className="ml-2 text-amber-400/90">{s.grade}</span>
              </div>
              <Button
                onClick={() => {
                  const route = s.load()
                  onLoad(route, `Loaded sample “${route.name}”`)
                  onClose()
                }}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  )
}
