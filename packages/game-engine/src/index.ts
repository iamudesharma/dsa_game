/**
 * @dsa/game-engine — the deterministic runtime.
 *
 * The engine wraps a problem `Oracle` and adds the parts the oracle
 * deliberately leaves out: safety rails, replay integrity, step accounting,
 * undo, a fallback hint ladder, and telemetry.
 *
 * Nothing here talks to a network, a clock or a random number generator.
 */

export { deriveFeedback, deriveTurnPrompt } from './guidance.js'
export type { FeedbackInput, GuidanceInput } from './guidance.js'

export { createGameRuntime } from './runtime.js'
export type { ApplyResult, DebriefLite, DebriefStats, GameRuntime } from './runtime.js'

export {
  DEFAULT_UNDO_LIMIT,
  canUndo,
  peekSnapshot,
  popSnapshot,
  pushSnapshot,
  rewindProgressTo,
  undo,
} from './undo.js'

export {
  FALLBACK_HINT,
  describeStateFacts,
  incrementHintsUsed,
  nextHint,
  pointerLine,
  variableLine,
} from './hints.js'
export type { HintResult, HintSource, NextHintOptions } from './hints.js'

export { describeSearchWindow, findHintViolation, screenHint } from './hint-safety.js'
export type { HintViolation, HintViolationId } from './hint-safety.js'

export { mapGameActionToCode, mistakeSummary, optimisationScore, traceCodeHighlights } from './telemetry.js'
export type { MistakeSummary, OptimisationScore, TermMapping } from './telemetry.js'
