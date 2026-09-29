/**
 * The wire contract between `services/api` and both clients (Next.js and
 * Flutter). This file is the single source of truth for the HTTP API — if a
 * client needs a field, add it here first.
 */

import type { Action } from './action.js'
import type { ProblemMeta, Difficulty } from './problems.js'
import type { GameSpec } from './game-spec.js'
import type { GameState, ActionOutcome } from './state.js'
import type { TurnPrompt, PlayerFeedback } from './guidance.js'
import type { TraceFrame, Complexity } from './trace.js'
import type { AnswerSummary } from './oracle.js'

export type ProviderTier = 'opencode-go' | 'opencode' | 'openrouter' | 'local-llm' | 'template'

export const PROVIDER_TIERS: readonly ProviderTier[] = [
  'opencode-go',
  'opencode',
  'openrouter',
  'local-llm',
  'template',
]

/** Which tiers were tried, and why the earlier ones were skipped/failed. */
export interface ProviderAttempt {
  tier: ProviderTier
  ok: boolean
  ms: number
  error?: string
}

// ---------------------------------------------------------------- catalogue

/**
 * A catalogue entry, as sent to a client.
 *
 * `ProblemMeta` plus ONE extra field, and it is the field that stops the
 * catalogue from over-promising. `PROBLEMS` is the list of what is PLANNED;
 * `playable` is the list of what actually works, computed server-side from
 * whether an oracle is registered. Without it every problem rendered as an
 * equal clickable option and a learner found out which ones were real by
 * clicking and reading a 500.
 */
export type ProblemDto = ProblemMeta & {
  /** False when the problem is listed but its oracle is not built yet. */
  playable: boolean
}

export interface TopicDto {
  id: string
  label: string
  problems: ProblemDto[]
}

export interface CatalogueResponse {
  topics: TopicDto[]
  tiers: { tier: ProviderTier; available: boolean }[]
  laya: { enabled: boolean; available: boolean }
}

// ------------------------------------------------------------------ generate

export interface GenerateRequest {
  problemId: string
  /** Omit for a random instance + a fresh theme ("Retry with New Game"). */
  seed?: number
  difficulty?: Difficulty
  /** Optional player free-text, used for Laya routing + theme steering. */
  freeText?: string
  /** Skip LLM tiers entirely; always use the template tier. */
  forceTemplate?: boolean
}

export interface GenerateResponse {
  gameId: string
  problemId: string
  seed: number
  spec: GameSpec
  state: GameState
  /** Which tier actually produced the playable spec. */
  usedTier: ProviderTier
  attempts: ProviderAttempt[]
  /** Non-fatal notes, e.g. "spec repaired on attempt 2". */
  notes: string[]
  /** The opening "your turn" instruction, so the board is never a blank puzzle. */
  turnPrompt: TurnPrompt
}

// -------------------------------------------------------------------- action

export interface ActionRequest {
  gameId: string
  action: Action
}

export interface ActionResponse {
  gameId: string
  state: GameState
  outcome: ActionOutcome
  usedTier: ProviderTier
  /**
   * What to do next, in the theme's own vocabulary. The UI renders this as the
   * primary "your turn" indicator, so the learner never has to infer the next
   * move from a board. Present while phase === 'playing'.
   */
  turnPrompt: TurnPrompt
  /**
   * Explanatory feedback for the action just taken. Always explanatory, never a
   * bare tick — that is the highest-leverage teaching choice in the whole UI.
   */
  feedback: PlayerFeedback
  /** Present once phase !== 'playing'. */
  debrief?: DebriefResponse
}

// ------------------------------------------------------------------- debrief

export interface MappingRow {
  gameTerm: string
  algorithmTerm: string
}

