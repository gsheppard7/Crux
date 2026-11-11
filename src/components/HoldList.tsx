import { useEffect, useRef, useState } from 'react'
import type { Route } from '../model/schema'
import { holdRole, holdsByHeight, toggleFinish, toggleStart } from '../model/route'
import type { CommitOptions } from '../state/useRouteEditor'
import { HOLD_TYPE_LABELS, ROLE_COLORS } from '../ui/theme'
import { Section, Segmented } from './form'

interface Props {
  route: Route
  selectedId: string | null
  onSelect: (id: string | null) => void
  apply: (fn: (r: Route) => Route, opts?: CommitOptions) => void
}

type Filter = 'all' | 'route' | 'off'

export function HoldList({ route, selectedId, onSelect, apply }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const listRef = useRef<HTMLUListElement>(null)
  const holds = holdsByHeight(route).filter((h) => (filter === 'all' ? true : filter === 'route' ? h.inRoute : !h.inRoute))
  const inRoute = route.holds.filter((h) => h.inRoute).length

  useEffect(() => {
    if (!selectedId) return
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-hold-row]') ?? []
    const el = Array.from(rows).find((row) => row.dataset.holdRow === selectedId)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  return (
    <Section
      title={`Holds (${route.holds.length})`}
      right={<span className="text-xs text-stone-500">{inRoute} in route · bottom → top</span>}
    >
      <Segmented
        ariaLabel="Filter holds"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'route', label: 'Route' },
          { value: 'off', label: 'Off route' },
        ]}
      />
      {holds.length === 0 ? (
        <p className="text-sm text-stone-500">No holds{filter !== 'all' ? ' match this filter' : ''}.</p>
      ) : (
        <ul ref={listRef} className="max-h-72 space-y-0.5 overflow-y-auto pr-1" aria-label="Hold list">
          {holds.map((h) => {
            const role = holdRole(route, h)
            const selected = h.id === selectedId
            const isStart = route.startHoldIds.includes(h.id)
            const isFinish = route.finishHoldIds.includes(h.id)
            return (
              <li key={h.id} data-hold-row={h.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => onSelect(h.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelect(h.id)
                  }}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                    selected ? 'bg-amber-500/15 ring-1 ring-amber-500/60' : 'hover:bg-stone-800'
                  }`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ROLE_COLORS[role] }} />
                  <span className="w-8 shrink-0 font-semibold text-stone-100 tabular-nums">{h.label || '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-stone-400">
                    {HOLD_TYPE_LABELS[h.type]}
                    {!h.allowHand && h.allowFoot ? ' · feet' : ''}
                    {h.allowHand && !h.allowFoot ? ' · hands' : ''}
                    {!h.inRoute ? ' · off' : ''}
                  </span>
                  <QuickToggle
                    label="S"
                    title="Toggle start"
                    active={isStart}
                    color={ROLE_COLORS.start}
                    onClick={() => apply((r) => toggleStart(r, h.id))}
                  />
                  <QuickToggle
                    label="F"
                    title="Toggle finish"
                    active={isFinish}
                    color={ROLE_COLORS.finish}
                    onClick={() => apply((r) => toggleFinish(r, h.id))}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function QuickToggle({
  label,
  title,
  active,
  color,
  onClick,
}: {
  label: string
  title: string
  active: boolean
  color: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={`${title} for hold`}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="h-6 w-6 shrink-0 rounded text-xs font-bold transition"
      style={active ? { background: color, color: '#0c0a09' } : { border: '1px solid #44403c', color: '#78716c' }}
    >
      {label}
    </button>
  )
}
