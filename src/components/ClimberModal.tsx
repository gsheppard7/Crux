import { useMemo, useState } from 'react'
import {
  CLIMB_STYLES,
  DEFAULT_CLIMBER,
  bodyDims,
  formatFeetInches,
  inchesToM,
  kgToLb,
  mToInches,
  saveClimber,
  type ClimberProfile,
  type ClimbStyle,
} from '../climber/profile'
import { AVATAR_PRESETS } from '../ui/avatarTheme'
import { Modal } from './Modal'
import { Button, Field, NumberInput, TextInput, inputClass } from './form'

export function ClimberModal({
  profile,
  avatarColor,
  onSave,
  onClose,
}: {
  profile: ClimberProfile
  avatarColor: string
  onSave: (p: ClimberProfile, color: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(profile)
  const [color, setColor] = useState(avatarColor)
  const dims = useMemo(() => bodyDims(draft), [draft])
  const totalIn = Math.round(mToInches(draft.heightM))
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn % 12
  const ape = draft.wingspanM - draft.heightM

  const set = <K extends keyof ClimberProfile>(key: K, value: ClimberProfile[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const setHeightInches = (total: number) => {
    const m = inchesToM(Math.max(48, Math.min(90, total)))
    const apeKeep = draft.wingspanM - draft.heightM
    setDraft((d) => ({ ...d, heightM: m, wingspanM: m + apeKeep }))
  }

  return (
    <Modal
      title="Climber"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft(DEFAULT_CLIMBER)}>
            Reset default
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              saveClimber(draft)
              onSave(draft, color)
              onClose()
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">{(id) => <TextInput id={id} value={draft.name} onChange={(v) => set('name', v)} maxLength={40} />}</Field>

      <Field label="Avatar color on the photo">
        {() => (
          <div className="flex flex-wrap gap-2">
            {AVATAR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => setColor(p.color)}
                className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-stone-900 ${color.toLowerCase() === p.color.toLowerCase() ? 'ring-amber-400' : 'ring-transparent'}`}
                style={{ backgroundColor: p.color }}
                aria-label={p.label}
              />
            ))}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Height">
          {(id) => (
            <div className="flex items-center gap-1">
              <NumberInput id={id} value={ft} min={4} max={7} step={1} onChange={(v) => setHeightInches((v ?? ft) * 12 + inch)} />
              <span className="text-xs text-stone-500">ft</span>
              <NumberInput value={inch} min={0} max={11} step={1} onChange={(v) => setHeightInches(ft * 12 + (v ?? inch))} />
              <span className="text-xs text-stone-500">in</span>
            </div>
          )}
        </Field>
        <Field label="Height (cm)" hint={formatFeetInches(draft.heightM)}>
          {(id) => (
            <NumberInput
              id={id}
              value={Math.round(draft.heightM * 100)}
              min={120}
              max={230}
              step={1}
              onChange={(v) => {
                if (v == null) return
                const m = v / 100
                const apeKeep = draft.wingspanM - draft.heightM
                setDraft((d) => ({ ...d, heightM: m, wingspanM: m + apeKeep }))
              }}
            />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Wingspan (cm)" hint={`Ape index ${ape >= 0 ? '+' : ''}${(ape * 100).toFixed(0)} cm`}>
          {(id) => (
            <NumberInput
              id={id}
              value={Math.round(draft.wingspanM * 100)}
              min={110}
              max={250}
              step={1}
              onChange={(v) => v != null && set('wingspanM', v / 100)}
            />
          )}
        </Field>
        <Field label="Weight" hint={`${Math.round(kgToLb(draft.weightKg))} lb`}>
          {(id) => (
            <div className="flex items-center gap-1">
              <NumberInput id={id} value={Math.round(draft.weightKg)} min={30} max={160} step={1} onChange={(v) => v != null && set('weightKg', v)} />
              <span className="text-xs text-stone-500">kg</span>
            </div>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Age">
          {(id) => <NumberInput id={id} value={draft.ageYears} min={6} max={90} step={1} onChange={(v) => v != null && set('ageYears', v)} />}
        </Field>
        <Field label="Hardest V-grade sent">
          {(id) => <NumberInput id={id} value={draft.maxGrade} min={0} max={17} step={1} onChange={(v) => v != null && set('maxGrade', v)} />}
        </Field>
      </div>

      <Field label="Style">
        {(id) => (
          <select id={id} className={inputClass} value={draft.style} onChange={(e) => set('style', e.target.value as ClimbStyle)}>
            {CLIMB_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </Field>

      {(
        [
          ['fingerStrength', 'Finger strength'],
          ['pullStrength', 'Pull / lock-off'],
          ['core', 'Core / tension'],
          ['power', 'Power'],
          ['flexibility', 'Flexibility'],
        ] as const
      ).map(([key, label]) => (
        <Field key={key} label={`${label} (${Math.round(draft[key] * 100)}%)`}>
          {(id) => (
            <input
              id={id}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={draft[key]}
              onChange={(e) => set(key, Number(e.target.value))}
              className="w-full accent-amber-500"
            />
          )}
        </Field>
      ))}

      <div className="rounded-lg border border-stone-800 bg-stone-950/60 p-3 text-[11px] text-stone-400">
        <div className="mb-1 font-semibold tracking-wider text-stone-500 uppercase">Derived</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <span>Standing reach</span>
          <span className="text-right text-stone-200">{dims.standingReach.toFixed(2)} m</span>
          <span>Arm (shoulder→grip)</span>
          <span className="text-right text-stone-200">{dims.arm.toFixed(2)} m</span>
          <span>Leg</span>
          <span className="text-right text-stone-200">{dims.leg.toFixed(2)} m</span>
          <span>Shoulder width</span>
          <span className="text-right text-stone-200">{(dims.shoulderWidth * 100).toFixed(0)} cm</span>
        </div>
      </div>
    </Modal>
  )
}
