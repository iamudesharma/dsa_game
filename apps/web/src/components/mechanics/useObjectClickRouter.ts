import type { Action, GameSpec, GameState, MechanicId } from '@dsa/game-schema'
import type { SetPicked } from './types'

/**
 * How many objects the active mechanic needs staged before it can emit.
 * `1` means the board click is the whole action; `2` means the first click picks
 * and the second completes.
 */
const STAGED_PICK_LIMIT: Readonly<Partial<Record<MechanicId, number>>> = {
  moveObject: 1,
  comparePair: 2,
  swapPair: 2,
  connectNodes: 2,
  pushPop: 1,
  assignValue: 1,
  submitAnswer: 1,
}

/** True when a board click should go straight to the API as a full action. */
export function clickEmitsAction(mechanic: MechanicId): boolean {
  return mechanic === 'selectObject'
}

export function stagedPickLimit(mechanic: MechanicId): number {
  return STAGED_PICK_LIMIT[mechanic] ?? 0
}

/**
 * Toggles an object in the staged selection, respecting the mechanic's arity.
 *
 * Re-clicking a staged object clears it (so a mis-tap is recoverable), and
 * picking a fresh object once the set is full replaces the oldest one rather
 * than silently doing nothing — a dead click is the worst thing a game board can
 * do.
 */
export function togglePicked(current: string[], objectId: string, limit: number): string[] {
  if (current.includes(objectId)) {
    return current.filter((id) => id !== objectId)
  }
  if (limit <= 1) return [objectId]
  const next = [...current, objectId]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export interface ObjectClickRouter {
  /** Called by the board when a player activates an object. */
  onObjectActivate: (objectId: string) => void
}

/**
 * Routes a board object click to either a full action (`selectObject`) or the
 * staged selection the current mechanic needs. Kept out of the board so the
 * board stays mechanic-agnostic.
 */
export function useObjectClickRouter(args: {
  mechanic: MechanicId
  picked: string[]
  setPicked: SetPicked
  dispatch: (action: Action) => void
}): ObjectClickRouter {
  const { mechanic, setPicked, dispatch } = args

  return {
    onObjectActivate: (objectId: string) => {
      if (clickEmitsAction(mechanic)) {
        dispatch({ type: 'selectObject', objectId })
        return
      }
      if (mechanic === 'choosePath' || mechanic === 'traverseNode') {
        // These mechanics have dedicated affordances (branches, the next-link
        // button); a raw object click would be ambiguous, so it does nothing.
        return
      }
      // Functional update so two clicks in the same batch compose instead of
      // the second overwriting the first.
      setPicked((prev) => togglePicked(prev, objectId, stagedPickLimit(mechanic)))
    },
  }
}
