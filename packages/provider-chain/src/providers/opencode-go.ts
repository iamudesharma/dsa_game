/**
 * TIER 1 — OpenCode Go, a direct HTTPS provider.
 *
 * This is the *primary* generative tier. It talks straight to
 * `https://opencode.ai/zen/go/v1`, an OpenAI-compatible endpoint declared with
 * the `@ai-sdk/openai-compatible` protocol, so the request is an ordinary
 * `POST /chat/completions` with `Authorization: Bearer $OPENCODE_API_KEY`.
 * There is no local gateway, no `opencode serve` process and no CLI: a game
 * generates from a phone with the API service running anywhere.
 *
 * ── Why the model default is resolved at runtime ─────────────────────────────
 * The catalog at models.opencode.ai is not the source of truth for what the
 * endpoint serves. `GET {baseUrl}/models` is public (no auth, no charge) and is
 * the authoritative list; captured live 2026-09-26 it returned 42 ids including
 * `minimax-m3`, `kimi-k3` and `space-bunny-free` — several of which are absent
 * from the static docs. A hardcoded model string is therefore a guess that rots,
 * so `OPENCODE_GO_MODEL` is left empty by default and `resolveModel()` picks
 * from the live list instead. Discovery is cached per provider instance and is
 * best-effort: a failed `/models` call falls back to `DEFAULT_MODEL` rather than
 * failing the request, because discovery is an optimisation and the generation
 * is the thing that must happen.
 *
 * ── Headers, deliberately minimal ───────────────────────────────────────────
 * Only `content-type` and `authorization` are sent. The `x-opencode-client`,
 * `x-opencode-directory`, `x-opencode-session`, `x-opencode-ticket` and
 * `x-opencode-workspace` headers that appear inside the opencode binary belong
 * to the *local* `opencode serve` session API (see `providers/opencode.ts`), not
 * to this public HTTP endpoint. Nothing here needs them, and sending stray
 * headers to a metered public API is how you get throttled. `chain.test.ts`
 * asserts their absence so a future "just add the header" patch fails loudly.
 *
 * `temperature` is ~0.9, higher than the correctness tiers: the engine owns
 * correctness and this tier exists to be surprising.
 */

import {
  explainGameSpecError,
  gameSpecJsonSchema,
  MECHANICS,
  parseGameSpecLoose,
  type GameSpec,
  type ProviderTier,
} from '@dsa/game-schema'
import { enforceAllowedMechanics } from '../guards.js'
import { schemaForProblem } from '../grammar.js'
import { buildPrompts, repairPrompt } from '../prompt.js'
import { SpecValidationError, type GenerateSpecInput, type SpecProvider } from '../types.js'

export interface OpencodeGoConfig {
  enabled: boolean
  apiKey: string
  baseUrl: string
  /** Empty means "resolve from `GET /models` at call time". */
  model: string
  timeoutMs: number
  temperature: number
  maxTokens: number
  /** Budget for the unauthenticated `/models` discovery call. Must stay short. */
  modelsTimeoutMs: number
}

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1'

/**
 * Cheapest/fastest first. Used only to order the *live* list, never as an
 * assertion that a model exists.
 *
 * `space-bunny-free` leads because it is free and is already recorded in
 * `.env.example` as the only opencode model that actually answered on the
 * account this was built on; the rest are the small/fast variants of the
 * families present in the live list. The *fallback* (used when `/models` is
 * unreachable) is the same free model on purpose: guessing a paid model id
 * would spend real money on a discovery failure.
 */
const MODEL_PREFERENCE: readonly string[] = [
  'space-bunny-free',
  'mimo-v2.6-flash',
  'deepseek-flash',
  'glm-5.3-flash',
  'qwen3.8-flash',
  'deepseek-v4.1-flash',
  'deepseek-v4-flash',
]

/** Used when `GET /models` is unreachable and `OPENCODE_GO_MODEL` is unset. */
const DEFAULT_MODEL = 'space-bunny-free'

/** A GameSpec is a long strict JSON object; 2500 tokens is uncomfortably tight. */
const DEFAULT_MAX_TOKENS = 4000

/**
 * A GameSpec took ~126s end to end on this endpoint, so the default leaves
 * headroom above that. It must stay at or below `CHAIN_TIMEOUT_MS` (200s) or the
 * chain aborts first and the tier never gets to finish.
 */
const DEFAULT_TIMEOUT_MS = 180_000

const DEFAULT_TEMPERATURE = 0.9

function flag(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase())
}

