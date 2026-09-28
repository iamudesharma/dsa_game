/**
 * A minimal, non-throwing typed client for `laya-serve`.
 *
 * Wire contract, as implemented by `laya/serve.py` in the Laya repo:
 *
 *   POST {baseUrl}/v1/systemone
 *   body: { state: string | object | list, model?: string,
 *           questions: { <name>: LayaQuestion } }
 *   resp: { model, answers: { <name>: LayaAnswer }, usage, routing }
 *
 *   GET  {baseUrl}/health
 *   resp: { status: "ok", loaded, revisions, device }
 *
 * A question is one of exactly three shapes:
 *   { type: "choice", instructions, criteria: { <key>: <description> } }
 *   { type: "score",  instructions, criteria: [ <level description>, ... ] }
 *   { type: "noul",   instructions }                       // no criteria
 *
 * An answer looks like (only the fields we read):
 *   choice: { type, choice, probabilities, confidence, answer_confidence }
 *   score:  { type, score, legend, probabilities, confidence, answer_confidence }
 *   noul:   { type, noul, confidence, answer_confidence }
 *
 * Two naming traps this module handles, both worth stating because they are
 * easy to get wrong from the README's prose:
 *
 *  1. The per-option distribution is called **`probabilities`**, not
 *     `distribution`. (`distribution` is accepted below as a tolerated alias
 *     in case a deployment proxies a Jev-shaped response.)
 *  2. `confidence` on a `choice`/`score` answer is `1 - normalised entropy` —
 *     a concentration measure, NOT a probability that the answer is right. The
 *     probability of the reported answer is `answer_confidence`. We prefer
 *     `answer_confidence` and only fall back, per the Laya README's own advice
 *     to "gate on `answer_confidence` ... for one calibrated number on every
 *     question type".
 *
 * Every method here returns `null`/`false` instead of throwing. A dead sidecar
 * is an expected steady state on the hardware this project targets, not an
 * exceptional one.
 */

import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS } from './types.js'

export type LayaQuestionType = 'choice' | 'score' | 'noul'

export interface LayaChoiceQuestion {
  type: 'choice'
  instructions: string
  /** key -> human description of that key. NOT an array of bare strings. */
  criteria: Record<string, string>
}

export interface LayaScoreQuestion {
  type: 'score'
  instructions: string
  /** One description per ordinal level. A `null` level is rejected with 422. */
  criteria: string[]
}

export interface LayaNoulQuestion {
  type: 'noul'
  instructions: string
}

export type LayaQuestion = LayaChoiceQuestion | LayaScoreQuestion | LayaNoulQuestion

export interface LayaSystemOneRequest {
  /**
   * Laya accepts a string, an object, or a list. We always normalise to a
   * string here: the game already flattens its situation into `stateText`,
   * and a bare string sidesteps the server's `serialize_state` surprises.
   */
  state: string
  questions: Record<string, LayaQuestion>
  /** Honoured by the server when it names a Laya checkpoint. */
  model?: string
}

export interface LayaAnswer {
  type?: string
  /** `choice` */
  choice?: unknown
  /** `score` — a float over the ordinal levels. */
  score?: unknown
  /** `noul` — P(true). */
  noul?: unknown
  /** 1 - normalised entropy for choice/score; max(p) for noul. */
  confidence?: unknown
  /** The calibrated probability that the reported answer is right. */
  answer_confidence?: unknown
  /** Per-option probabilities. */
  probabilities?: unknown
  /** Tolerated alias for `probabilities` (Jev-shaped proxies). */
  distribution?: unknown
  /** score: index -> level description. */
  legend?: unknown
}

export interface LayaRouting {
  model?: string
  repo?: string
  reason?: string
}

export interface LayaSystemOneResponse {
  answers: Record<string, LayaAnswer>
  routing?: LayaRouting
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export interface LayaClientOptions {
  baseUrl?: string
  model?: string
  timeoutMs?: number
  /** Sent as `Authorization: Bearer <key>` when LAYA_API_KEY is set. */
  apiKey?: string
  /** Injected in tests; captured at construction. */
  fetchImpl?: typeof fetch
}

// ---------------------------------------------------------------- parsing

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clamp anything to a finite number in [0,1]; `null` for anything unusable. */
function toUnitInterval(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** Keep only finite numbers, in [0,1], as a plain string-keyed record. */
function toNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, number> = {}
  let seen = false
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    out[k] = v
    seen = true
  }
  return seen ? out : undefined
}

/**
 * Defensive parse of the response body. Returns `null` for anything that is
 * not a recognisable `{ answers: { <name>: {...} } }` document — a garbage or
 * HTML error page must degrade, not crash.
 */
