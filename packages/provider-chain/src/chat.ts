/**
 * The chat transport: plain text in, plain text out.
 *
 * WHY A SEPARATE INTERFACE: the spec tiers need *structured* output (a strict
 * `GameSpec` validated by a zod schema), so they are expressed as `SpecProvider`
 * and their JSON is machine-checked. The coach is the opposite case — its answer
 * is prose, and a prose reply cannot be schema-validated into being helpful. It
 * is guarded by a *validator over the text* instead (see
 * `services/api/src/coach/guardrails.ts`), which is why it needs a different
 * shape: no `GenerateSpecInput`, no `repair()`, no tier ladder, just a message
 * array and a string back.
 *
 * Keeping it this small is deliberate. `ChatTransport` is four members, so when
 * the `opencode-go` gateway lands, swapping the default is a one-line
 * constructor change in `coach/service.ts` and nothing else moves. Do not grow
 * it into a second `SpecProvider`; there is exactly one caller.
 *
 * Token counts are NOT reported by the model. Providers lie about them, they
 * count differently per vendor, and several do not return the field at all. So
 * `ChatReply` carries an *approximation computed locally* by the same function
 * the request-side budget uses, which keeps the accounting self-consistent.
 */

import { opencodeGoConfigFromEnv, pickPreferredModel } from './providers/opencode-go.js'
import { contentFromChatCompletion } from './providers/openrouter.js'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  readonly role: ChatRole
  readonly content: string
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[]
  /** Upper bound on the reply. Callers set this from their own budget. */
  readonly maxTokens?: number
  /** Left to the transport default unless a caller really needs a knob. */
  readonly temperature?: number
  /** Per-call abort, so a hung provider cannot hold an HTTP request open. */
  readonly signal?: AbortSignal
  readonly sessionId?: string
}

export interface ChatReply {
  readonly text: string
  /** The model that actually answered, for the trace line. */
  readonly model: string
  /** Locally estimated. Never taken from the provider's own `usage` block. */
  readonly approxTokens: number
}

export interface ChatTransport {
  /** Stable label for logs: `'openrouter'`, `'opencode-go'`, ... */
  readonly id: string
  readonly model: string
  /** Cheap: must not perform a request, only report whether one is possible. */
  isAvailable(): Promise<boolean>
  chat(request: ChatRequest): Promise<ChatReply>
  stream?(request: ChatRequest): AsyncIterable<string>
}

export interface ChatConfig {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
  temperature: number
  maxTokens: number
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'

/**
 * ~4 characters per token.
 *
 * This is the industry floor for English prose, and it is the number the whole
 * budget is built on, so it is stated in one place rather than being re-derived
 * per call site. It under-counts code, which is dense, so callers keep explicit
 * headroom (`COACH_BUDGET.replyReserveTokens`) rather than trusting the ratio.
 */
export function approxChatTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * The first configured chat transport, preferring `opencode-go`.
 *
 * WHY A FACTORY RATHER THAN A CHAIN: the spec tiers are tried in order because a
 * bad `GameSpec` is a correctness problem with a safe fallback at the bottom. A
 * coach reply has no such property — there is nothing below it except the
 * deterministic path — so the coach picks ONE transport and the deterministic
 * fallback is the safety net. Retrying a coach question across tiers would double
 * the learner's wait for no reliability gain.
 *
 * `isAvailable()` is a pure environment check on both transports, so choosing costs
 * no network round trip and no money.
 */
export async function defaultChatTransport(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChatTransport | null> {
  const preferred = new OpencodeGoChatTransport()
  if (await preferred.isAvailable()) return preferred
  const fallback = new OpenRouterChatTransport()
  return (await fallback.isAvailable()) ? fallback : null
}

export function chatConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ChatConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v === undefined ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() ?? '',
    model: env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: (env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs: num(env.OPENROUTER_TIMEOUT_MS, 40_000),
    temperature: num(env.OPENROUTER_TEMPERATURE, 0.85),
    maxTokens: num(env.OPENROUTER_MAX_TOKENS, 2500),
  }
}

/**
 * OpenRouter's OpenAI-compatible `/chat/completions`, no `response_format`.
 *
 * `response_format` is deliberately absent: the coach must be free to write
 * conversational prose, and pinning it to a JSON schema would make it sound
 * like a form. Correctness for the coach is enforced downstream by the
 * guardrail validator, which is the only place that can judge the *content*.
 */
export class OpenRouterChatTransport implements ChatTransport {
  readonly id = 'openrouter'
  readonly model: string
  private readonly cfg: ChatConfig

  constructor(cfg: Partial<ChatConfig> = {}) {
    this.cfg = { ...chatConfigFromEnv(), ...cfg }
    this.model = this.cfg.model
  }

