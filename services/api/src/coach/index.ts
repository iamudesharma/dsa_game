/**
 * The coach, as one surface.
 *
 * The barrel exists so `app.ts` imports coach wiring from one place, the way it
 * already imports everything else from `@dsa/game-schema` and `./store.js`. The
 * individual modules stay importable directly, because the test file drives each
 * of them in isolation and a barrel that hid the parts would make those tests test
 * the barrel instead.
 */

export {
  DEFAULT_BUDGET,
  assembleWindow,
  budgetAfterPreamble,
  estimateTokens,
  estimateTurnTokens,
  serialiseSnapshot,
  type AssembledWindow,
  type CoachBudget,
} from './budget.js'

export {
  appendTurn,
  coachThreadCount,
  createThread,
  deleteThread,
  getThread,
  listThreadIdsForGame,
  listThreadsForGame,
  newThreadId,
  rememberHint,
  resetThreads,
  setThreadSummary,
  threadExists,
  type CoachThreadSummary,
  type CreateThreadInput,
} from './threads.js'

export {
  findViolation,
  screenCoachReply,
  type CoachRedaction,
  type CoachScreen,
  type GuardrailId,
  type GuardrailViolation,
} from './guardrails.js'

export {
  classifyIntent,
  fallbackAnswer,
  type CoachIntent,
  type FallbackAnswer,
  type FallbackInput,
} from './fallback.js'

export { buildSnapshot, type BuildSnapshotInput } from './snapshot.js'
export { buildTurnPrompt } from './prompt.js'

export { makeCoachSpan, traceCoachCall, type CoachOutcome, type CoachSpan } from './trace.js'

export {
  UnknownCoachThreadError,
  createCoachService,
  getCoachService,
  resetCoachService,
  setCoachService,
  type CoachDeps,
  type CoachService,
  type CoachWorld,
} from './service.js'
