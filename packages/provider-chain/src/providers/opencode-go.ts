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
 * ── Headers, and why ───────────────────────────────────────────────────────
 * Two headers beyond auth are REQUIRED, per https://opencode.ai/docs/go/:
 * Go is metered and monitored, and it refuses requests it cannot route or
 * attribute. Measured against the live endpoint:
 *
 *   400 "Request is missing x-opencode-session and cannot be routed
 *        efficiently. Please see https://opencode.ai/docs/go/#where-can-i-use-it"
 *
 *   1. A client-specific `user-agent` ("dsa-game/0.1.0"), NOT a generic SDK or
 *      HTTP-library name. The docs ask for this explicitly.
 *   2. A STABLE `x-opencode-session` per conversation, so Go can route and
 *      cache prompts. One id per generate() call: each call is an independent
 *      authoring request, so sharing one id across problems would misattribute
 *      unrelated traffic.
 *
 * An earlier version of this file asserted the opposite — that only
 * `content-type` and `authorization` were needed, on the grounds that the
 * `x-opencode-*` names in the opencode binary "belong to the local serve API".
 * That was wrong: `x-opencode-session` is required here as well, and the
 * failure mode is a bare 400 that reads like a schema bug rather than a header.
 */

import {
  explainGameSpecError,
  gameSpecJsonSchema,
  MECHANICS,
  parseGameSpecLoose,
  toStrictJsonSchema,
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
  /**
   * Client identity sent as `user-agent`. opencode-go asks clients to identify
   * themselves rather than shipping a generic SDK name, and it is metered, so
   * this is part of the contract rather than cosmetics.
   */
  userAgent: string
  /**
   * Optional fixed `x-opencode-session`. Empty means "one id per generate
   * call", which is the right default here because each call is an independent
   * authoring request. Pin it only when several calls are genuinely one
   * conversation and should share prompt caching.
   */
  sessionId: string
}

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1'

/**
 * Free-first. Used only to order the *live* list, never as an assertion that a
 * model exists. LongCat Preview Free was verified against the live GameSpec
 * prompt on 2026-09-28; Space Bunny Free is retained as the next zero-cost
 * option. Paid small/fast models are considered only when neither free id is
 * present in the live catalog.
 *
 * OpenCode marks both free ids as limited-time models, so the list can change.
 * The *fallback* (used when `/models` is unreachable) remains a known free
 * model on purpose: guessing a paid model id would spend real money on a
 * discovery failure.
 */
