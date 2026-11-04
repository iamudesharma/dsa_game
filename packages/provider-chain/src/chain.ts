/**
 * The 5-tier chain: OpenCode Go -> local OpenCode -> OpenRouter -> local LLM -> template.
 *
 * Two invariants:
 *   1. A provider's throw never escapes. Every failure becomes a
 *      `ProviderAttempt` with `ok:false`, and `onAttempt` fires for each one
 *      (skips included) so the API can report the full tier story.
 *   2. Tier 4 has no I/O and cannot be skipped, so the aggregate failure path
 *      is reachable only if the problem registry itself is malformed.
 */

import { Effect } from 'effect'
import { type GameSpec, type ProviderAttempt, type ProviderTier } from '@dsa/game-schema'
import {
  errorText,
  isSpecValidationError,
  type ChainOptions,
  type GenerateSpecInput,
  type GenerateSpecResult,
  type SpecProvider,
} from './types.js'

const DEFAULT_REPAIRS = 1
const DEFAULT_TIMEOUT_MS = 200_000

/**
 * Per-tier wall clock. Generous by default: the slowest realistic tier is the
 * opencode subprocess, which pays CLI start-up on top of the generation itself.
 *
 * This must be at least the provider's own `timeoutMs` (180s for opencode), or
 * the chain aborts first and the tier never gets to finish. Measured at ~103s
 * for a binary-search GameSpec, so the old 60s default left no headroom and the
 * tier failed with a bare "timed out after 60000ms".
 */
function chainTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['CHAIN_TIMEOUT_MS']
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

/** Lazy operations receive the owning fiber's abort signal, including timeout. */
async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number,
  label: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const program = Effect.tryPromise({
    try: run,
    catch: error => error instanceof Error ? error : new Error(String(error)),
  }).pipe(
    Effect.timeoutOrElse({ duration: ms, orElse: () => Effect.fail(new Error(`${label} timed out after ${ms}ms`)) }),
    Effect.match({ onSuccess: value => ({ ok: true as const, value }), onFailure: error => ({ ok: false as const, error }) }),
  )
  try {
    const result = await Effect.runPromise(program, { signal })
    if (!result.ok) throw result.error
    return result.value
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
}

function probeTimeoutFromEnv(): number {
  const raw = process.env.CHAIN_PROBE_TIMEOUT_MS
  const value = raw?.trim() ? Number(raw) : NaN
  return Number.isInteger(value) && value > 0 && value <= 300_000 ? value : 5_000
}

