'use client'

import type { Action, Relation } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { findMarker } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { objectName, type MechanicProps } from './types'

/**
 * Pick two objects, then declare the relation between them.
 *
 * The three buttons are worded from `spec.vocabulary` (lowerWord / equalWord /
 * higherWord) rather than "lt / eq / gt" — the theme is the teaching device, and
 * the algorithmic reading is supplied on the debrief. The `aria-label`s keep the
 * algorithmic wording too, so the mapping is never fully hidden.
 *
 * REMOVED: the `Maps to comparePair(a, b, lt | eq | gt)` footer. It was a
 * sentence of TypeScript printed under a three-button control, which is a
 * declaration that the learner is reading source code rather than playing.
 */
export function ComparePair({ spec, model, binding, disabled, picked, setPicked, dispatch, markers }: MechanicProps) {
  const [aId, bId] = picked
  const ready = Boolean(aId && bId)
  const a = aId ? model.byId[aId] : undefined
  const b = bId ? model.byId[bId] : undefined

  const compare = (relation: Relation): void => {
    if (!aId || !bId) return
    const action: Action = { type: 'comparePair', aId, bId, relation }
    dispatch(action)
  }

  return (
    <section className="panel p-4" aria-label={binding.label}>
      {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Choose two ${spec.vocabulary.objectPlural}, then say which is ${spec.vocabulary.lowerWord}.`}
      </p>

      {/* The two operands, side by side, so the three buttons read as
          "which of these two" rather than three abstract options. */}
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2" aria-live="polite">
        <Operand label={aId ? objectName(model, aId) : null} marker={aId ? findMarker(markers, aId) : null} side="A" />
        <span aria-hidden className="text-[var(--dsa-faint)]">
          vs
        </span>
        <Operand label={bId ? objectName(model, bId) : null} marker={bId ? findMarker(markers, bId) : null} side="B" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          variant="primary"
          disabled={disabled || !ready}
          onClick={() => compare('lt')}
          aria-label={`${objectName(model, aId ?? '')} is less than ${objectName(model, bId ?? '')}`}
        >
          {spec.vocabulary.lowerWord}
        </Button>
        <Button
          variant="primary"
          disabled={disabled || !ready}
          onClick={() => compare('eq')}
          aria-label={`${objectName(model, aId ?? '')} equals ${objectName(model, bId ?? '')}`}
        >
          {spec.vocabulary.equalWord}
        </Button>
        <Button
          variant="primary"
          disabled={disabled || !ready}
          onClick={() => compare('gt')}
          aria-label={`${objectName(model, aId ?? '')} is greater than ${objectName(model, bId ?? '')}`}
        >
          {spec.vocabulary.higherWord}
        </Button>
      </div>

      {picked.length > 0 && (
        <Button size="sm" variant="ghost" className="mt-2.5" disabled={disabled} onClick={() => setPicked([])}>
          Put them back
        </Button>
      )}
    </section>
  )
}

function Operand({
  label,
  side,
  marker,
}: {
  label: string | null
  side: string
  marker: { target: { hint: string } } | null
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2 text-center',
        label
          ? 'border-[color:color-mix(in_oklab,var(--dsa-accent)_55%,transparent)] bg-[color-mix(in_oklab,var(--dsa-accent)_12%,transparent)]'
          : 'border-dashed border-[var(--dsa-border)]',
      )}
    >
      <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
        {label ? `side ${side}` : 'not picked'}
      </p>
      <p className="mono truncate text-[1.05rem] font-bold text-[var(--dsa-ink)]">{label ?? '—'}</p>
      {marker ? <p className="text-[0.7rem] text-[var(--dsa-accent)]">{marker.target.hint}</p> : null}
    </div>
  )
}
