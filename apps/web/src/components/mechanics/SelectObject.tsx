'use client'

import type { Action } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { findMarker } from '@/lib/guidance'
import { objectName, type MechanicProps } from './types'

/**
 * Read an element.
 *
 * The board is the primary affordance for this one — a single tap IS the whole
 * action — so this panel does two jobs and no more:
 *
 *  - it names the mechanic in the theme's language, and
 *  - it offers the targets the current turn is pointing at as real, large
 *    buttons, which is the accessible and phone-friendly equivalent of tapping
 *    a tile in a horizontally scrolling lane.
 *
 * REMOVED: the duplicated list of EVERY object on the board. With the targets
 * supplied by `turnPrompt`, the learner is offered the right two or three, not
 * the right two or three hidden inside sixteen identical chips. And REMOVED the
 * `This is a read in the algorithm: no data moves` footer — the `teach` line
 * under every action already says what the operation is for, and saying it a
 * third time on the control is redundant.
 */
export function SelectObject({ spec, model, binding, disabled, dispatch, markers }: MechanicProps) {
  const offered: string[] = []
  for (const marker of markers.values()) {
    if (marker.target.role === 'excluded') continue
    if (marker.objectId) offered.push(marker.objectId)
    else if (marker.slotId) offered.push(marker.slotId)
  }
  const unique = [...new Set(offered)]

  const emit = (objectId: string): void => {
    const action: Action = { type: 'selectObject', objectId }
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
        {binding.hint ?? `Tap a ${spec.vocabulary.object} on the board — or use these.`}
      </p>

      {unique.length === 0 ? (
        <p className="mt-3 text-[0.92rem] text-[var(--dsa-muted)]">
          Nothing is being pointed at right now. Tap anything on the board.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2" role="list">
          {unique.map((id) => {
            const marker = findMarker(markers, id)
            return (
              <li key={id}>
                <Button
                  disabled={disabled}
                  onClick={() => emit(id)}
                  aria-label={`Read ${objectName(model, id)}`}
                  className="min-h-12 px-4"
                >
                  {objectName(model, id)}
                </Button>
                {marker ? (
                  <p className="mt-0.5 max-w-40 text-[0.7rem] text-[var(--dsa-accent)]">{marker.target.hint}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
