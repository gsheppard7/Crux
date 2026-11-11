import type { RouteIssue } from '../model/route'
import { Section } from './form'

const ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' } as const
const COLOR = { error: 'text-rose-300', warning: 'text-amber-200', info: 'text-stone-400' } as const

export function IssuesPanel({ issues, onSelect }: { issues: RouteIssue[]; onSelect: (id: string) => void }) {
  const problems = issues.filter((i) => i.level !== 'info').length
  return (
    <Section
      title="Checks"
      right={<span className={`text-xs ${problems ? 'text-amber-300' : 'text-emerald-400'}`}>{problems ? `${problems} to review` : 'Route looks complete'}</span>}
    >
      {issues.length === 0 ? (
        <p className="text-sm text-emerald-400">No issues.</p>
      ) : (
        <ul className="space-y-1.5 text-sm" aria-label="Route checks">
          {issues.map((issue, i) => (
            <li key={i} className={`flex gap-2 ${COLOR[issue.level]}`}>
              <span aria-hidden>{ICON[issue.level]}</span>
              {issue.holdId ? (
                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onSelect(issue.holdId!)}>
                  {issue.message}
                </button>
              ) : (
                <span>{issue.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
