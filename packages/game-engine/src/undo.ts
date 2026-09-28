/**
 * Undo via snapshot stacks.
 *
 * The state is a plain JSON object by contract, so undo is just a bounded
 * stack of deep clones — no deltas, no inverse operations, nothing that can
 * drift out of sync with the game's real state.
 *
 * Every function here is copy-on-write: the array you pass in is never
 * mutated, which keeps the caller's reducer honest and makes the helpers safe
 * to use from a React state setter.
 */

/**
 * NOTE ON INTENTIONAL ASYMMETRY: undo does NOT rewind `progress.mistakes` (nor
 * `mistakesByMechanic`). A mistake is a fact about what the player actually
 * did, not about where the board currently is. Rewinding it would let a player
 * erase the evidence of their misconceptions by pressing undo, and would make
 * the debrief — which exists precisely to name those misconceptions — lie.
 * `steps` and the trace *are* rewound, because they describe the position.
 *
 * Use `rewindProgressTo` to build the state a player should see after undoing.
 */

import { cloneState } from '@dsa/game-schema'
import type { GameState, Progress } from '@dsa/game-schema'

/** How many moves back the player can go by default. */
export const DEFAULT_UNDO_LIMIT = 20

/** Append a deep-cloned snapshot and trim the oldest entries past `limit`. */
export function pushSnapshot(stack: GameState[], state: GameState, limit: number = DEFAULT_UNDO_LIMIT): GameState[] {
  const next = Array.isArray(stack) ? stack.slice() : []
  next.push(cloneState(state))
  const bound = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_UNDO_LIMIT
  // Keep the newest `bound` entries: the tail is the recent past.
  return next.length > bound ? next.slice(next.length - bound) : next
}

/** The newest snapshot, or null. Does not remove it — use `undo` for that. */
export function popSnapshot(stack: GameState[]): GameState | null {
  if (!Array.isArray(stack) || stack.length === 0) return null
  const newest = stack[stack.length - 1]
  return newest === undefined ? null : cloneState(newest)
}

export function peekSnapshot(stack: GameState[]): GameState | null {
  return popSnapshot(stack)
}

export function canUndo(stack: GameState[]): boolean {
  return Array.isArray(stack) && stack.length > 0
}

/**
 * Pop the newest snapshot. Returns the shortened stack plus the restored
 * state, or `state: null` when there is nothing to undo.
 *
 * Use `rewindProgressTo(current, restored)` on the returned state to keep the
 * mistake ledger across the rewind.
 */
export function undo(stack: GameState[]): { stack: GameState[]; state: GameState | null } {
  if (!canUndo(stack)) return { stack: [], state: null }
  const shortened = stack.slice(0, stack.length - 1)
  const newest = stack[stack.length - 1]
  if (newest === undefined) return { stack: shortened, state: null }
  return { stack: shortened, state: cloneState(newest) }
}

/**
 * The state a player should see after undoing: the snapshot's world, but with
 * the newer state's history preserved.
 *
 * - `steps` / `trace` / the board come from the snapshot (that is the rewind),
 * - `mistakes` / `mistakesByMechanic` come from the newer state (see the note
 *   at the top of this file),
 * - `hintsUsed` takes the max of the two, so undoing cannot hand back spec
 *   hint-pool entries the player has already burned through.
 */
export function rewindProgressTo(state: GameState, snapshot: GameState): GameState {
  const rewound = cloneState(snapshot)
  const current: Progress = state.progress
  rewound.progress = {
    ...rewound.progress,
    steps: current.steps,
    mistakes: current.mistakes,
    hintsUsed: Math.max(current.hintsUsed, rewound.progress.hintsUsed),
    mistakesByMechanic: { ...current.mistakesByMechanic },
  }
  return rewound
}
