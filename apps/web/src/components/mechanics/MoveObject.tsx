'use client'

import { useState } from 'react'
import type { Action } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/format'
import { findMarker } from '@/lib/guidance'
import { objectName, type MechanicProps } from './types'

/**
 * Relocate an object into a slot.
 *
 * The board supports two equivalent paths and both are always available:
 *  - pick an object (tap or drag it), then tap a highlighted empty slot,
 *  - pick an object, then use the "move it here" buttons below.
 * The second path exists because it is the only one that works with a keyboard
 * and the only one that works when a slot is scrolled out of view.
 *
 * REMOVED: the `<span className="mono">Drag a room into an empty place.</span>`
 * hint and the per-slot `aria-label` walls. The board's empty slots now say
 * "put it here" at a readable size while a move is in flight, which is a
 * stronger affordance than describing one in prose.
 */
export function MoveObject({
  spec,
  model,
  binding,
  disabled,
  picked,
  setPicked,
  dispatch,
  markers,
}: MechanicProps) {
  const [destination,setDestination]=useState('')
  const source = picked[0]
  const sourceObject = source ? model.byId[source] : undefined
  const slotCells = model.lanes.flatMap((lane) => lane.cells).filter((cell) => cell.slotId !== undefined)

  const move = (objectId: string, toSlotId: string): void => {
    const action: Action = { type: 'moveObject', objectId, toSlotId }
    dispatch(action)
    setPicked([])
  }

  return (
    <section className="panel p-4" aria-label={binding.label || 'MoveObject'}>
      {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Pick a ${spec.vocabulary.object} to move, then choose where it goes.`}
      </p>

      <div className="mt-3 flex min-h-14 flex-wrap items-center gap-2" aria-live="polite">
        {source ? (
          <>
            <span className="text-[0.7rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
              holding
            </span>
            <span className="mono rounded-xl border-2 border-[var(--dsa-accent)] bg-[color-mix(in_oklab,var(--dsa-accent)_16%,transparent)] px-3 py-1.5 text-[1rem] font-bold text-[var(--dsa-ink)]">
              {objectName(model, source)}
            </span>
            {findMarker(markers, source) ? (
              <span className="text-[0.8rem] text-[var(--dsa-accent)]">the one to move</span>
            ) : null}
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setPicked([])}>
              Put it down
            </Button>
          </>
        ) : (
          <span className="text-[0.92rem] text-[var(--dsa-muted)]">
            Nothing picked yet. Tap a thing on the board and it will show up here.
          </span>
        )}
      </div>

      {sourceObject ? (
        <>
          <p className="mt-1 text-[0.8rem] text-[var(--dsa-faint)]">Choose where it should go:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {slotCells.map((cell) => {
              const occupied = Boolean(cell.object)
              const isSelf = cell.object?.id === source
              const marked = findMarker(markers, cell.slotId ?? cell.id)
              return (
                <Button
                  key={cell.id}
                  size="sm"
                  variant={occupied ? 'ghost' : marked ? 'accent' : 'default'}
                  disabled={disabled || !source || occupied || isSelf}
                  onClick={() => cell.slotId && setDestination(cell.slotId)}
                  aria-label={
                    occupied
                      ? `${cell.label} is taken by ${cell.object ? objectName(model, cell.object.id) : 'something'}`
                      : `Move ${source ? objectName(model, source) : 'the picked thing'} to ${cell.label}`
                  }
                  className={cn((occupied || isSelf) && 'opacity-40')}
                >
                  {cell.label}
                </Button>
              )
            })}
          </div>
          {destination && <div className="mt-3 flex flex-wrap gap-2 items-center"><p>Move {objectName(model,source!)} → {slotCells.find(c=>c.slotId===destination)?.label}</p><Button disabled={disabled||!source||!!slotCells.find(c=>c.slotId===destination)?.object} onClick={()=>{if(source)move(source,destination);setDestination('')}}>Move here</Button><Button variant="ghost" onClick={()=>setDestination('')}>Clear destination</Button></div>}
        </>
      ) : null}
    </section>
  )
}
