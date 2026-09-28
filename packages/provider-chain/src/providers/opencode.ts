/**
 * TIER 1 — opencode, either a local `opencode serve` HTTP gateway or the CLI.
 *
 * ── How the HTTP shape was determined ────────────────────────────────────────
 * `opencode serve` (v0.0.0-beta-19507) serves its own OpenAPI document at
 * `GET {base}/openapi.json`, which is authoritative for the binary that is
 * actually running. That document exposes a v2 surface:
 *
 *   GET  /openapi.json                                  -> operation ids + schemas
 *   GET  /api/health                                    -> { healthy, version, pid }
 *   POST /api/session                     { agent?, model? }  -> { data: { id } }
 *   POST /api/session/{id}/prompt         { text }            -> 200 (durably admitted)
 *   POST /api/session/{id}/wait                             -> 204 once the agent is idle
 *   GET  /api/session/{id}/message                         -> { data: SessionMessage[] }
 *   POST /api/generate                    { prompt, model? } -> { data: { text } }
 *
 * Two traps found while probing, both handled below:
 *   1. The published spec at https://opencode.ai/openapi.json is for a NEWER
 *      build and documents the prompt body as `{ prompt: { text } }`. The
 *      running beta takes a FLAT `{ text }`. We send flat and fall back to the
 *      nested shape on a 400.
 *   2. `opencode serve` prints a server password and then requires HTTP Basic
 *      auth as user `opencode`. Unauthenticated probes get 401 + an HTML page,
 *      which is why `isAvailable()` treats *any* HTTP status as "up".
 *
 * Order inside this tier: session API (can pin the `dsa-game-gen` agent) ->
 * stateless `/api/generate` (no agent, but the system prompt carries the rules)
 * -> `opencode run` subprocess.
 */

import { spawn } from 'node:child_process'
import { explainGameSpecError, parseGameSpecLoose, type GameSpec, type ProviderTier } from '@dsa/game-schema'
import { enforceAllowedMechanics } from '../guards.js'
import { buildPrompts, repairPrompt } from '../prompt.js'
import { SpecValidationError, type GenerateSpecInput, type SpecProvider } from '../types.js'

export interface OpencodeConfig {
  enabled: boolean
  baseUrl: string
  model: string
  /** The opencode agent that owns the generation rules. */
  agent: string
  /** Wall clock budget for one generation. */
  timeoutMs: number
  /** Subprocess budget. Kept separate because it pays CLI start-up. */
  subprocessTimeoutMs: number
  /**
   * Passed to `opencode run`. The background service is the CLI default, but it
   * can fail to bootstrap (it did here, after a 2 minute timeout), so we
   * default to a private per-call server instead.
   */
  standalone: boolean
  /** Basic-auth password printed by `opencode serve`. Empty means none. */
  password: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:4096'
const DEFAULT_MODEL = 'opencode/gemini-3.5-flash-lite'
const DEFAULT_AGENT = 'dsa-game-gen'

function flag(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase())
}

export function opencodeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OpencodeConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v === undefined ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    // Read every key from `env`, not from process.env directly, so a caller can
    // construct a config from an explicit map.
    enabled: flag('OPENCODE_ENABLED', true, env),
    baseUrl: (env.OPENCODE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: env.OPENCODE_MODEL?.trim() || DEFAULT_MODEL,
    agent: env.OPENCODE_AGENT?.trim() || DEFAULT_AGENT,
    // A GameSpec is a large JSON object and the whole system prompt (rules +
    // mechanic catalog + JSON schema) runs several thousand tokens, so a
    // free-tier model needs well over a minute. Measured end-to-end at ~103s
    // for binary-search, which the previous 45s default could not survive — the
    // request was aborted mid-generation and surfaced as "no assistant text",
    // which looks like a protocol bug rather than a timeout. Raise the default
    // and keep it overridable.
    timeoutMs: num(env.OPENCODE_TIMEOUT_MS, 180_000),
    subprocessTimeoutMs: num(env.OPENCODE_SUBPROCESS_TIMEOUT_MS, 180_000),
    standalone: flag('OPENCODE_STANDALONE', true, env),
    password: env.OPENCODE_PASSWORD?.trim() ?? '',
  }
}

