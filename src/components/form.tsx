import { useId, useState, type ReactNode } from 'react'

export function Section({
  title,
  right,
  children,
  defaultOpen = true,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-stone-800">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-xs font-semibold tracking-wider text-stone-400 uppercase hover:text-stone-200"
          aria-expanded={open}
        >
          <span className={`inline-block transition ${open ? 'rotate-90' : ''}`}>▸</span>
          {title}
        </button>
        {right}
      </div>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-stone-400">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-[11px] leading-snug text-stone-500">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-500 focus:outline-none disabled:opacity-50'

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
}) {
  return (
    <input
      id={id}
      type="text"
      className={inputClass}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * Numeric input that keeps a local draft while typing, commits only valid
 * numbers, and reverts to the model value on blur.
 */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  nullable,
  placeholder,
  precision,
  ariaLabel,
}: {
  id?: string
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  max?: number
  step?: number
  nullable?: boolean
  placeholder?: string
  precision?: number
  ariaLabel?: string
}) {
  const format = (v: number | null) => (v === null ? '' : precision !== undefined ? String(Number(v.toFixed(precision))) : String(v))
  const [draft, setDraft] = useState(format(value))
  const [focused, setFocused] = useState(false)
  const shown = focused ? draft : format(value)
  const invalid = (() => {
    if (!focused) return false
    if (draft.trim() === '') return !nullable
    const n = Number(draft)
    return !Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)
  })()
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="number"
      inputMode="decimal"
      className={`${inputClass} ${invalid ? 'border-rose-500 focus:border-rose-500' : ''}`}
      aria-invalid={invalid}
      value={shown}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onFocus={() => {
        setDraft(format(value))
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        if (text.trim() === '') {
          if (nullable) onChange(null)
          return
        }
        const n = Number(text)
        if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n)
      }}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  title?: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-200" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-stone-600 bg-stone-900 accent-amber-500"
      />
      {label}
    </label>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
            o.value === value
              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
              : 'border-stone-700 text-stone-300 hover:border-stone-500'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
  className = '',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  title?: string
  className?: string
  type?: 'button' | 'submit'
}) {
  const styles = {
    default: 'border border-stone-700 bg-stone-800 text-stone-100 hover:bg-stone-700',
    primary: 'bg-amber-500 text-stone-950 hover:bg-amber-400',
    danger: 'border border-rose-800 bg-rose-950 text-rose-200 hover:bg-rose-900',
    ghost: 'text-stone-300 hover:bg-stone-800',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}
