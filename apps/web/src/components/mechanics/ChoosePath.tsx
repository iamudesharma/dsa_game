'use client'

import { useState } from 'react'
import type { Action } from '@dsa/game-schema'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { describeId } from '@/lib/board'
import type { BranchChoice, BranchChoices } from '@/lib/guidance'
import { deriveBranchChoices, findMarker } from '@/lib/guidance'
import { cn } from '@/lib/format'
import type { MechanicProps } from './types'

/**
 * Narrow the remaining search space by keeping one half.
 *
 * This is the move that makes a halving algorithm fast, and it is the step a
 * learner is most often left unable to take, so the mechanics here are not
 * cosmetic:
 *
 * 1. `fromId` MUST be the mid OBJECT id, not the mid SLOT id. The oracle
 *    rejects a slot with "That object is not on the board." `BoardModel`
 *    exposes `defaultFromId` as a slot id, so deriving it from the window is
 *    what makes this control work at all.
 *
 * 2. `BoardModel.pathOptions` is EMPTY for the board shapes these oracles
 *    produce — every element sits in a `kind: 'default'` slot, and the old
 *    option builder only looked at `left`/`right`/`source` slots and loose
 *    `path`/`door`/`room` objects. The old renderer therefore showed "This
 *    instance exposes no branches" and the decisive step of the algorithm was
 *    unreachable. The two halves are now derived from the live window, and the
 *    oracle accepts the literal ids `'left'` and `'right'`.
 *
 * 3. Each button is labelled with the INDICES IT KEEPS — "keep 0–2". That is
 *    `hi = mid - 1` and `lo = mid + 1` made visible, and it transfers to any
 *    halving algorithm, which a cell you have to tap correctly does not. A side
 *    that is already empty is shown but disabled, because "there is nothing left
 *    on that side" is a real and useful thing for a learner to see.
 *
 * 4. "You found it" is a DIFFERENT turn that happens to share this mechanic, and
 *    it is only distinguishable by `prompt.dsaOp === 'terminate'`. A wrong
 *    `choosePath` rules the target out and ends the run, so the irreversible
 *    button is only rendered when the oracle has said this is the hit turn — and
 *    on a server that sends no prompt it is not rendered at all. The safe
 *    default is to not offer the move that can destroy the game.
 *
 * REMOVED: the per-option `mono 0.6rem` raw id under each label.
 */