/** `provider/model#variant` -> the ModelRef the v2 API wants. */
function modelRef(model: string): { providerID: string; id: string; variant?: string } {
  const [head, variant] = model.split('#')
  const slash = (head ?? model).indexOf('/')
  if (slash <= 0) return { providerID: 'opencode', id: model }
  return {
    providerID: (head ?? model).slice(0, slash),
    id: (head ?? model).slice(slash + 1),
    ...(variant ? { variant } : {}),
  }
}

function authHeaders(cfg: OpencodeConfig): Record<string, string> {
  if (!cfg.password) return {}
  const token = Buffer.from(`opencode:${cfg.password}`, 'utf8').toString('base64')
  return { authorization: `Basic ${token}` }
}

/**
 * Read a response body.
 *
 * `limit` is only safe for *error* detail, where a prefix is all we want. A
 * generated GameSpec runs to several KB, so success paths must use
 * `readBody(res, BODY_LIMIT)` and never the truncated default.
 */
async function readBody(res: Response, limit = 4000): Promise<string> {
  try {
    const text = await res.text()
    return text.length > limit ? text.slice(0, limit) : text
  } catch {
    return ''
  }
}

/** Generous ceiling for payload-bearing responses (a GameSpec is ~4-8 KB). */
const BODY_LIMIT = 1_000_000

interface Json {
  [key: string]: unknown
}

function asJson(text: string): Json | null {
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
  } catch {
    return null
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string'

/**
 * Dig assistant text out of whatever the transport handed back.
 *
 * `opencode run --format json` on the probed build emits JSONL (one event per
 * line, `{ type, timestamp, sessionID, part }`) rather than one envelope, and
 * the v2 message list uses `content: [{ type: 'text', text }]`. All of the
 * shapes below are cheap to try and none of them can throw.
 */
export function extractAssistantText(raw: unknown): string {
  const out: string[] = []
  const visit = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return
    if (isStr(v)) {
      // Only accept strings that plausibly contain JSON, so a stray title or an
      // error message is not mistaken for a payload.
      if (v.includes('{') || v.includes('```')) out.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1)
      return
    }
    if (typeof v !== 'object') return
    const rec = v as Json
    const type = rec['type']
    // JSONL text event: { type: 'text', part: { type: 'text', text } }.
    // Return here: the generic walk below would find the same `text` a second
    // time via the `part` key and emit it twice.
    if (type === 'text' && isObj(rec['part'])) {
      const t = rec['part']['text']
      if (typeof t === 'string') out.push(t)
      return
    }
    if (type === 'step-finish' || type === 'step_start' || type === 'step-start') return
    if (typeof rec['text'] === 'string') out.push(rec['text'])
    for (const key of ['data', 'message', 'messages', 'content', 'parts', 'part', 'result', 'output']) {
      if (key in rec) visit(rec[key], depth + 1)
    }
  }
  visit(raw, 0)
  return out.join('\n').trim()
}

/** Parse stdout that may be one JSON envelope or JSONL, then extract the text. */
export function textFromOpencodeOutput(stdout: string): string {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return ''
  const whole = asJson(trimmed)
  if (whole) {
    const direct = extractAssistantText(whole)
    if (direct.length > 0) return direct
  }
  // JSONL: parse each line and concatenate the text events in order.
  const lines = trimmed.split('\n')
  if (lines.length > 1) {
    const joined = lines
      .map((l) => asJson(l.trim()))
      .filter((j): j is Json => j !== null)
      .map((j) => extractAssistantText(j))
      .filter((s) => s.length > 0)
      .join('\n')
    if (joined.length > 0) return joined.trim()
  }
  return trimmed
}

export class OpencodeProvider implements SpecProvider {
  readonly tier: ProviderTier = 'opencode'
  private readonly cfg: OpencodeConfig
  /** Cached `GET /openapi.json` + `GET /api/agent` discovery. */
  private routes: Discovery | null = null

