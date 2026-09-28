import type { Action, GameSpec, GameState, MechanicBinding, TurnPrompt } from '@dsa/game-schema'
import type { BoardModel } from '@/lib/board'
import type { TargetMarkers } from '@/lib/guidance'

/**
 * The contract every mechanic renderer receives.
 *
 * `picked` / `setPicked` are the client's staged selection. They exist because
 * `Action`s like `comparePair` are 2-ary: the UI must let a player choose two
 * objects before it can emit anything. The server's `state.selection` is
 * authoritative and is drawn too, but the client never *waits* for it — a
 * one-tap-per-side flow that round-trips twice per comparison would make the
 * game feel like a form.
 *
 * `setPicked` accepts an updater function as well as a value. That is not
 * decoration: two clicks inside a single React batch (double-tap, trackpad
 * double-click, or a fast double-tap on a phone) would otherwise both read the
 * same stale array and the second pick would overwrite the first.
 *
 * `markers` is the resolved `turnPrompt.targets` index. A renderer's job is to
 * press a specific button, and a button that does not know which object the
 * engine is pointing at has to re-derive it from `state.cursor` itself — which
 * is how ten renderers end up disagreeing with each other. It is derived once,
 * in `MechanicHost`, and passed down.
 */
export type SetPicked = (next: string[] | ((prev: string[]) => string[])) => void

export interface MechanicProps {
  spec: GameSpec
  state: GameState
  model: BoardModel
  binding: MechanicBinding
  disabled: boolean
  picked: string[]
  setPicked: SetPicked
  dispatch: (action: Action) => void
  /** Which board objects the current turn is pointing at, and why. */
  markers: TargetMarkers
  /**
   * The current turn's prompt, or null on an API build that does not send one.
   *
   * Renderers need this because some turns are only distinguishable by what the
   * ORACLE says is coming. Binary search's "you found it, report the hit" turn
   * and its "keep one half" turn are both `choosePath`; only `dsaOp`
   * (`terminate` versus `choose-path`) separates them, and offering the wrong
   * one of those buttons early ends the run. So a renderer that cannot read the
   * prompt does not offer the irreversible move at all.
   */
  prompt: TurnPrompt | null
}

/** Human label for an object id, for the "holding X" lines. */
export function objectName(model: BoardModel, id: string): string {
  return model.byId[id]?.label ?? id
}
