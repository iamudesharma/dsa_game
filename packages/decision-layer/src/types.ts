/**
 * The contract between `@dsa/decision-layer` and its caller (`services/api`).
 *
 * Design premise, and the reason this package is shaped the way it is:
 * Laya (https://github.com/NandhaKishorM/laya) is a non-autoregressive
 * "System 1" decision engine. It answers exactly three typed question kinds
 * (`choice`, `score`, `noul`) in one forward pass. It CANNOT emit JSON
 * documents, prose, or code. So it is used here only for fast local
 * classification, and every single function has a deterministic heuristic
 * fallback: on the 8 GB laptops this project targets, the sidecar is regularly
 * not running, and a decision that depends on it being up would be a decision
 * that randomly stops existing.
 */

import type { DecideRequest } from '@dsa/game-schema'

export interface DecisionOutcome {
  choice: string
  /** 0..1. Always a number in [0,1] — callers must not re-clamp. */
  confidence: number
  source: 'laya' | 'heuristic' | 'semantic' | 'zero-shot'
  model?: string
  scoreKind?: 'cosine-similarity' | 'uncalibrated-probability' | 'heuristic'
  score?: number
  margin?: number
  fallbackReason?: string
  /**
   * Only meaningful when `source === 'laya'`: the full per-option
   * distribution the model produced. Heuristics may also populate it
   * (e.g. the per-label mistake counts behind a misconception tag).
   */
  distribution?: Record<string, number>
}

export interface DecisionEngine {
  status?(): { backend: string; model?: string; available: boolean; detail?: string }
  classifyIntent?(text: string): Promise<DecisionOutcome>
  isEnabled(): boolean
  isAvailable(): Promise<boolean>
  /**
   * Never throws and never returns an empty choice for a non-empty
   * `req.options`. A failure of any kind degrades to a heuristic decision.
   */
  decide(req: DecideRequest): Promise<DecisionOutcome>
  dispose?(): Promise<void>
}

export interface DecisionEngineOptions {
  backend?: 'heuristic' | 'semantic' | 'laya'
  local?: import('./local-router.js').LocalRouterOptions
  baseUrl?: string
  enabled?: boolean
  model?: string
  timeoutMs?: number
  /** Skip all network calls; force heuristics. Used by tests. */
  offline?: boolean
  /**
   * EXTENSION beyond the base contract. Answers whose confidence falls below
   * this are discarded and replaced by the heuristic. Default `MIN_CONFIDENCE`.
   * Exposed so a deployment can retune the gate against its own held-out data
   * instead of editing this file.
   */
  minConfidence?: number
  /**
   * EXTENSION. Injectable `fetch`, for tests. Defaults to `globalThis.fetch`.
   * It is captured at construction time, not per call, so a test can install a
   * stub before creating the engine.
   */
  fetchImpl?: typeof fetch
}

/** Defaults, exported so callers and tests can assert against them. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8000'
/** Legacy Laya checkpoint. Its workflow benchmark does not establish DSA routing accuracy. */
export const DEFAULT_MODEL = 'typed-decisions'
export const DEFAULT_TIMEOUT_MS = 1500

/**
 * WHY a gate exists at all: Laya's own README states both shipped checkpoints
 * are over-confident as-is and that `laya-multilingual` (the checkpoint we pin,
 * see `services/laya/README.md`) has **no fitted calibration temperatures at
 * all**. Its README also documents Khmer at 0.000 accuracy while reporting
 * 0.952 confidence, i.e. it stays confidently wrong rather than hedging. A
 * confidence-ordered fallback is therefore the only thing standing between a
 * mis-routed game and a player, and 0.35 is set low deliberately: a weak
 * Laya label is still often better than a keyword match, so we only discard
 * answers that are close to a coin flip.
 *
 * Note that the *default* checkpoint is now `typed-decisions`, which is much
 * stronger on this task shape. 0.35 is kept rather than raised because the
 * gate must also stay correct if someone points LAYA_MODEL back at
 * `multilingual`, and because a mis-answered optional nudge is cheap while a
 * mis-routed game is not.
 */
export const MIN_CONFIDENCE = 0.35

/** How long a health probe result stays valid. */
export const HEALTH_TTL_MS = 15_000
