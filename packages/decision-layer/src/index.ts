/**
 * `@dsa/decision-layer` — the local System 1 decision layer.
 *
 * Laya classifies; it does not generate. Everything here is either a fast typed
 * classification against a fixed label set, or a deterministic heuristic that
 * produces the same answer without the model. Callers can rely on: a non-empty
 * `choice` that is a key of the supplied `options`, a `confidence` in [0,1], and
 * no exceptions.
 */

export {
  createDecisionEngine,
  heuristicFor,
  parseTraceOps,
} from './engine.js'

export {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  HEALTH_TTL_MS,
  MIN_CONFIDENCE,
} from './types.js'
export type { DecisionEngine, DecisionEngineOptions, DecisionOutcome } from './types.js'

export {
  LayaClient,
  answerChoice,
  answerConfidence,
  answerDistribution,
  parseSystemOneResponse,
  readFlag,
  readLayaEnv,
} from './laya-client.js'
export type {
  LayaAnswer,
  LayaChoiceQuestion,
  LayaClientOptions,
  LayaNoulQuestion,
  LayaQuestion,
  LayaQuestionType,
  LayaRouting,
  LayaScoreQuestion,
  LayaSystemOneRequest,
  LayaSystemOneResponse,
} from './laya-client.js'

export {
  DIFFICULTY_PREFERENCE,
  MISCONCEPTION_LABELS,
  constrainToKeys,
  difficulty,
  hashString,
  pickHint,
  pickTheme,
  routeProblem,
  scoreProblems,
  tagMisconception,
  tagMisconceptionDetailed,
  tokenize,
} from './heuristics.js'
export type {
  MistakeSource,
  MisconceptionLabel,
  MisconceptionTag,
  ProblemScore,
} from './heuristics.js'

export { LocalRouter, rankScores } from './local-router.js'
export { CANDIDATES } from './candidates.js'
export { INTENT_OPTIONS, ruleIntent } from './examples.js'
export type { CandidateId } from './candidates.js'
