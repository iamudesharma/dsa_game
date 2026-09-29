'use client'

import { useMemo } from 'react'
import type { Action } from '@dsa/game-schema'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { describeId } from '@/lib/board'
import { findMarker } from '@/lib/guidance'
import { objectName, type MechanicProps } from './types'

/**
 * Advance the list cursor along `state.links`.
 *
 * The successor is computed from the links, not guessed: `next` first, then
 * `prev` (a player mid-reversal follows a `prev` edge). If the cursor is unset
 * we start from the head, which is the algorithm's real initial state.
 */
export function TraverseNode({ spec, model, state, binding, disabled, dispatch, markers }: MechanicProps) {
  const currentId = state.cursor.nodeId ?? model.headNodeId

  const successors = useMemo(() => {
    if (!currentId) return []
    const forward = state.links.find((l) => l.from === currentId && l.kind === 'next')
    if (forward) return [forward.to]
    const backward = state.links.find((l) => l.from === currentId && l.kind === 'prev')
    return backward ? [backward.to] : []
  }, [currentId, state.links])

  const advance = (toNodeId: string): void => {
    if (!currentId) return
    const action: Action = { type: 'traverseNode', fromNodeId: currentId, toNodeId }
    dispatch(action)
  }

  if (!currentId) {
    return (
      <section className="panel p-4" aria-label={binding.label}>
        {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
        <p className="mt-2 text-[0.92rem] text-[var(--dsa-muted)]">This board has no chain to walk.</p>
      </section>
    )
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
        {binding.hint ?? `Follow the pointer to the next value along the ${spec.vocabulary.place}.`}
      </p>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-[0.95rem] text-[var(--dsa-muted)]" aria-live="polite">
        <span className="text-[0.7rem] font-semibold tracking-[0.14em] uppercase">the pointer is on</span>
        <motion.span
          key={currentId}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="mono rounded-xl border-2 border-[var(--dsa-accent)] px-3 py-1.5 text-[1rem] font-bold text-[var(--dsa-ink)]"
        >
          {describeId(model, currentId)}
        </motion.span>
      </p>

      {successors.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {successors.map((id) => {
            const marked = findMarker(markers, id)
            return (
              <Button
                key={id}
                variant={marked ? 'accent' : 'primary'}
                disabled={disabled}
                onClick={() => advance(id)}
                aria-label={`Move the pointer to ${objectName(model, id)}`}
              >
                Follow the link to {objectName(model, id)}
              </Button>
            )
          })}
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-[color:color-mix(in_oklab,var(--dsa-success)_45%,transparent)] bg-[color-mix(in_oklab,var(--dsa-success)_10%,transparent)] px-3 py-2.5 text-[0.95rem] text-[var(--dsa-ink)]">
          No link leaves this one — you have reached the end of the chain. In the code that is a null pointer, and
          reaching it is how a walk like this one knows to stop.
        </p>
      )}

      {state.cursor.prevNodeId ? (
        <p className="mt-2.5 text-[0.85rem] text-[var(--dsa-muted)]">
          The one behind it:{' '}
          <span className="font-semibold text-[var(--dsa-ink)]">{describeId(model, state.cursor.prevNodeId)}</span>
        </p>
      ) : null}
    </section>
  )
}