  async isAvailable(): Promise<boolean> {
    return this.cfg.apiKey.length > 0
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const signal = request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(this.cfg.timeoutMs)]) : AbortSignal.timeout(this.cfg.timeoutMs)
    const model = this.cfg.model
    const headers: Record<string,string> = { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' }
    if (request.sessionId && 'requestHeaders' in this) headers['x-opencode-session'] = request.sessionId
    const response = await fetch(`${this.cfg.baseUrl}/chat/completions`, { method: 'POST', headers, signal, body: JSON.stringify({ model, stream: true, messages: request.messages, max_tokens: request.maxTokens ?? this.cfg.maxTokens, temperature: request.temperature ?? this.cfg.temperature }) })
    if (!response.ok || !response.body) throw new Error(`Chat provider returned ${response.status}`)
    yield* readChatStream(response.body)
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    if (this.cfg.apiKey.length === 0) {
      throw new Error('OPENROUTER_API_KEY is empty; the coach transport cannot run')
    }
    if (request.messages.length === 0) {
      throw new Error('chat() needs at least one message')
    }

    const timeout = AbortSignal.timeout(this.cfg.timeoutMs)
    // The caller's signal and our timeout are merged rather than raced: a client
    // that hangs up must cancel the provider request too, and `fetch` only
    // accepts one signal, so the node event loop does the plumbing.
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout

    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://github.com/dsa-game',
        'x-title': 'dsa-game coach',
      },
      signal,
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: request.temperature ?? this.cfg.temperature,
        max_tokens: request.maxTokens ?? this.cfg.maxTokens,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`openrouter ${res.status}: ${detail.slice(0, 400)}`)
    }

    let body: unknown
    try {
      body = await res.json()
    } catch (e) {
      throw new Error(`openrouter response was not JSON: ${e instanceof Error ? e.message : String(e)}`)
    }

    const text = contentFromChatCompletion(body).trim()
    if (text.length === 0) throw new Error('openrouter returned no content')

    return { text, model: this.cfg.model, approxTokens: approxChatTokens(text) }
  }
}

// ---------------------------------------------------------------- opencode-go

export interface OpencodeGoChatConfig {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
  temperature: number
  maxTokens: number
  enabled: boolean
  /** Client identity; opencode-go rejects requests without one. */
  userAgent: string
  /** Pinned session id. Empty = one id per chat call. */
  sessionId: string
}

const DEFAULT_OPENCODE_GO_MODEL = 'space-bunny-free'

/** Matches the spec tier's default so both callers identify as one client. */
const OPENCODE_GO_USER_AGENT = 'dsa-game/0.1.0'

/**
 * The spec tier's config, narrowed to what a chat call needs.
 *
 * Reusing the reader is the point: two independent env parsers for one endpoint is
 * how the coach ends up talking to a different host than the generator, and how
 * `OPENCODE_GO_ENABLED=0` ends up silencing one of them and not the other.
 */
function chatConfigFromOpencodeGo(env: NodeJS.ProcessEnv = process.env): OpencodeGoChatConfig {
  const shared = opencodeGoConfigFromEnv(env)
  return {
    enabled: shared.enabled,
    apiKey: shared.apiKey,
    baseUrl: shared.baseUrl,
    model: shared.model,
    timeoutMs: shared.timeoutMs,
    temperature: shared.temperature,
    maxTokens: shared.maxTokens,
    userAgent: shared.userAgent,
    sessionId: shared.sessionId,
  }
}

/**
 * `opencode-go` as a chat transport.
 *
 * `OpencodeGoProvider` is a `SpecProvider`: it is shaped around returning a
 * validated `GameSpec`, and its `ask` is private because its input is
 * `GenerateSpecInput`. The coach needs neither, so this is a small separate adapter
 * over the SAME endpoint rather than a widening of that class — forcing the coach
 * through a `SpecProvider` would mean faking a spec request and then throwing the
 * structured result away, which is a worse coupling than twenty duplicated lines.
 *
 * It reuses the provider's own config reader so the two tiers cannot drift apart on
 * the base URL or the key, and its own model preference so the coach picks the same
 * cheap model the spec chain would. A configured model id always wins; otherwise
 * the live list is consulted once per instance.
 */
export class OpencodeGoChatTransport implements ChatTransport {
  readonly id = 'opencode-go'
  readonly model: string
  private readonly cfg: OpencodeGoChatConfig
  private modelPromise: Promise<string> | null = null
  private callCounter = 0
  private readonly instanceId = Math.random().toString(36).slice(2, 10)

  constructor(cfg: Partial<OpencodeGoChatConfig> = {}) {
    this.cfg = { ...chatConfigFromOpencodeGo(), ...cfg }
    this.model = this.cfg.model
  }

