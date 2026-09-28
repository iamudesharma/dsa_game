'use client'

import type { BoardModel } from '@/lib/board'
import type { Container, GameSpec, GameState } from '@dsa/game-schema'
import type { TargetMarkers } from '@/lib/guidance'
import { findMarker } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { ObjectToken } from './ObjectToken'

export interface ContainerPanelProps {
  container: Container
  model: BoardModel
  spec: GameSpec
  state: GameState
  picked: readonly string[]
  markers: TargetMarkers
  disabled: boolean
  onObjectActivate: (id: string) => void
}

/**
 * A stack / queue / array container.
 *
 * `Container.order` is documented as "bottom/head first", so for a *stack* we
 * draw it reversed: the head of the list is the top of the stack, which is the
 * only orientation a player already has intuition for. The top item gets an
 * explicit badge so LIFO/FIFO is legible without reading the code.
 *
 * The raw `kind` string ("stack" / "queue") is a wire value and is not printed:
 * a learner does not need to know which container implementation the engine
 * picked, and `order.length / capacity` already tells them the only fact that
 * changes their next decision.
 */
export function ContainerPanel({
  container,
  model,
  spec,
  state,
  picked,
  markers,
  disabled,
  onObjectActivate,
}: ContainerPanelProps) {
  const isStack = container.kind === 'stack'
  const display = isStack ? [...container.order].reverse() : container.order
  const full = typeof container.capacity === 'number' && container.order.length >= container.capacity

  return (
    <div className="min-w-0">
      <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
        <span>{container.label ?? container.id}</span>
        {typeof container.capacity === 'number' && (
          <span
            className={cn(
              'mono normal-case',
              full ? 'font-bold text-[var(--dsa-warn)]' : 'text-[var(--dsa-muted)]',
            )}
          >
            {container.order.length}/{container.capacity}
            {full ? ' · full' : ''}
          </span>
        )}
      </p>
      {display.length === 0 ? (
        <p className="panel-quiet px-3 py-2 text-xs text-[var(--dsa-faint)]">empty</p>
      ) : (
        <div className="board-scroll -mx-1 flex min-w-max items-stretch gap-1.5 px-1 pb-1">
          {display.map((id, index) => {
            const object = model.byId[id]
            if (!object) return null
            const pickedIndex = picked.indexOf(id)
            return (
              <div key={`${container.id}:${id}`} className="flex items-center gap-1.5">
                {index > 0 && (
                  <span aria-hidden className="mono text-[0.65rem] text-[var(--dsa-faint)]">
                    {isStack ? '↑' : '→'}
                  </span>
                )}
                <div className="relative">
                  {index === 0 && (
                    <span
                      className="mono absolute -top-2.5 left-1 rounded bg-[color-mix(in_oklab,var(--dsa-success)_85%,black)] px-1.5 py-px text-[0.58rem] font-bold leading-tight text-white"
                      aria-label={isStack ? 'top of the stack' : 'front of the queue'}
                    >
                      {isStack ? 'top' : 'front'}
                    </span>
                  )}
                  <ObjectToken
                    object={object}
                    spec={spec}
                    picked={pickedIndex >= 0}
                    pickIndex={pickedIndex >= 0 ? pickedIndex + 1 : null}
                    serverSelected={state.selection.includes(id)}
                    marker={findMarker(markers, id)}
                    disabled={disabled}
                    onActivate={onObjectActivate}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