export interface DebriefResponse {
  problemId: string
  phase: 'won' | 'lost'
  /** The player's own history, for the replay. */
  playedTrace: TraceFrame[]
  /** The reference solution, for the side-by-side algorithm view. */
  canonicalTrace: TraceFrame[]
  answer: AnswerSummary
  pseudocode: string[]
  code: Record<string, string[]>
  complexity: Complexity
  /** Player-facing prose from the spec's debrief block. */
  summary: string
  actionMeaning: Record<string, string>
  mapping: MappingRow[]
  stats: {
    steps: number
    mistakes: number
    hintsUsed: number
    mistakesByMechanic: Record<string, number>
    /** Laya-classified misconception, when available. */
    misconception?: string
    confidence?: number
  }
  /** Throttled hints, revealed on demand by the client. */
  hintPool: string[]
}

// --------------------------------------------------------------------- hints

export interface HintRequest {
  gameId: string
}

export interface HintResponse {
  hint: string
  /** 'laya' when the local model chose it, 'heuristic' otherwise. */
  source: 'laya' | 'heuristic'
  confidence?: number
  /**
   * Set when the authored hint was rejected by the spoiler screen and the
   * engine's own description of the board was substituted.
   *
   * WHY IT IS ON THE WIRE. The screen exists because a hint can hand over the
   * answer or the algorithm, and a screen nobody can observe is a screen nobody
   * will notice is broken. Reporting which rule fired makes the substitution
   * auditable from a client, and it is what the debrief needs in order to tell
   * the truth about how a run was helped.
   */
  screened?: {
    /** Which class of leak was caught. */
    id: 'notation' | 'position' | 'resolution' | 'pasted-code' | 'unearned-praise'
    /** Human-readable, for a server log or a debug panel. */
    reason: string
  }
}

// ------------------------------------------------------------------- decide

export type DecisionKind =
  | 'route-problem'
  | 'pick-theme'
  | 'pick-hint'
  | 'tag-misconception'
  | 'difficulty'

export interface DecideRequest {
  kind: DecisionKind
  /** Text describing the current situation, for Laya to score. */
  stateText: string
  /** Fixed label set. Laya returns one of these keys. */
  options: Record<string, string>
  instructions: string
}

export interface DecideResponse {
  kind: DecisionKind
  choice: string
  /** 0..1 probability of the chosen option. */
  confidence: number
  source: 'laya' | 'heuristic'
  /** Full calibrated distribution when Laya answered. */
  distribution?: Record<string, number>
}

// -------------------------------------------------------------------- health

export interface HealthResponse {
  ok: boolean
  version: string
  tiers: { tier: ProviderTier; available: boolean; detail?: string }[]
  laya: { enabled: boolean; available: boolean; detail?: string }
  uptimeSec: number
}

// ------------------------------------------------------------------- errors

export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export const API_ERRORS = {
  badRequest: 'BAD_REQUEST',
  unknownProblem: 'UNKNOWN_PROBLEM',
  unknownGame: 'UNKNOWN_GAME',
  /**
   * A coach thread that does not exist, or belonged to a game that has since
   * been evicted. Distinct from UNKNOWN_GAME so a client can tell "your game
   * expired, start again" from "that conversation is gone, pick another".
   */
  unknownThread: 'UNKNOWN_THREAD',
  generationFailed: 'GENERATION_FAILED',
  /**
   * The problem is in the catalogue but has no oracle yet, so there is no
   * definition of correct and the game cannot be played.
   *
   * ITS OWN CODE, and it is a 4xx rather than a 500, because "we have not built
   * this yet" is a fact about the app rather than a fault in the request. It
   * used to be a thrown `Error` from `requireOracle` that escaped
   * `POST /api/generate` and surfaced as `INTERNAL` — which told the client
   * "the server broke" and offered a "Try again" button, on a request that
   * could never succeed no matter how many times it was sent.
   */
  problemNotPlayable: 'PROBLEM_NOT_PLAYABLE',
  internal: 'INTERNAL',
} as const

export type ApiErrorCode = (typeof API_ERRORS)[keyof typeof API_ERRORS]

// ------------------------------------------------------------------ helpers

export function isPhaseTerminal(state: Pick<GameState, 'phase'>): boolean {
  return state.phase !== 'playing'
}
