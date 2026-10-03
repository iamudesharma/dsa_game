'use client'

import { useEffect } from 'react'
import type { GameSpec, GameState, MechanicId, MechanicBinding } from '@dsa/game-schema'
import { ACTION_TO_MECHANIC } from '@/lib/contract'
import { cn } from '@/lib/format'
import { AssignValue } from './AssignValue'
import { ComparePair } from './ComparePair'
import { ConnectNodes } from './ConnectNodes'
import { ChoosePath } from './ChoosePath'
import { MoveObject } from './MoveObject'
import { PushPop } from './PushPop'
import { SelectObject } from './SelectObject'
import { SubmitAnswer } from './SubmitAnswer'
import { SwapPair } from './SwapPair'
import { TraverseNode } from './TraverseNode'
import type { MechanicProps } from './types'

/**
 * Dispatches on the mechanic the player is currently attempting.
 *
 * A player can only drive one interaction at a time, so the host is a tab strip
 * over `spec.mechanics` plus the one renderer for the active tab. Which tab
 * starts active is decided by the player's own last trace action, or by the
 * store's explicit override when the server corrected a move — so the board
 * never shows a control the player did not ask for.
 */
export interface MechanicHostProps extends Omit<MechanicProps, 'binding'> {
  activeMechanicId: MechanicId
  onSelectMechanic: (id: MechanicId) => void
  /**
   * Suppress the selected mechanic's own label inside the panel.
   *
   * `PlayView` sets this, because `YourTurnIndicator` renders the same
   * imperative at 2rem a few hundred pixels above the board and the panel was
   * repeating it as a heading and again as its first body line. The tablist
   * still names every operation, so switching stays legible; only the echo of
   * the already-selected one goes. A caller that renders `MechanicHost` on its
   * own, with no instruction above it, should leave this off.
   */
  hideLabel?: boolean
}
function Renderer(props: MechanicProps): React.ReactNode {
  switch (props.binding.id) {
    case 'selectObject':
      return <SelectObject {...props} />
    case 'moveObject':
      return <MoveObject {...props} />
    case 'comparePair':
      return <ComparePair {...props} />
    case 'swapPair':
      return <SwapPair {...props} />
    case 'pushPop':
      return <PushPop {...props} />
    case 'choosePath':
      return <ChoosePath {...props} />
    case 'traverseNode':
      return <TraverseNode {...props} />
    case 'connectNodes':
      return <ConnectNodes {...props} />
    case 'assignValue':
      return <AssignValue {...props} />
    case 'submitAnswer':
      return <SubmitAnswer {...props} />
    default:
      return null
  }
}

/**
 * Picks the mechanic a player most plausibly wants next.
 *
 * Priority: the store's explicit override (the server corrected a move and told
 * us which control can express the expected action), then the mechanic the turn
 * prompt says is coming, then the last action they took so `comparePair` is
 * followed by another `comparePair` until they switch, then the first mechanic
 * the spec enabled.
 */
export function deriveActiveMechanic(args: {
  spec: GameSpec
  state: GameState
  override: MechanicId | null
  /** The mechanic the current turn prompt is about, when we have one. */
  suggested?: MechanicId | null
}): MechanicId {
  const { spec, state, override, suggested } = args
  const enabled = new Set<MechanicId>(spec.mechanics.map((m) => m.id))
  if (override && enabled.has(override)) return override
  if (suggested && enabled.has(suggested)) return suggested
  const last = state.trace[state.trace.length - 1]
  if (last) {
    // Going through ACTION_TO_MECHANIC rather than asserting that the action
    // type *is* the mechanic id: the mapping is the contract's, not a guess.
    const fromAction = ACTION_TO_MECHANIC[last.action.type]
    if (enabled.has(fromAction)) return fromAction
  }
  return spec.mechanics[0]?.id ?? 'selectObject'
}

export function MechanicHost({
  spec,
  state,
  model,
  activeMechanicId,
  onSelectMechanic,
  disabled,
  picked,
  setPicked,
  dispatch,
  markers,
  prompt,
  hideLabel = false,
}: MechanicHostProps) {
  const active: MechanicBinding | null =
    spec.mechanics.find((m) => m.id === activeMechanicId) ?? spec.mechanics[0] ?? null

  // The staged pick is scoped to the mechanic that made it: switching tabs with
  // a half-built comparePair would otherwise emit a nonsense action.
  useEffect(() => {
    setPicked([])
  }, [activeMechanicId, setPicked])

  if (!active) return null

  // The renderer reads the label off `binding`, and several of them print it as
  // their heading. Rather than give every one of the ten renderers a new prop,
  // the host withholds the LABEL while leaving everything else the renderer
  // needs — the op, the hint, the targets — untouched. `hideLabel` is applied
  // here rather than in `PlayView` precisely so a mechanic cannot be forgotten.
  const props: MechanicProps = {
    spec,
    state,
    model,
    binding: hideLabel ? { ...active, label: '' } : active,
    disabled,
    picked,
    setPicked,
    dispatch,
    markers,
    prompt,
  }

  return (
    <div className="min-w-0">
      {spec.mechanics.length > 1 ? (
        <div
          className="board-scroll -mx-1 mb-3 flex gap-1.5 px-1 pb-1"
          role="tablist"
          aria-label="Available operations"
        >
          {spec.mechanics.map((mechanic) => {
            const isActive = mechanic.id === active.id
            return (
              <button
                key={mechanic.id}
                data-mechanic={mechanic.id}
                type="button"
                role="tab"
                  onKeyDown={event => { const keys = ['ArrowLeft','ArrowRight','Home','End']; if (!keys.includes(event.key)) return; event.preventDefault(); const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []); const i = tabs.indexOf(event.currentTarget); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next]?.focus(); tabs[next]?.click() }}
                aria-selected={isActive}
                onClick={() => onSelectMechanic(mechanic.id)}
                className={cn(
                  'btn min-h-11 shrink-0 px-3.5 text-left',
                  isActive &&
                    'border-[var(--dsa-accent)] bg-[color-mix(in_oklab,var(--dsa-accent)_18%,var(--dsa-surface-2))] text-[var(--dsa-ink)]',
                )}
              >
                {mechanic.label}
              </button>
            )
          })}
        </div>
      ) : null}

      <div role="tabpanel" aria-label={active.label} className="min-w-0">
        <Renderer {...props} />
      </div>
    </div>
  )
}