export async function chainGenerateSpec(
  input: GenerateSpecInput,
  opts: ChainOptions,
): Promise<GenerateSpecResult> {
  const maxRepairs = opts.maxRepairsPerTier ?? DEFAULT_REPAIRS
  const timeoutMs = opts.timeoutMs ?? chainTimeoutFromEnv()
  const probeTimeoutMs = opts.probeTimeoutMs ?? probeTimeoutFromEnv()
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(probeTimeoutMs) || probeTimeoutMs <= 0) {
    throw new RangeError('Provider deadlines must be positive finite milliseconds')
  }

  // `forceTemplate` is a user-facing switch ("I want it fast and offline"), so
  // it hard-filters the list rather than merely skipping unavailable tiers.
  const tiers: SpecProvider[] = input.forceTemplate
    ? opts.providers.filter((p) => p.tier === 'template')
    : opts.providers
  if (tiers.length === 0) {
    throw new Error('chainGenerateSpec: no providers configured (forceTemplate with no template tier)')
  }

  const attempts: ProviderAttempt[] = []
  const notes: string[] = []
  const report = (a: ProviderAttempt): void => {
    attempts.push(a)
    opts.onAttempt?.(a)
  }

  for (const provider of tiers) {
    input.signal?.throwIfAborted()
    // ---- availability gate -------------------------------------------------
    let available = false
    const probeStart = Date.now()
    try {
      available = await withDeadline(signal => provider.isAvailable(signal), probeTimeoutMs, `${provider.tier}.isAvailable`, input.signal)
    } catch (e) {
      input.signal?.throwIfAborted()
      // A probe that throws is a broken probe, not a broken tier.
      report({
        tier: provider.tier,
        ok: false,
        ms: Date.now() - probeStart,
        error: `isAvailable() threw: ${errorText(e)}`,
      })
      continue
    }
    if (!available) {
      report({
        tier: provider.tier,
        ok: false,
        ms: Date.now() - probeStart,
        error: `skipped: ${describeSkip(provider.tier)}`,
      })
      continue
    }

    input.signal?.throwIfAborted()
    // ---- generate ----------------------------------------------------------
    const start = Date.now()
    let spec: GameSpec | null = null
    try {
      spec = await withDeadline(signal => provider.generate({ ...input, signal }), timeoutMs, `${provider.tier}.generate`, input.signal)
    } catch (e) {
      input.signal?.throwIfAborted()
      const attempt: ProviderAttempt = {
        tier: provider.tier,
        ok: false,
        ms: Date.now() - start,
        error: errorText(e),
      }
      report(attempt)
      notes.push(`${provider.tier} failed: ${attempt.error ?? 'unknown error'}`)

      // One repair round-trip, only when the failure was a schema violation and
      // the tier actually implements `repair`.
      if (maxRepairs > 0 && provider.repair && isSpecValidationError(e)) {
        const repairStart = Date.now()
        try {
          const repair = provider.repair.bind(provider)
          const fixed = await withDeadline(
            signal => repair({ ...input, signal }, e.issues),
            timeoutMs,
            `${provider.tier}.repair`,
            input.signal,
          )
          // `ProviderAttempt` has no dedicated "was repaired" flag, so the note
          // rides in `error` alongside `ok: true`. Recording the repair as its
          // own attempt is what lets the API show "failed, then repaired"
          // instead of a single opaque success.
          report({
            tier: provider.tier,
            ok: true,
            ms: Date.now() - repairStart,
            error: 'repaired after schema violation',
          })
          return {
            spec: stamped(fixed, provider.tier),
            tier: provider.tier,
            attempts,
            notes: [...notes, `spec repaired by ${provider.tier}`],
          }
        } catch (re) {
          input.signal?.throwIfAborted()
          const rAttempt: ProviderAttempt = {
            tier: provider.tier,
            ok: false,
            ms: Date.now() - repairStart,
            error: `repair failed: ${errorText(re)}`,
          }
          report(rAttempt)
          notes.push(`${provider.tier} repair failed: ${rAttempt.error ?? ''}`)
        }
      }
      continue
    }

    report({ tier: provider.tier, ok: true, ms: Date.now() - start })
    return { spec: stamped(spec, provider.tier), tier: provider.tier, attempts, notes }
  }

  const detail = attempts.map((a) => `${a.tier}${a.error ? `: ${a.error}` : ''}`).join('; ')
  throw new Error(`generation failed across all tiers [${tiers.map((t) => t.tier).join(', ')}] -> ${detail}`)
}

/** A short, human-readable reason used in `skipped:` attempt errors. */
function describeSkip(tier: ProviderTier): string {
  switch (tier) {
    case 'opencode-go':
      return 'OPENCODE_GO_API_KEY is empty and OPENCODE_API_KEY is unset (or OPENCODE_GO_ENABLED=0)'
    case 'opencode':
      return 'no opencode server on OPENCODE_BASE_URL and no `opencode` binary on PATH (or OPENCODE_ENABLED=0)'
    case 'openrouter':
      return 'OPENROUTER_API_KEY is empty'
    case 'local-llm':
      return 'no llama-server on LOCAL_LLM_BASE_URL (or LOCAL_LLM_ENABLED=0)'
    case 'template':
      return 'unreachable: the template tier is always available'
  }
}

/** The tier that produced a spec owns `generatedBy`, whatever the model claimed. */
function stamped(spec: GameSpec, tier: ProviderTier): GameSpec {
  return { ...spec, generatedBy: tier }
}
