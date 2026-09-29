'use client'

import { useEffect, useState } from 'react'
import type { Action } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { describeId } from '@/lib/board'
import { orderedVariableEntries } from '@/lib/format'
import { findMarker } from '@/lib/guidance'
import { objectName, type MechanicProps } from './types'

/**
 * Set a value into a variable / slot.
 *
 * The target can be an algorithm variable (`lo`, `mid`, `best`, …) or a board
 * object, and the field is a plain text input committed with Enter or the
 * button, so the whole mechanic works from the keyboard. The value is sent as a
 * string because the action contract types it that way and the oracle owns
 * the parsing.
 */
export function AssignValue({
  spec,
  model,
  state,
  binding,
  disabled,
  picked,
  setPicked,
  dispatch,
  markers,
}: MechanicProps) {
  const variableNames = orderedVariableEntries(state.variables).map(([name]) => name)
  const [target, setTarget] = useState<string>(picked[0] ?? variableNames[0] ?? '')
  const [value, setValue] = useState('')

  // A board pick is the most direct way to choose a target, so it wins over the
  // variable default whenever it changes.
  useEffect(() => {
    if (picked[0]) setTarget(picked[0])
  }, [picked])

  const commit = (): void => {
    if (!target || value === '') return
    const action: Action = { type: 'assignValue', targetId: target, value }
    dispatch(action)
    setValue('')
  }

  const marked = target ? findMarker(markers, target) : null

  return (
    <section className="panel p-4" aria-label={binding.label}>
      {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Write a value into a box the algorithm is keeping.`}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-[0.78rem] font-semibold text-[var(--dsa-muted)]">
          <span className="mb-1 block">Into</span>
          {variableNames.length > 0 ? (
            <select
              className="input"
              value={target}
              disabled={disabled}
              onChange={(e) => {
                setTarget(e.target.value)
                setPicked([])
              }}
            >
              {variableNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {picked.map((id) => (
                <option key={id} value={id}>
                  {objectName(model, id)}
                </option>
              ))}
            </select>
          ) : (
            <span className="mono block rounded-xl border border-[var(--dsa-border)] px-3 py-2.5 text-[0.95rem]">
              {describeId(model, target)}
            </span>
          )}
          {marked ? <span className="mt-1 block text-[0.75rem] text-[var(--dsa-accent)]">{marked.target.hint}</span> : null}
        </label>

        <label className="block text-[0.78rem] font-semibold text-[var(--dsa-muted)]">
          <span className="mb-1 block">The value</span>
          <input
            className="input"
            value={value}
            disabled={disabled}
            placeholder={spec.vocabulary.object}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
            }}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={disabled || !target || value === ''} onClick={commit}>
          Save it
        </Button>
        {picked.length > 0 && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setPicked([])}>
            Clear target
          </Button>
        )}
        {value === '' && target ? (
          <span className="text-[0.8rem] text-[var(--dsa-faint)]">Type a value, then press Enter.</span>
        ) : null}
      </div>
    </section>
  )
}