export function ChoosePath({ spec, state, model, binding, disabled, dispatch, markers, prompt }: MechanicProps) {
  const [chosen, setChosen] = useState<string | null>(null)
  const branches: BranchChoices | null = deriveBranchChoices(state)
  const fromId = branches?.fromId ?? ''
  const slotOptions = model.pathOptions
  // The only safe gate on the irreversible "report the hit" move.
  const isHitTurn = prompt?.dsaOp === 'terminate'

  const choose = (pathId: string, from: string): void => {
    if (!from) return
    setChosen(pathId)
    const action: Action = { type: 'choosePath', fromId: from, pathId }
    dispatch(action)
  }

  return (
    <section className="panel p-4" aria-label={binding.label}>
      <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Keep one side of the ${spec.vocabulary.place} and throw the other away.`}
      </p>

      {branches ? (
        <>
          {isHitTurn ? (
            <>
              <p className="mt-2.5 text-[0.95rem] text-[var(--dsa-ink)]">
                That is the one. Report it and the run ends here.
              </p>
              <div className="mt-3">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  disabled={disabled || !fromId}
                  onClick={() => choose('found', fromId)}
                  className="btn btn-primary min-h-14 w-full text-[1.05rem] font-bold"
                  aria-label={`Report that ${describeId(model, fromId)} is the target`}
                >
                  That&rsquo;s it — I found it
                </motion.button>
              </div>
              {/* The sides stay reachable, but behind a disclosure: a learner
                  who is not sure has to go looking for the alternative, which
                  is a deliberate friction against ending the run by accident. */}
              <details className="mt-3 text-[0.85rem] text-[var(--dsa-muted)]">
                <summary className="cursor-pointer select-none">I am not sure — keep looking instead</summary>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <BranchButton
                    choice={branches.left}
                    fromId={branches.fromId}
                    disabled={disabled}
                    chosen={chosen === branches.left.pathId}
                    marked={false}
                    onChoose={choose}
                  />
                  <BranchButton
                    choice={branches.right}
                    fromId={branches.fromId}
                    disabled={disabled}
                    chosen={chosen === branches.right.pathId}
                    marked={false}
                    onChoose={choose}
                  />
                </div>
              </details>
            </>
          ) : (
            <>
              <p className="mt-2.5 text-[0.92rem] text-[var(--dsa-muted)]">
                The middle is{' '}
                <span className="font-semibold text-[var(--dsa-ink)]">{describeId(model, branches.fromId)}</span>. Keeping
                one side is what makes the next step cheaper than the last one.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <BranchButton
                  choice={branches.left}
                  fromId={branches.fromId}
                  disabled={disabled}
                  chosen={chosen === branches.left.pathId}
                  marked={findMarker(markers, branches.fromId) !== null}
                  onChoose={choose}
                />
                <BranchButton
                  choice={branches.right}
                  fromId={branches.fromId}
                  disabled={disabled}
                  chosen={chosen === branches.right.pathId}
                  marked={findMarker(markers, branches.fromId) !== null}
                  onChoose={choose}
                />
              </div>
              <p className="mt-2.5 text-[0.82rem] text-[var(--dsa-faint)]">
                The window right now runs from{' '}
                <span className="mono font-semibold text-[var(--dsa-ink)]">{branches.lo}</span> to{' '}
                <span className="mono font-semibold text-[var(--dsa-ink)]">{branches.hi}</span>, so{' '}
                {branches.hi - branches.lo + 1} could still hold it.
              </p>
            </>
          )}
        </>
      ) : slotOptions.length > 0 ? (
        <>
          <p className="mt-2.5 text-[0.92rem] text-[var(--dsa-muted)]">Choose a way through.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {slotOptions.map((option) => {
              const marked = findMarker(markers, option.id, option.objectId, option.slotId)
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  disabled={disabled || !fromId}
                  onClick={() => choose(option.id, fromId)}
                  className={cn(
                    'btn min-h-16 flex-col items-start gap-0.5 px-3.5 py-2.5 text-left',
                    marked !== null && 'target-breathe border-[var(--dsa-accent)]',
                    chosen === option.id && 'border-[var(--dsa-success)] text-[var(--dsa-success)]',
                  )}
                  aria-label={`${binding.label}: keep ${option.label}`}
                >
                  <span className="text-[1rem] font-semibold">{option.label}</span>
                  {marked ? (
                    <span className="text-[0.75rem] font-normal text-[var(--dsa-accent)]">{marked.target.hint}</span>
                  ) : null}
                </motion.button>
              )
            })}
          </div>
        </>
      ) : (
        <p className="mt-3 text-[0.92rem] text-[var(--dsa-muted)]">
          There is no window to halve on this board. One of the other operations will do the job.
        </p>
      )}
    </section>
  )
}

function BranchButton({
  choice,
  fromId,
  disabled,
  chosen,
  marked,
  onChoose,
}: {
  choice: BranchChoice
  fromId: string
  disabled: boolean
  chosen: boolean
  marked: boolean
  onChoose: (pathId: string, fromId: string) => void
}) {
  return (
    <motion.button
      type="button"
      whileTap={choice.viable ? { scale: 0.98 } : undefined}
      disabled={disabled || !choice.viable}
      onClick={() => onChoose(choice.pathId, fromId)}
      className={cn(
        'btn min-h-20 flex-col items-start gap-1 px-3.5 py-2.5 text-left',
        marked && 'target-breathe border-[var(--dsa-accent)]',
        chosen && 'border-[var(--dsa-success)] text-[var(--dsa-success)]',
        !choice.viable && 'opacity-45',
      )}
      aria-label={
        choice.viable
          ? `Keep the ${choice.pathId} half, positions ${choice.from} to ${choice.to}`
          : `The ${choice.pathId} half is empty, nothing to keep`
      }
    >
      <span className="text-[0.65rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
        {choice.pathId} half
      </span>
      <span className="mono text-[1.05rem] font-bold">{choice.label}</span>
    </motion.button>
  )
}
