/**
 * The provider-chain contract.
 *
 * The API service codes against this file and nothing else in the package, so
 * every shape here is deliberately boring: no generics, no generics-in-disguise,
 * no callbacks that can throw. A tier may fail; the chain converts that into a
 * `ProviderAttempt` and moves on.
 */

import type {
  Difficulty,
  GameSpec,
  ProblemInstance,
  ProblemMeta,
  ProviderAttempt,
  ProviderTier,
} from '@dsa/game-schema'

export interface GenerateSpecInput {
  problem: ProblemMeta
  instance: ProblemInstance
  seed: number
  difficulty: Difficulty
  language?: string
  /** Player free-text to steer the theme. Omit for a neutral generation. */
  freeText?: string
  /** Reject the LLM tiers entirely. */
  forceTemplate?: boolean
}

export interface GenerateSpecResult {
  spec: GameSpec
  tier: ProviderTier
  attempts: ProviderAttempt[]
  notes: string[]
}

export interface SpecProvider {
  readonly tier: ProviderTier
  /** Cheap, no-I/O availability probe. Must not throw. */
  isAvailable(): Promise<boolean>
  generate(input: GenerateSpecInput): Promise<GameSpec>
  /**
   * Optional single-shot repair after a schema violation. When absent the
   * chain records the failure and moves to the next tier instead.
   *
   * `issues` is the human-readable zod report from `explainGameSpecError`.
   */
  repair?(input: GenerateSpecInput, issues: string): Promise<GameSpec>
}

export interface ChainOptions {
  /** Tried in the order given. `defaultChain()` yields the canonical order. */
  providers: SpecProvider[]
  /** Total repair round-trips allowed. Default 1. */
  maxRepairsPerTier?: number
  onAttempt?: (a: ProviderAttempt) => void
  /** Per-tier wall clock budget for `generate()`. Default 60_000. */
  timeoutMs?: number
}

/**
 * Thrown by providers when the model returned something that is not a valid
 * GameSpec. Carrying the zod report lets the chain build a repair prompt
 * instead of blindly asking the model to try again.
 */
export class SpecValidationError extends Error {
  readonly issues: string
  constructor(issues: string) {
    super(`invalid GameSpec: ${issues}`)
    this.name = 'SpecValidationError'
    this.issues = issues
  }
}

export function isSpecValidationError(e: unknown): e is SpecValidationError {
  return e instanceof SpecValidationError
}

/** Normalise anything thrown into a short string for `ProviderAttempt.error`. */
export function errorText(e: unknown): string {
  if (e instanceof Error) {
    // Node fetch surfaces AbortSignal.timeout as a TimeoutError; keep it short.
    const msg = e.message.length > 300 ? `${e.message.slice(0, 300)}…` : e.message
    return `${e.name}: ${msg}`
  }
  if (typeof e === 'string') return e.slice(0, 300)
  try {
    return JSON.stringify(e).slice(0, 300)
  } catch {
    return String(e).slice(0, 300)
  }
}
