'use client'

import type { BoardModel } from '@/lib/board'
import type { GameSpec, GameState } from '@dsa/game-schema'
import type { TargetMarkers } from '@/lib/guidance'
import { findMarker } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { ObjectToken } from './ObjectToken'

export interface LinkRowProps {
  model: BoardModel
  state: GameState
  spec: GameSpec
  picked: readonly string[]
  markers: TargetMarkers
  disabled: boolean
  onObjectActivate: (id: string) => void
}

/**
 * Linked nodes, in list order, with the `next` / `prev` edges drawn between
 * them.
 *
 * WHY inline connectors instead of an SVG overlay: measuring real node
 * positions needs `getBoundingClientRect` + `ResizeObserver`, which fights SSR,
 * layout animation and horizontal scrolling. An arrow between two nodes is the
 * same information, always correct, and reads exactly like a linked list.
 *
 * The raw `state.links` dump below the row is gone. It printed `n3 -next-> n1`
 * for every edge including the ones already drawn as arrows — pure extraneous
 * load. What a learner actually needs to know is whether the cursor's next step
 * exists, and `TraverseNode` says that in words on the control itself.
 */
export function LinkRow({ model, state, spec, picked, markers, disabled, onObjectActivate }: LinkRowProps) {
  const nodeIds = model.nodeOrder
  if (nodeIds.length === 0) return null

  const hasLink = (from: string, to: string, kind: 'next' | 'prev'): boolean =>
    state.links.some((l) => l.from === from && l.to === to && l.kind === kind)

  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
        the chain
      </p>
      <div className="board-scroll -mx-1 px-1 pb-1">
        <div className="flex min-w-max items-center gap-1">
          {nodeIds.map((id, index) => {
            const object = model.byId[id]
            const nextId = nodeIds[index + 1]
            const direction: { kind: 'next' | 'prev' | 'none'; label: string } = !nextId
              ? { kind: 'none', label: '' }
              : hasLink(id, nextId, 'next')
                ? { kind: 'next', label: '' }
                : hasLink(nextId, id, 'next')
                  ? { kind: 'prev', label: '' }
                  : { kind: 'none', label: '' }

            return (
              <div key={id} className="flex items-center gap-1">
                {object && (
                  <ObjectToken
                    object={object}
                    spec={spec}
                    picked={picked.includes(id)}
                    pickIndex={(picked.indexOf(id) + 1) || null}
                    serverSelected={state.selection.includes(id)}
                    marker={findMarker(markers, id)}
                    disabled={disabled}
                    onActivate={onObjectActivate}
                  />
                )}
                {nextId && (
                  <span
                    aria-label={direction.kind === 'none' ? 'no link from here' : 'link to the next one along'}
                    className={cn(
                      'mono grid h-8 w-8 place-items-center rounded-full border text-[0.9rem]',
                      direction.kind === 'next' &&
                        'border-[color:color-mix(in_oklab,var(--dsa-accent)_55%,transparent)] text-[var(--dsa-accent)]',
                      direction.kind === 'prev' &&
                        'border-[color:color-mix(in_oklab,var(--dsa-primary)_55%,transparent)] text-[var(--dsa-primary)]',
                      direction.kind === 'none' && 'border-dashed border-[var(--dsa-border)] text-[var(--dsa-faint)]',
                    )}
                  >
                    {direction.kind === 'next' ? '→' : direction.kind === 'prev' ? '←' : '⋮'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
