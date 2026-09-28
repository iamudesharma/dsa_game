/**
 * The coach's `TurnPrompt`, delegated to the engine.
 *
 * WHY THIS FILE IS A THIN WRAPPER: `TurnPrompt` is part of the shared contract and
 * it is now produced once, in `@dsa/game-engine`, by `deriveTurnPrompt` — which is
 * oracle-derived, exactly as `guidance.ts`'s own header requires ("a prompt that
 * invents a goal would teach the wrong algorithm").
 *
 * An earlier version of this file carried a SECOND producer, written before the
 * engine had one. That was a real hazard rather than a theoretical one: the play
 * screen renders the engine's prompt and the coach embeds this one in the
 * snapshot, so two producers meant a learner could be shown one instruction on the
 * board and a different one in the coach panel for the same turn. It would have
 * passed every unit test, because each side was internally consistent.
 *
 * So: one producer, called from here. What stays local is only what is genuinely
 * coach-specific — the band, which the coach uses to pitch language and the engine
 * does not need to know about.
 */

import { deriveTurnPrompt } from '@dsa/game-engine'
import type { GameSpec, GameState, LearnerBand, Oracle, TurnPrompt } from '@dsa/game-schema'

export interface TurnPromptInput {
  readonly state: GameState
  readonly spec: GameSpec
  readonly oracle: Oracle
  /**
   * Pitch the language at this band. The engine already accepts one; passing it
   * through means a learner's register is consistent between the board and the
   * coach, rather than the coach being the only place that knows how old they are.
   */
  readonly band?: LearnerBand
}

/**
 * The prompt for the turn the learner is ON, right now.
 *
 * Pure: the same inputs always give the same prompt, and the game is never touched.
 * The coach calls this on every question while the game continues underneath, so a
 * prompt that drifted between being built and being sent would describe a board the
 * learner has already left.
 */
export function buildTurnPrompt(input: TurnPromptInput): TurnPrompt {
  return deriveTurnPrompt({
    state: input.state,
    oracle: input.oracle,
    spec: input.spec,
    ...(input.band === undefined ? {} : { band: input.band }),
  })
}
