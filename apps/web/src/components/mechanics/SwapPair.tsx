'use client'

import type { Action } from '@dsa/game-schema'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { objectName, type MechanicProps } from './types'

/**
 * Exchange two objects' positions.
 *
 * The two picked names are shown as a "before → after" pair so the EFFECT of a
 * swap is unambiguous before committing — a swap is the hardest action to
 * picture from a row of tiles, and it costs four lines of JSX.
 */
export function SwapPair({ spec, model, binding, disabled, picked, setPicked, dispatch }: MechanicProps) {
  const [aId, bId] = picked
  const ready = Boolean(aId && bId && aId !== bId)

  const swap = (): void => {
    if (!aId || !bId) return
    const action: Action = { type: 'swapPair', aId, bId }
    dispatch(action)
  }

  return (
    <section className="panel p-4" aria-label={binding.label}>
      <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Choose two ${spec.vocabulary.objectPlural} to put in each other's place.`}
      </p>

      <div className="mt-3 flex min-h-14 items-center gap-3" aria-live="polite">
        {ready && aId && bId ? (
          <motion.span
            key={`${aId}-${bId}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="mono rounded-xl border-2 border-[var(--dsa-primary)] px-3 py-1.5 text-[1rem] font-bold text-[var(--dsa-ink)]">
              {objectName(model, aId)}
            </span>
            <span aria-hidden className="text-[1.1rem] text-[var(--dsa-faint)]">
              ⇄
            </span>
            <span className="mono rounded-xl border-2 border-[var(--dsa-accent)] px-3 py-1.5 text-[1rem] font-bold text-[var(--dsa-ink)]">
              {objectName(model, bId)}
            </span>
          </motion.span>
        ) : (
          <span className="text-[0.92rem] text-[var(--dsa-muted)]">
            {picked.length === 0
              ? `Pick two ${spec.vocabulary.objectPlural} on the board.`
              : `One picked: ${objectName(model, picked[0] ?? '')}. Now pick the other one.`}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={disabled || !ready} onClick={swap} aria-label="Put them in each other's place">
          Swap them
        </Button>
        {picked.length > 0 && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setPicked([])}>
            Put them back
          </Button>
        )}
      </div>
    </section>
  )
}
