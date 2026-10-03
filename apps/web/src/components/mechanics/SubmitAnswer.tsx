'use client'

import { useEffect, useMemo, useState } from 'react'
import { getProblem, type Action } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { allObjectIds, describeId } from '@/lib/board'
import { findMarker } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { objectName, type MechanicProps } from './types'

/**
 * Commit the final answer.
 *
 * The target is a board object and the value is free text, because the oracle
 * accepts either an index, a value, or an outcome string. Quick-pick chips offer
 * the likely answers (the board labels, the target value, the last cursor
 * position) so a player is never stuck typing into a box — but the field stays
 * editable, since a wrong-but-honest guess is a learning event the debrief can
 * use.
 *
 * The chips are the keyboard and the phone path to an answer, not a giveaway:
 * they list what is ON THE BOARD plus the target, which the learner can already
 * read off the screen.
 */
export function SubmitAnswer({
  spec,
  model,
  state,
  binding,
  disabled,
  picked,
  setPicked,
  dispatch,
  markers,
  prompt,
}: MechanicProps) {
  const [targetId, setTargetId] = useState<string>(picked[0] ?? '')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (prompt?.answerTargetId) setTargetId(prompt.answerTargetId)
    else if (picked[0]) setTargetId(picked[0])
  }, [picked, prompt?.answerTargetId])

  const suggestions = useMemo(() => {
    const out: string[] = []
    if (typeof state.instance.target === 'number') out.push(String(state.instance.target))
    for (const id of allObjectIds(model).slice(0, 12)) {
      const object = model.byId[id]
      if (!object) continue
      if (!out.includes(object.label)) out.push(object.label)
      if (typeof object.value === 'number' && !out.includes(String(object.value))) {
        out.push(String(object.value))
      }
    }
    for (const role of ['loSlotId', 'midSlotId', 'hiSlotId', 'iSlotId', 'jSlotId'] as const) {
      const id = state.cursor[role]
      if (id) {
        const index = state.slots[id]?.index
        if (typeof index === 'number' && !out.includes(String(index))) out.push(String(index))
      }
    }
    return out.slice(0, 8)
  }, [model, state])

  const commit = (): void => {
    const trimmed = value.trim()
    if (!targetId || trimmed === '') return
    const action: Action = { type: 'submitAnswer', targetId, value: trimmed }
    dispatch(action)
  }

  const marked = targetId ? findMarker(markers, targetId) : null
  // MechanicHost hides the repeated panel heading, but the submit control still
  // needs a visible and accessible name of its own.
  const submitLabel = binding.label || 'Submit answer'

  return (
    <section className="panel p-4" aria-label={binding.label || 'SubmitAnswer'}>
      {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Say what you found and end the run.`}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-[0.78rem] font-semibold text-[var(--dsa-muted)]">
          <span className="mb-1 block">The answer is at</span>
          <select
            className="input"
            value={targetId}
            disabled={disabled || !!prompt?.answerTargetId}
            onChange={(e) => {
              setTargetId(e.target.value)
              setPicked([])
            }}
          >
            <option value="">Choose a {spec.vocabulary.object}…</option>
            {prompt?.answerTargetId && !model.byId[prompt.answerTargetId] ? <option value={prompt.answerTargetId}>Result</option> : null}
            {allObjectIds(model).map((id) => (
              <option key={id} value={id}>
                {objectName(model, id)}
              </option>
            ))}
          </select>
          {marked ? (
            <span className="mt-1 block text-[0.75rem] text-[var(--dsa-accent)]">{marked.target.hint}</span>
          ) : null}
        </label>

        <label className="block text-[0.78rem] font-semibold text-[var(--dsa-muted)]">
          <span className="mb-1 block">And the answer is</span>
          <span className="mb-1 block text-xs">
            {getProblem(state.problemId)?.answerFormat?.label ?? 'Enter the result requested by the task.'}
          </span>
          <input
            className="input"
            value={value}
            disabled={disabled}
            placeholder={getProblem(state.problemId)?.answerFormat?.placeholder ?? 'Your result'}
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

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Things already on the board">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setValue(suggestion)}
            className={cn(value === suggestion && 'border-[var(--dsa-accent)] text-[var(--dsa-accent)]')}
          >
            {suggestion}
          </Button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={disabled || !targetId || value.trim() === ''} onClick={commit}>
          {submitLabel}
        </Button>
        {targetId ? (
          <span className="text-[0.78rem] text-[var(--dsa-faint)]">
            for <span className="font-semibold text-[var(--dsa-ink)]">{describeId(model, targetId)}</span>
          </span>
        ) : null}
      </div>
    </section>
  )
}