const MODEL_PREFERENCE: readonly string[] = [
  'longcat-2.5-preview-free',
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

/**
 * A GameSpec is a few thousand tokens of strict JSON, and the models served here
 * are largely REASONING models that spend tokens before they answer.
 *
 * Measured against `space-bunny-free` with the real GameSpec prompt:
 *   max_tokens 4000  -> finish_reason "length", content 0 chars, reasoning_tokens 4000
 *   max_tokens 16000 -> finish_reason "stop",   content 4970 chars, reasoning_tokens 6835
 *
 * So the old 4000 default did not produce a short spec — it produced an EMPTY one
 * with every token consumed by reasoning, which surfaced as the baffling
 * "200 with no choices[0].message.content". 16000 leaves room for the reply
 * after the thinking. Lower it only for a non-reasoning model.
 */
const DEFAULT_MAX_TOKENS = 16_000

/**
 * A GameSpec took ~126s end to end on this endpoint, so the default leaves
 * headroom above that. It must stay at or below `CHAIN_TIMEOUT_MS` (200s) or the
 * chain aborts first and the tier never gets to finish.
 */
const DEFAULT_TIMEOUT_MS = 180_000

/**
 * Client identity. opencode-go explicitly asks clients to send their own name
 * rather than a generic SDK/HTTP-library identifier, so this is deliberately
 * ours and deliberately identifies what the client is.
 */
const DEFAULT_USER_AGENT = 'dsa-game/0.1.0 (opencode-go GameSpec generator)'

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
    userAgent: env.OPENCODE_GO_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    sessionId: env.OPENCODE_GO_SESSION?.trim() ?? '',
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
  /**
   * Identifies this provider instance inside `x-opencode-session`, and
   * `callCounter` makes each generate() call its own conversation. No crypto
   * needed: the value only has to be stable and distinct, not unguessable.
   */
  private readonly instanceId: string
  private callCounter = 0

  constructor(cfg: Partial<OpencodeGoConfig> = {}) {
    this.cfg = { ...opencodeGoConfigFromEnv(), ...cfg }
    // Per-process, per-provider-instance. Combined with callCounter this makes
    // every generate() call a distinct conversation.
    const salt = Math.floor(Math.random() * 0xffffff)
      .toString(36)
      .padStart(4, '0')
    this.instanceId = `${salt}${Date.now().toString(36).slice(-4)}`
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

  /**
   * The `x-opencode-session` value for one generate() call.
   *
   * opencode-go wants a STABLE id per conversation so it can route and cache.
   * One GameSpec is one conversation: its own system prompt, its own problem,
   * its own seed. Reusing a single id across calls would attribute unrelated
   * authoring traffic to one conversation and defeat the caching the header
   * exists for.
   */
  private sessionId(): string {
    if (this.cfg.sessionId.length > 0) return this.cfg.sessionId
    this.callCounter += 1
    return `gamespec-${this.instanceId}-${this.callCounter}`
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
        // Both required by opencode-go; see the header note at the top of this
        // file. `user-agent` identifies the client, `x-opencode-session` lets Go
        // route and cache. Dropping either earns a bare 400.
        'user-agent': this.cfg.userAgent,
        'x-opencode-session': this.sessionId(),
      },
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(this.cfg.timeoutMs)]) : AbortSignal.timeout(this.cfg.timeoutMs),
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
            // Narrowed to this problem's allowed mechanics so strict mode
            // enforces the per-problem invariant, not just the id enum, then
            // reduced to the schema subset opencode-go actually accepts.
            schema: toStrictJsonSchema(
              schemaForProblem(
                gameSpecJsonSchema(),
                input.problem.allowedMechanics.map((id) => ({ id, op: MECHANICS[id].op })),
              ),
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

    // `length` means the model ran out of budget. Check this BEFORE the empty
    // content check: a reasoning model that spends the whole budget thinking
    // returns 200 with an empty message and finish_reason "length", and
    // reporting that as "no content" hides the one thing that fixes it.
    if (finishReason(body) === 'length') {
      const usage = tokenUsage(body)
      throw new SpecValidationError(
        `response was truncated at max_tokens=${this.cfg.maxTokens} before it became valid JSON` +
          (usage
            ? ` (reasoning_tokens=${usage.reasoning ?? '?'}, completion_tokens=${usage.completion ?? '?'})`
            : '') +
          '; the models here are reasoning models, so the budget must cover their thinking as well as the reply — raise OPENCODE_GO_MAX_TOKENS',
      )
    }

    const text = contentFromChatCompletion(body)
    if (text.length === 0) {
      const usage = tokenUsage(body)
      throw new Error(
        'opencode-go returned 200 with no choices[0].message.content' +
          (usage ? ` (usage ${JSON.stringify(usage)})` : '') +
          '; finish_reason=' +
          String(finishReason(body) ?? 'unknown'),
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

/**
 * Token counts, for explaining an empty or truncated reply.
 *
 * The reasoning/completion split is the whole story for a reasoning model: a
 * reply that is empty because the budget went entirely into thinking is a very
 * different bug from one that was refused, and the usage block is the only
 * place that distinguishes them.
 */
function tokenUsage(body: unknown): { reasoning?: number; completion?: number } | null {
  if (!isObj(body)) return null
  const usage = body['usage']
  if (!isObj(usage)) return null
  const details = usage['completion_tokens_details']
  const reasoning =
    isObj(details) && typeof details['reasoning_tokens'] === 'number' ? details['reasoning_tokens'] : undefined
  const completion =
    typeof usage['completion_tokens'] === 'number' ? (usage['completion_tokens'] as number) : undefined
  if (reasoning === undefined && completion === undefined) return null
  return {
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(completion === undefined ? {} : { completion }),
  }
}