  constructor(cfg: Partial<OpencodeConfig> = {}) {
    this.cfg = { ...opencodeConfigFromEnv(), ...cfg }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.cfg.enabled) return false
    // Any HTTP status counts: a 401 still proves a server is listening, and the
    // subprocess path may be able to authenticate where we cannot.
    if (await this.serverResponds()) return true
    return this.binaryOnPath()
  }

  private async serverResponds(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/api/health`, {
        headers: authHeaders(this.cfg),
        signal: AbortSignal.timeout(1200),
      })
      // Drain so the socket is released.
      await res.text().catch(() => '')
      return res.status > 0
    } catch {
      return false
    }
  }

  /**
   * Is an `opencode` executable actually spawnable?
   *
   * This has to be a real check rather than a `try { spawn }`: spawn reports a
   * missing binary through an async 'error' event, so a synchronous try/catch
   * would answer `true` on every machine and the tier would advertise itself
   * available when it is not.
   */
  private binaryOnPath(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(ok)
      }
      // A PATH scan should be instant; 1.5 s only covers a cold shell.
      const timer = setTimeout(() => finish(false), 1500)
      try {
        const child =
          process.platform === 'win32'
            ? spawn(process.env['COMSPEC'] ?? 'cmd.exe', ['/c', 'where', 'opencode'], { stdio: 'ignore' })
            : spawn('/bin/sh', ['-c', 'command -v opencode'], { stdio: 'ignore' })
        child.on('error', () => finish(false))
        child.on('close', (code) => finish(code === 0))
      } catch {
        finish(false)
      }
    })
  }

  /**
   * Read the server's own OpenAPI document plus the agent registry.
   *
   * Best-effort: on 401 / no doc we optimistically assume both routes, and an
   * unknown `agent` is not fatal — see `agentAvailable`.
   */
  private async discoverRoutes(): Promise<Discovery> {
    if (this.routes) return this.routes
    const fallback: Discovery = { sessionPrompt: true, generate: true, agentAvailable: false }
    let doc: Json | null = null
    try {
      const res = await fetch(`${this.cfg.baseUrl}/openapi.json`, {
        headers: { ...authHeaders(this.cfg), accept: 'application/json' },
        signal: AbortSignal.timeout(2500),
      })
      doc = asJson(await readBody(res, BODY_LIMIT))
    } catch {
      doc = null
    }
    const paths = isObj(doc) ? doc['paths'] : undefined
    const rec = isObj(paths) ? paths : undefined
    this.routes = rec
      ? {
          sessionPrompt: typeof rec['/api/session/{sessionID}/prompt'] === 'object',
          generate: typeof rec['/api/generate'] === 'object',
          agentAvailable: false,
        }
      : fallback

    this.routes.agentAvailable = await this.agentIsRegistered()
    return this.routes
  }

  /**
   * Is the configured agent actually loaded by the server?
   *
   * This matters more than it looks. `POST /api/session` happily accepts an
   * unknown agent id, and so does `POST .../prompt` — but the agent loop then
   * never runs and the transcript comes back empty, with a 204 from `/wait`
   * that looks like success. (Observed on beta-19507 with an agent markdown
   * file in a directory opencode does not scan.) So we check the registry
   * first, and fall back to the server default agent: the system prompt
   * already carries every hard rule, so the agent is an optimisation, not a
   * requirement.
   */
  private async agentIsRegistered(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/api/agent`, {
        headers: { ...authHeaders(this.cfg), accept: 'application/json' },
        signal: AbortSignal.timeout(2500),
      })
      const body = asJson(await readBody(res, BODY_LIMIT))
      const list = isObj(body) ? body['data'] : body
      if (!Array.isArray(list)) return false
      return list.some((a) => isObj(a) && a['id'] === this.cfg.agent)
    } catch {
      return false
    }
  }

  async generate(input: GenerateSpecInput): Promise<GameSpec> {
    if (!this.cfg.enabled) throw new Error('opencode tier disabled by OPENCODE_ENABLED')
    const { system, user } = buildPrompts(input)
    const prompt = `${system}\n\n---\n\n${user}`
    const errors: string[] = []

    const routes = await this.discoverRoutes()

    if (routes.sessionPrompt) {
      try {
        const text = await this.viaSessionApi(prompt, routes.agentAvailable)
        return this.finish(text, input)
      } catch (e) {
        errors.push(`session-api: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (routes.generate) {
      try {
        const text = await this.viaStatelessApi(prompt)
        return this.finish(text, input)
      } catch (e) {
        errors.push(`api-generate: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    try {
      const text = await this.viaSubprocess(prompt)
      return this.finish(text, input)
    } catch (e) {
      errors.push(`subprocess: ${e instanceof Error ? e.message : String(e)}`)
    }
    throw new Error(`opencode: all transports failed -> ${errors.join(' | ')}`)
  }

  async repair(input: GenerateSpecInput, issues: string): Promise<GameSpec> {
    const { system, user } = buildPrompts(input)
    const prompt = `${system}\n\n---\n\n${user}\n\n---\n\n${repairPrompt(issues)}`
    const routes = await this.discoverRoutes()
    const attempts: (() => Promise<string>)[] = []
    if (routes.sessionPrompt) attempts.push(() => this.viaSessionApi(prompt, routes.agentAvailable))
    if (routes.generate) attempts.push(() => this.viaStatelessApi(prompt))
    attempts.push(() => this.viaSubprocess(prompt))

    const errors: string[] = []
    for (const attempt of attempts) {
      try {
        return this.finish(await attempt(), input)
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    throw new SpecValidationError(`repair failed (${errors.join(' | ')}); original issues: ${issues}`)
  }

  /**
   * Server-authoritative identity.
   *
   * The model is only ever authoritative for theme text. Letting it choose its
   * own `problemId`/`seed` would let a hallucinated id produce a spec that
   * validates but plays the wrong puzzle, so all three are stamped from the
   * request after parsing.
   */
  private finish(rawText: string, input: GenerateSpecInput): GameSpec {
    const spec = parseGameSpecLoose(rawText)
    if (!spec) throw new SpecValidationError(explainGameSpecError(rawText) || 'response was not a GameSpec')

    // The per-problem mechanic guard: the system prompt *tells* the model which
    // mechanics are allowed, but opencode's transports take no per-request
    // schema, so this is the only place the invariant can be enforced.
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

  // ------------------------------------------------------------ transports

  private async viaSessionApi(prompt: string, agentAvailable: boolean): Promise<string> {
    const cfg = this.cfg
    const headers = { ...authHeaders(cfg), 'content-type': 'application/json' }
    const timeout = AbortSignal.timeout(cfg.timeoutMs)

    // Omit `agent` entirely when it is not registered: passing an unknown id
    // makes the loop silently never start.
    const createBody: Json = { model: modelRef(cfg.model) }
    if (agentAvailable) createBody['agent'] = cfg.agent

    const createRes = await fetch(`${cfg.baseUrl}/api/session`, {
      method: 'POST',
      headers,
      signal: timeout,
      body: JSON.stringify(createBody),
    })
    if (!createRes.ok) throw new Error(`POST /api/session -> ${createRes.status} ${await readBody(createRes)}`)
    const created = asJson(await readBody(createRes, BODY_LIMIT))
    const sessionId = (created?.['data'] as Json | undefined)?.['id']
    if (typeof sessionId !== 'string') throw new Error('POST /api/session returned no data.id')

    // The running beta wants a flat body; the published spec wants it nested.
    const sent = await this.postPrompt(sessionId, headers, timeout, { text: prompt })
    if (!sent.ok) {
      const nested = await this.postPrompt(sessionId, headers, timeout, { prompt: { text: prompt } })
      if (!nested.ok) {
        throw new Error(`POST /api/session/${sessionId}/prompt -> ${sent.status} ${await readBody(sent)}`)
      }
    }

    // Long-poll until the agent loop is idle, then read the transcript.
    const wait = await fetch(`${cfg.baseUrl}/api/session/${sessionId}/wait`, {
      method: 'POST',
      headers,
      signal: timeout,
    })
    if (wait.status !== 204 && !wait.ok) {
      throw new Error(`POST wait -> ${wait.status} ${await readBody(wait)}`)
    }
    await wait.text().catch(() => '')

    const msgs = await fetch(`${cfg.baseUrl}/api/session/${sessionId}/message`, {
      headers: { ...authHeaders(cfg), accept: 'application/json' },
      signal: timeout,
    })
    if (!msgs.ok) throw new Error(`GET message -> ${msgs.status} ${await readBody(msgs)}`)
    const raw = await readBody(msgs, BODY_LIMIT)
    const body = asJson(raw)
    const list = isObj(body) ? body['data'] : undefined
    if (!Array.isArray(list)) {
      throw new Error(`GET message returned no data array: ${raw.slice(0, 300)}`)
    }

    // Newest first: take the last assistant message with any text content.
    const assistants = list.filter((m) => isObj(m) && m['type'] === 'assistant')
    for (const m of assistants) {
      const text = extractAssistantText(m)
      if (text.length > 0) return text
    }
    // An empty transcript with a 204 from /wait is the signature of an agent
    // loop that never started. Report the server's own reason if it gave one.
    const reason = explainTranscript(list)
    throw new Error(
      `no assistant text in transcript (${list.length} messages)` +
        (reason ? `: ${reason}` : '; the agent loop produced nothing — check OPENCODE_MODEL and OPENCODE_AGENT'),
    )
  }

  private async postPrompt(
    sessionId: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    body: Json,
  ): Promise<Response> {
    return fetch(`${this.cfg.baseUrl}/api/session/${sessionId}/prompt`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify(body),
    })
  }

  private async viaStatelessApi(prompt: string): Promise<string> {
    const cfg = this.cfg
    const res = await fetch(`${cfg.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { ...authHeaders(cfg), 'content-type': 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({ prompt, model: modelRef(cfg.model) }),
    })
    if (!res.ok) throw new Error(`POST /api/generate -> ${res.status} ${await readBody(res)}`)
    const body = asJson(await readBody(res, BODY_LIMIT))
    const text = (body?.['data'] as Json | undefined)?.['text']
    if (typeof text !== 'string') throw new Error('POST /api/generate returned no data.text')
    return text
  }

  private viaSubprocess(prompt: string): Promise<string> {
    const cfg = this.cfg
    const args = ['run']
    if (cfg.standalone) args.push('--standalone')
    args.push('--format', 'json', '--model', cfg.model, '--agent', cfg.agent, prompt)
    return new Promise<string>((resolve, reject) => {
      const child = spawn('opencode', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false
      const done = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        done(() => reject(new Error(`opencode run timed out after ${cfg.subprocessTimeoutMs}ms`)))
      }, cfg.subprocessTimeoutMs)

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8')
        // Hard cap so a chatty stream cannot exhaust memory.
        if (stdout.length > 512_000) stdout = stdout.slice(-256_000)
      })
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8')
        if (stderr.length > 64_000) stderr = stderr.slice(-8_000)
      })
      child.on('error', (e) => done(() => reject(new Error(`spawn opencode: ${e.message}`))))
      child.on('close', (code) => {
        const text = textFromOpencodeOutput(stdout)
        if (text.length === 0) {
          done(() => reject(new Error(`opencode run produced no text (exit ${code ?? 'null'}) ${stderr.slice(0, 300)}`)))
          return
        }
        done(() => resolve(text))
      })
    })
  }
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Route + capability discovery result for one opencode server. */
interface Discovery {
  sessionPrompt: boolean
  generate: boolean
  /** True when `OPENCODE_AGENT` is present in `GET /api/agent`. */
  agentAvailable: boolean
}

/**
 * Pull a human-readable failure out of a message list.
 *
 * The v2 message union carries error and abort variants alongside assistant
 * text, so when there is no assistant text the reason is nearly always in one
 * of them — and "no text" on its own is useless to debug.
 */
function explainTranscript(list: readonly unknown[]): string {
  const parts: string[] = []
  for (const m of list) {
    if (!isObj(m)) continue
    for (const key of ['error', 'rawFinish', 'finish', 'type']) {
      const v = m[key]
      if (typeof v === 'string' && key !== 'finish' && key !== 'type') parts.push(`${key}: ${v.slice(0, 200)}`)
    }
    const message = m['message']
    if (isObj(message) && typeof message['error'] === 'string') parts.push(message['error'].slice(0, 200))
  }
  return parts.join('; ').slice(0, 400)
}