export function parseSystemOneResponse(raw: unknown): LayaSystemOneResponse | null {
  if (!isRecord(raw)) return null
  const answersRaw = raw['answers']
  if (!isRecord(answersRaw)) return null
  const answers: Record<string, LayaAnswer> = {}
  for (const [name, answer] of Object.entries(answersRaw)) {
    if (isRecord(answer)) answers[name] = answer as LayaAnswer
  }
  const routingRaw = raw['routing']
  const routing: LayaRouting | undefined = isRecord(routingRaw)
    ? {
        model: typeof routingRaw['model'] === 'string' ? routingRaw['model'] : undefined,
        repo: typeof routingRaw['repo'] === 'string' ? routingRaw['repo'] : undefined,
        reason: typeof routingRaw['reason'] === 'string' ? routingRaw['reason'] : undefined,
      }
    : undefined
  const usageRaw = raw['usage']
  const usage: LayaSystemOneResponse['usage'] = isRecord(usageRaw)
    ? {
        input_tokens: typeof usageRaw['input_tokens'] === 'number' ? usageRaw['input_tokens'] : undefined,
        output_tokens: typeof usageRaw['output_tokens'] === 'number' ? usageRaw['output_tokens'] : undefined,
      }
    : undefined
  return {
    answers,
    ...(routing ? { routing } : {}),
    ...(typeof raw['model'] === 'string' ? { model: raw['model'] } : {}),
    ...(usage ? { usage } : {}),
  }
}

/**
 * The per-option distribution, tolerating the `distribution` alias.
 * For a `score` answer the keys are level indices ("0", "1", ...), which is
 * what `legend` maps to level descriptions.
 */
export function answerDistribution(answer: LayaAnswer | undefined): Record<string, number> | undefined {
  if (!answer) return undefined
  return toNumberRecord(answer.probabilities) ?? toNumberRecord(answer.distribution)
}

/**
 * The number to gate on, in priority order.
 *
 * `answer_confidence` first: it is the calibrated probability that the reported
 * answer is correct, and it is defined for all three question types, so a
 * single threshold means the same thing everywhere. `confidence` is the
 * fallback for older/patched servers. `max(distribution)` is the last resort,
 * and is the honest reading of "how peaked was the answer" when nothing better
 * was reported.
 */
export function answerConfidence(answer: LayaAnswer | undefined): number | null {
  if (!answer) return null
  const calibrated = toUnitInterval(answer.answer_confidence)
  if (calibrated !== null) return calibrated
  const concentration = toUnitInterval(answer.confidence)
  if (concentration !== null) return concentration
  const dist = answerDistribution(answer)
  if (!dist) return null
  let best = 0
  for (const v of Object.values(dist)) if (v > best) best = v
  return toUnitInterval(best)
}

/** The `choice` key of an answer, or `null` when it is absent or not a string. */
export function answerChoice(answer: LayaAnswer | undefined): string | null {
  if (!answer) return null
  const choice = answer.choice
  return typeof choice === 'string' && choice.length > 0 ? choice : null
}

// ----------------------------------------------------------------- client

export class LayaClient {
  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly apiKey: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(opts: LayaClientOptions = {}) {
    this.baseUrl = stripTrailingSlash(opts.baseUrl ?? DEFAULT_BASE_URL)
    this.model = opts.model ?? DEFAULT_MODEL
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.apiKey = opts.apiKey
    const impl = opts.fetchImpl ?? globalThis.fetch
    // Bound so `this` inside the Response/Request machinery is not relied upon.
    this.fetchImpl = impl.length > 0 ? impl.bind(globalThis) : impl
  }

  get endpoint(): string {
    return this.baseUrl
  }

  get checkpoint(): string {
    return this.model
  }

  /**
   * Cheap liveness probe. `true` only on a 2xx from `/health`; every failure
   * mode (DNS, refused connection, timeout, non-JSON body) is `false`.
   */
  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      return res.ok
    } catch {
      return false
    }
  }

  /** `null` on any failure, malformed body, or non-2xx status. */
  async systemOne(req: LayaSystemOneRequest): Promise<LayaSystemOneResponse | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ state: req.state, questions: req.questions, model: req.model ?? this.model }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!res.ok) return null
      return parseSystemOneResponse(await res.json())
    } catch {
      return null
    }
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Read the `LAYA_*` settings from an environment bag. `.env.example` is the
 * source of truth for which names exist; `LAYA_TIMEOUT_MS` and `LAYA_API_KEY`
 * are accepted as documented extras (the latter is a real Laya server var).
 */
export function readLayaEnv(env: Record<string, string | undefined> = process.env): {
  baseUrl: string
  enabled: boolean
  model: string
  timeoutMs: number
  apiKey: string | undefined
} {
  const timeoutRaw = env['LAYA_TIMEOUT_MS']
  const parsedTimeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : Number.NaN
  return {
    baseUrl: env['LAYA_BASE_URL']?.trim() || DEFAULT_BASE_URL,
    // Default ON when the variable is absent: a developer who ran
    // `scripts/laya.sh start` expects it to be used. `LAYA_ENABLED=0` (or
    // "false"/"off"/"no") is how you opt out.
    enabled: readFlag(env['LAYA_ENABLED'], true),
    model: env['LAYA_MODEL']?.trim() || DEFAULT_MODEL,
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS,
    apiKey: env['LAYA_API_KEY']?.trim() || undefined,
  }
}

export function readFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  const v = raw.trim().toLowerCase()
  if (v === '') return fallback
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}
