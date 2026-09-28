/**
 * The 4-tier chain: opencode -> openrouter -> local-llm -> template.
 *
 * Two invariants:
 *   1. A provider's throw never escapes. Every failure becomes a
 *      `ProviderAttempt` with `ok:false`, and `onAttempt` fires for each one
 *      (skips included) so the API can report the full tier story.
 *   2. Tier 4 has no I/O and cannot be skipped, so the aggregate failure path
 *      is reachable only if the problem registry itself is malformed.
 */

import { type GameSpec, type ProviderAttempt, type ProviderTier } from '@dsa/game-schema'
import { repairPrompt } from './prompt.js'
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

/**
 * Races a promise against a timer. `AbortSignal.timeout` only helps promises
 * that were built on `fetch`, and a provider may be doing subprocess work.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

export async function chainGenerateSpec(
  input: GenerateSpecInput,
  opts: ChainOptions,
): Promise<GenerateSpecResult> {
  const maxRepairs = opts.maxRepairsPerTier ?? DEFAULT_REPAIRS
  const timeoutMs = opts.timeoutMs ?? chainTimeoutFromEnv()

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
    // ---- availability gate -------------------------------------------------
    let available = false
    const probeStart = Date.now()
    try {
      available = await provider.isAvailable()
    } catch (e) {
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

    // ---- generate ----------------------------------------------------------
    const start = Date.now()
    let spec: GameSpec | null = null
    try {
      spec = await withTimeout(provider.generate(input), timeoutMs, `${provider.tier}.generate`)
    } catch (e) {
      const attempt: ProviderAttempt = { tier: provider.tier, ok: false, ms: Date.now() - start, error: errorText(e) }
      report(attempt)
      notes.push(`${provider.tier} failed: ${attempt.error ?? 'unknown error'}`)

      // One repair round-trip, only when the failure was a schema violation and
      // the tier actually implements `repair`.
      if (maxRepairs > 0 && provider.repair && isSpecValidationError(e)) {
        const repairStart = Date.now()
        try {
          const fixed = await withTimeout(
            provider.repair(input, e.issues),
            timeoutMs,
            `${provider.tier}.repair`,
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
          return { spec: stamped(fixed, provider.tier), tier: provider.tier, attempts, notes: [...notes, `spec repaired by ${provider.tier}`] }
        } catch (re) {
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

  const detail = attempts
    .map((a) => `${a.tier}${a.error ? `: ${a.error}` : ''}`)
    .join('; ')
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