export function opencodeGoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OpencodeGoConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v === undefined ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    enabled: flag('OPENCODE_GO_ENABLED', true, env),
    // `OPENCODE_API_KEY` is what the opencode integration itself reads, so an
    // operator who has already exported it for the CLI needs nothing extra.
    apiKey: (env.OPENCODE_GO_API_KEY?.trim() || env.OPENCODE_API_KEY?.trim() || ''),
    baseUrl: (env.OPENCODE_GO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: env.OPENCODE_GO_MODEL?.trim() ?? '',
    timeoutMs: num(env.OPENCODE_GO_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    temperature: num(env.OPENCODE_GO_TEMPERATURE, DEFAULT_TEMPERATURE),
    maxTokens: num(env.OPENCODE_GO_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    modelsTimeoutMs: 4000,
  }
}

interface Json {
  [key: string]: unknown
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Pick the cheapest model the endpoint is actually serving.
 *
 * Pure so the preference order is testable without a network, and it returns
 * `null` rather than a guess when nothing matches — the caller decides whether
 * to fall back.
 */
export function pickPreferredModel(available: readonly string[]): string | null {
  const served = new Set(available)
  for (const candidate of MODEL_PREFERENCE) {
    if (served.has(candidate)) return candidate
  }
  return null
}

/** Same OpenAI-compatible envelope as the other HTTP tiers, kept local so the
 *  tiers can evolve apart (see the identical note in `local-llm.ts`). */
function contentFromChatCompletion(body: unknown): string {
  if (!isObj(body)) return ''
  const choices = body['choices']
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!isObj(first)) return ''
  const message = first['message']
  if (isObj(message) && typeof message['content'] === 'string') return message['content']
  // Some gateways answer a json_schema request with a `text` field instead.
  if (typeof first['text'] === 'string') return first['text']
  return ''
}

/** `{ error: { type, message } }`, from either envelope shape. */
function errorEnvelope(body: unknown): { type: string; message: string } | null {
  if (!isObj(body)) return null
  const err = body['error']
  if (!isObj(err)) return null
  const message = typeof err['message'] === 'string' ? err['message'] : ''
  const type = typeof err['type'] === 'string' ? err['type'] : typeof body['type'] === 'string' ? body['type'] : 'Error'
  return { type, message }
}

/**
 * Map a status to the one sentence a learner can act on.
 *
 * The distinction that matters most is 402 vs a timeout. A drained account and a
 * slow model are indistinguishable if both are reported as "took too long", and
 * "took too long" is the exact failure mode this tier exists to remove — so each
 * status names its own cause instead of collapsing into a generic failure.
 */
function describeStatus(status: number, detail: string): string {
  const suffix = detail.length > 0 ? `: ${detail}` : ''
  switch (status) {
    case 401:
    case 403:
      return `opencode-go 401/403 — OPENCODE_GO_API_KEY is missing or invalid${suffix}`
    case 402:
      return (
        'opencode-go 402 — the account has no funds (this is what an exhausted key ' +
        `looks like; top up the OpenCode account or set OPENCODE_GO_API_KEY)${suffix}`
      )
    case 429:
      return `opencode-go 429 — rate limited; wait and retry, or lower the request rate${suffix}`
    default:
      break
  }
  if (status >= 500) {
    return `opencode-go ${status} — upstream error on opencode.ai, not a problem with the request${suffix}`
  }
  return `opencode-go ${status}${suffix}`
}

/**
 * Turn an embedded error type back into a status so a 200-with-error-body is
 * reported as the same failure a real 401/402/429 would produce.
 */
function statusForErrorType(type: string): number | null {
  if (/auth|permission|forbidden|unauthor/i.test(type)) return 401
  if (/payment|credit|billing|quota|insufficient/i.test(type)) return 402
  if (/rate|too_many/i.test(type)) return 429
  return null
}

export class OpencodeGoProvider implements SpecProvider {
  readonly tier: ProviderTier = 'opencode-go'
  private readonly cfg: OpencodeGoConfig
  /**
   * Cached `GET /models` resolution. Cached as a *promise* so a failed lookup is
   * not retried on every generate.
   */
  private modelPromise: Promise<string> | null = null

  constructor(cfg: Partial<OpencodeGoConfig> = {}) {
    this.cfg = { ...opencodeGoConfigFromEnv(), ...cfg }
  }

  /**
   * A key present plus enabled is the whole test.
   *
   * Deliberately no I/O: `/models` is free but it is still a network round trip
   * on a path that gates every generate, and "is there a key" is answerable from
   * the environment. The key itself is only proven by the first real call, whose
   * 401 says so plainly.
   */
  async isAvailable(): Promise<boolean> {
    return this.cfg.enabled && this.cfg.apiKey.length > 0
  }

  async generate(input: GenerateSpecInput): Promise<GameSpec> {
    const { system, user } = buildPrompts(input)
    return this.ask(system, user, input)
  }

  async repair(input: GenerateSpecInput, issues: string): Promise<GameSpec> {
    const { system, user } = buildPrompts(input)
    return this.ask(system, `${user}\n\n---\n\n${repairPrompt(issues)}`, input)
  }

  /**
   * Resolve the model id. An explicit `OPENCODE_GO_MODEL` always wins; otherwise
   * pick from the live `/models` list, once per provider instance.
   */
  private resolveModel(): Promise<string> {
    if (this.cfg.model.length > 0) return Promise.resolve(this.cfg.model)
    if (!this.modelPromise) this.modelPromise = this.discoverModel()
    return this.modelPromise
  }

  private async discoverModel(): Promise<string> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/models`, {
        signal: AbortSignal.timeout(this.cfg.modelsTimeoutMs),
      })
      const raw = await res.text()
      if (!res.ok) return DEFAULT_MODEL
      const body: unknown = JSON.parse(raw)
      const data = isObj(body) ? body['data'] : undefined
      if (!Array.isArray(data)) return DEFAULT_MODEL
      const ids: string[] = []
      for (const entry of data) {
        if (isObj(entry) && typeof entry['id'] === 'string') ids.push(entry['id'])
      }
      return pickPreferredModel(ids) ?? DEFAULT_MODEL
    } catch {
      // Best effort by design: an unreachable catalogue must not block a
      // generation, and the fallback is the free model, so the worst case is a
      // 401/404 from the endpoint rather than a spend.
      return DEFAULT_MODEL
    }
  }

  private async ask(system: string, user: string, input: GenerateSpecInput): Promise<GameSpec> {
    // The chain only reaches `generate()` after `isAvailable()`, but a direct
    // caller (a health probe, a script) would otherwise spend money on a tier
    // that was explicitly switched off.
    if (!this.cfg.enabled) throw new Error('opencode-go tier disabled by OPENCODE_GO_ENABLED')
    if (this.cfg.apiKey.length === 0) {
      throw new Error(
        'OPENCODE_GO_API_KEY is empty and OPENCODE_API_KEY is unset; the opencode-go tier cannot run',
      )
    }
    const model = await this.resolveModel()
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
      body: JSON.stringify({
        model,
        temperature: this.cfg.temperature,
        max_tokens: this.cfg.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          // Narrowed to this problem's allowed mechanics so strict mode enforces
          // the per-problem invariant, not just the id enum.
          json_schema: {
            name: 'game_spec',
            strict: true,
            schema: schemaForProblem(
              gameSpecJsonSchema(),
              input.problem.allowedMechanics.map((id) => ({ id, op: MECHANICS[id].op })),
            ),
          },
        },
      }),
    })

    const body = await readJson(res)

    if (!res.ok) {
      const err = errorEnvelope(body)
      const detail = (err?.message ?? (typeof body === 'string' ? body : '')).slice(0, 300)
      throw new Error(describeStatus(res.status, detail))
    }

    // A 200 is not proof of success: this endpoint answers a bad key with
    // `{"type":"error","error":{"type":"AuthError",...}}` and HTTP 200. Classify
    // the embedded type so the learner sees "API key invalid", not "no content".
    const embedded = errorEnvelope(body)
    if (embedded) {
      const status = statusForErrorType(embedded.type)
      if (status !== null) throw new Error(describeStatus(status, embedded.message.slice(0, 300)))
      throw new Error(`opencode-go returned an error envelope: ${embedded.type}: ${embedded.message.slice(0, 300)}`)
    }

    const text = contentFromChatCompletion(body)
    if (text.length === 0) {
      throw new Error('opencode-go returned 200 with no choices[0].message.content')
    }

    // `length` means the JSON was cut off mid-object, which is a different bug
    // from a model that ignored the schema. Say which, so the fix (raise
    // OPENCODE_GO_MAX_TOKENS) is obvious.
    if (finishReason(body) === 'length') {
      throw new SpecValidationError(
        `response was truncated at max_tokens=${this.cfg.maxTokens} before it became valid JSON; raise OPENCODE_GO_MAX_TOKENS`,
      )
    }

    const spec = parseGameSpecLoose(text)
    if (!spec) throw new SpecValidationError(explainGameSpecError(text) || 'response was not a GameSpec')

    // The strict schema pins the mechanic *ids* but cannot know which ones this
    // problem allows, so the guard still runs. A weaker model will happily emit
    // a mechanic the problem cannot render (already seen with Qwen2.5-0.5B).
    const guarded = enforceAllowedMechanics(spec, input.problem.allowedMechanics)
    if (!guarded) {
      throw new SpecValidationError(
        `mechanics[] had nothing in common with allowedMechanics [${input.problem.allowedMechanics.join(', ')}]`,
      )
    }
    return {
      ...guarded,
      problemId: input.problem.id,
      seed: input.seed,
      language: input.language ?? guarded.language,
      generatedBy: this.tier,
    }
  }
}

/** Read a body once, as JSON, without ever throwing. */
async function readJson(res: Response): Promise<unknown> {
  let raw: string
  try {
    raw = await res.text()
  } catch {
    return null
  }
  if (raw.length === 0) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function finishReason(body: unknown): string {
  if (!isObj(body)) return ''
  const choices = body['choices']
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!isObj(first)) return ''
  return typeof first['finish_reason'] === 'string' ? first['finish_reason'] : ''
}