  /**
   * The two headers opencode-go requires, and the reason this transport was
   * 400ing on every call until they were added.
   *
   * The endpoint answers
   *   400 MissingSessionID: "Request is missing x-opencode-session and cannot
   *   be routed efficiently"
   * unless the request carries a client-specific `user-agent` AND a stable
   * `x-opencode-session`. `OpencodeGoProvider.generate` has always sent both;
   * this chat adapter did not, so every coach and resume-extraction call
   * against the default tier failed with an error that named a routing
   * problem rather than the missing header.
   *
   * One chat call is one conversation, so the id is unique per call — reusing
   * one would attribute unrelated traffic to a single conversation and defeat
   * the prompt caching the header exists for.
   */
  private requestHeaders(): Record<string, string> {
    this.callCounter += 1
    return {
      authorization: `Bearer ${this.cfg.apiKey}`,
      'content-type': 'application/json',
      'user-agent': OPENCODE_GO_USER_AGENT,
      'x-opencode-session': this.cfg.sessionId.length > 0
        ? this.cfg.sessionId
        : `chat-${this.instanceId}-${this.callCounter}`,
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.cfg.enabled && this.cfg.apiKey.length > 0
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const signal = request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(this.cfg.timeoutMs)]) : AbortSignal.timeout(this.cfg.timeoutMs)
    const model = await this.resolveModel()
    const headers = this.requestHeaders()
    if (request.sessionId && 'requestHeaders' in this) headers['x-opencode-session'] = request.sessionId
    const response = await fetch(`${this.cfg.baseUrl}/chat/completions`, { method: 'POST', headers, signal, body: JSON.stringify({ model, stream: true, messages: request.messages, max_tokens: request.maxTokens ?? this.cfg.maxTokens, temperature: request.temperature ?? this.cfg.temperature }) })
    if (!response.ok || !response.body) throw new Error(`Chat provider returned ${response.status}`)
    yield* readChatStream(response.body)
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    if (!this.cfg.enabled) throw new Error('opencode-go chat is disabled by OPENCODE_GO_ENABLED')
    if (this.cfg.apiKey.length === 0) throw new Error('opencode-go chat has no API key')
    if (request.messages.length === 0) throw new Error('chat() needs at least one message')

    const model = await this.resolveModel()
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs)
    // The caller's signal and our timeout are merged rather than raced: a client
    // that hangs up must cancel the provider request too, and `fetch` accepts only
    // one signal.
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout

    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.requestHeaders(),
      signal,
      body: JSON.stringify({
        model,
        temperature: request.temperature ?? this.cfg.temperature,
        max_tokens: request.maxTokens ?? this.cfg.maxTokens,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // A bare 400 here is nearly always the routing headers, not the payload,
      // so the message says so — the upstream error names a session header the
      // caller has no way to know it omitted.
      if (res.status === 400 && detail.includes('x-opencode-session')) {
        throw new Error('opencode-go 400: request was rejected for routing (client user-agent + x-opencode-session header)')
      }
      throw new Error(`opencode-go ${res.status}: ${detail.slice(0, 400)}`)
    }

    let body: unknown
    try {
      body = await res.json()
    } catch (e) {
      throw new Error(`opencode-go response was not JSON: ${e instanceof Error ? e.message : String(e)}`)
    }

    const text = contentFromChatCompletion(body).trim()
    if (text.length === 0) throw new Error('opencode-go returned no content')

    return { text, model, approxTokens: approxChatTokens(text) }
  }

  private resolveModel(): Promise<string> {
    if (this.cfg.model.length > 0) return Promise.resolve(this.cfg.model)
    // Cached as a PROMISE, not a value, so a failed lookup is not retried on every
    // coach call — that would be a round trip the learner is sitting through.
    if (this.modelPromise === null) this.modelPromise = this.discoverModel()
    return this.modelPromise
  }

  private async discoverModel(): Promise<string> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/models`, {
        signal: AbortSignal.timeout(Math.min(this.cfg.timeoutMs, 4000)),
      })
      if (!res.ok) return DEFAULT_OPENCODE_GO_MODEL
      const body: unknown = JSON.parse(await res.text())
      const data = isChatObj(body) ? body['data'] : undefined
      if (!Array.isArray(data)) return DEFAULT_OPENCODE_GO_MODEL
      const ids: string[] = []
      for (const entry of data) {
        if (isChatObj(entry) && typeof entry['id'] === 'string') ids.push(entry['id'])
      }
      return pickPreferredModel(ids) ?? DEFAULT_OPENCODE_GO_MODEL
    } catch {
      // Best effort, for the same reason the spec tier does it: an unreachable
      // catalogue must not block the question, and the fallback is the free model,
      // so the worst case is a 404 rather than a spend.
      return DEFAULT_OPENCODE_GO_MODEL
    }
  }
}

interface ChatJson {
  [key: string]: unknown
}

const isChatObj = (v: unknown): v is ChatJson => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Incremental SSE parser: UTF-8 and frames may be split across network chunks. */
export async function* readChatStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let doneMarker = false
  try {
    while (true) {
      const {value,done}=await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value,{stream:true})
      buffer = buffer.replace(/\r\n/g,'\n')
      let boundary: number
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2)
        const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')
        if(!data)continue
        if(data==='[DONE]'){doneMarker=true;return}
        const parsed=JSON.parse(data)
        if(parsed.error)throw new Error('Chat provider stream failed')
        const delta=parsed.choices?.[0]?.delta?.content
        if(typeof delta==='string' && delta)yield delta
      }
      if(done)break
    }
    if(!doneMarker)throw new Error('Chat provider stream ended before completion')
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock() }
}
