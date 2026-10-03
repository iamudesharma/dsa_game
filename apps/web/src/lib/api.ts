/**
 * Thin, typed client for the dsa-game HTTP API.
 *
 * Everything the UI knows about the wire format comes from `@dsa/game-schema`.
 * This module adds three things the schema deliberately does not have:
 *   1. one place that turns any transport failure into a single `DsaApiError`
 *      shape, so no screen ever has to write its own try/catch taxonomy,
 *   2. a request timeout + abort wiring, because a tier-1 LLM generation can
 *      take many seconds and a hung socket must not wedge the UI,
 *   3. cheap runtime guards on the responses we render from, so a server that
 *      drifts from the contract produces a "schema violation" panel instead of
 *      a `TypeError: cannot read property of undefined` inside a component.
 */

import type {
  Action,
  ActionResponse,
  CatalogueResponse,
  CoachRequest,
  CoachResponse,
  DebriefResponse,
  DecideRequest,
  DecideResponse,
  GenerateRequest,
  Difficulty,
  TurnPrompt,
  GenerateResponse,
  GameSpec,
  GameState,
  HealthResponse,
  HintRequest,
  HintResponse,
  ProviderTier,
} from '@dsa/game-schema'
import { API_ERRORS } from '@dsa/game-schema'

const RAW_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8787'
/** Trailing slashes would produce `//api/...` and some servers 404 on that. */
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '')

const TIMEOUT_MS = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? '')
  return Number.isFinite(parsed) && parsed > 1000 ? parsed : 30_000
})()

/**
 * Deadline for `/api/generate`, the one call that can reach an LLM.
 *
 * This MUST exceed the server's worst case, or the client aborts while the
 * server is still working. The server allows 200s per provider tier, and the
 * first tier that actually answers (OpenCode Go, a real model writing a few
 * thousand tokens of JSON) was measured at ~126s — so the previous 90s here
 * guaranteed a "took too long" error on exactly the tier that writes the best
 * games. 240s leaves headroom over the server budget without letting a genuine
 * hang run forever.
 *
 * The server falls back tier by tier, so a slow tier 1 still ends in a playable
 * game; this deadline only decides whether we wait for it.
 */
const GENERATE_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_GENERATE_TIMEOUT_MS ?? '')
  return Number.isFinite(parsed) && parsed > 1000 ? parsed : 240_000
})()

export type DsaApiErrorKind = 'network' | 'timeout' | 'http' | 'contract' | 'unknown'

// ------------------------------------------------------------------- auth
// The session token is the bearer fallback for localhost-vs-127.0.0.1 (see
// services/api/src/auth/middleware.ts): cookies cannot cross those hosts, so
// the client keeps the token the server returned once and sends it back.
// The cookie still rides along via `credentials: 'include'` for same-host runs.

const TOKEN_KEY = 'dsa-auth-token'

export function getAuthToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Private mode: the in-memory session still works for this tab.
  }
}

export function clearAuthToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

function authHeaders(): Record<string, string> {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY)
    return token ? { authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

/**
 * The single error type every call rejects with. `retryable` is what the UI
 * keys off to decide between "Try again" and "Go back home".
 */
export class DsaApiError extends Error {
  readonly kind: DsaApiErrorKind
  /** Server error code (`BAD_REQUEST`, `UNKNOWN_GAME`, ...) when we got one. */
  readonly code: string
  readonly status: number
  readonly details: unknown
  readonly retryable: boolean

  constructor(init: {
    kind: DsaApiErrorKind
    code: string
    message: string
    status?: number
    details?: unknown
    retryable?: boolean
  }) {
    super(init.message)
    this.name = 'DsaApiError'
    this.kind = init.kind
    this.code = init.code
    this.status = init.status ?? 0
    this.details = init.details
    this.retryable = init.retryable ?? (init.kind === 'network' || init.kind === 'timeout' || (init.status ?? 0) >= 500)
  }

  /** Short, non-technical sentence for the error panel heading. */
  get title(): string {
    switch (this.kind) {
      case 'network':
        return 'Cannot reach the game server'
      case 'timeout':
        return 'The game server took too long'
      case 'contract':
        return 'The server sent something unexpected'
      case 'unknown':
        return 'Something went wrong'
      case 'http':
      default:
        return this.status === 404 ? 'Not found' : 'The game server rejected that'
    }
  }
}

export function isDsaApiError(value: unknown): value is DsaApiError {
  return value instanceof DsaApiError
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Pulls `{ error: { code, message } }` out of a failed response, if present. */
function readErrorBody(body: unknown): { code: string; message: string; details: unknown } | null {
  if (!isRecord(body)) return null
  const err = body.error
  if (!isRecord(err)) return null
  const code = typeof err.code === 'string' ? err.code : 'INTERNAL'
  const message = typeof err.message === 'string' ? err.message : 'The server returned an error.'
  return { code, message, details: err.details }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** Overrides the default timeout (generation gets longer). */
  timeoutMs?: number
  /** Human label used in the timeout message. */
  label?: string
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, label = 'request' } = options
  const url = `${API_BASE_URL}${path}`
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS

  // Respect an upstream abort (component unmount, superseded action) while
  // still enforcing our own deadline.
  const onUpstreamAbort = (): void => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onUpstreamAbort, { once: true })
  }

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('timeout'))
  }, timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...authHeaders(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // The API is stateful (it owns the game); never let a cached response be
      // treated as truth. `include` carries the httpOnly session cookie on
      // same-host runs; the bearer header covers cross-host loopback.
      cache: 'no-store',
      credentials: 'include',
    })
  } catch (cause) {
    if (timedOut) {
      throw new DsaApiError({
        kind: 'timeout',
        code: 'TIMEOUT',
        message: `The ${label} did not finish within ${Math.round(timeoutMs / 1000)}s.`,
        retryable: true,
      })
    }
    if (signal?.aborted) throw cause
    throw new DsaApiError({
      kind: 'network',
      code: 'NETWORK_ERROR',
      message: `Could not reach ${API_BASE_URL}. Is the API running?`,
      details: cause,
      retryable: true,
    })
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onUpstreamAbort)
  }

  const rawText = await response.text()
  let parsed: unknown = null
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText)
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const shaped = readErrorBody(parsed)
    throw new DsaApiError({
      kind: 'http',
      code: shaped?.code ?? `HTTP_${response.status}`,
      message: shaped?.message ?? `${method} ${path} failed with ${response.status}.`,
      status: response.status,
      // A problem that is listed but not implemented is a permanent fact about
      // the catalogue, not a transient fault. It must NOT be retryable: the
      // generic rule is `status >= 500`, and this used to come back as a 500,
      // so the debrief screen offered "Try again" for a request that could never
      // succeed however many times it was sent.
      retryable: response.status < 500 && shaped?.code !== API_ERRORS.problemNotPlayable,
      details: shaped?.details ?? (parsed ?? rawText.slice(0, 400)),
    })
  }

  if (parsed === null) {
    throw new DsaApiError({
      kind: 'contract',
      code: 'EMPTY_BODY',
      message: 'The server returned a response that was not JSON.',
      status: response.status,
      retryable: true,
    })
  }

  return parsed as T
}

// --------------------------------------------------------------- guards

function contractError(what: string, details: unknown): DsaApiError {
  return new DsaApiError({
    kind: 'contract',
    code: 'SCHEMA_VIOLATION',
    message: `The server's ${what} does not match the shared contract.`,
    details,
    retryable: false,
  })
}

function assertObject(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw contractError(what, value)
  return value
}

/** Structural guard for the parts of `GameState` every screen actually reads. */
export function looksLikeGameState(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.problemId === 'string' &&
    typeof value.seed === 'number' &&
    isRecord(value.objects) &&
    isRecord(value.slots) &&
    isRecord(value.containers) &&
    Array.isArray(value.links) &&
    Array.isArray(value.selection) &&
    isRecord(value.cursor) &&
    isRecord(value.variables) &&
    isRecord(value.progress) &&
    typeof value.phase === 'string' &&
    Array.isArray(value.trace)
  )
}

function assertGameState(value: unknown, what: string): void {
  if (!looksLikeGameState(value)) throw contractError(what, value)
}

// -------------------------------------------------------------- endpoints

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const body = assertObject(await request<unknown>('/api/health', { signal, label: 'health check' }), 'health response')
  if (typeof body.ok !== 'boolean' || !Array.isArray(body.tiers)) {
    throw contractError('health response', body)
  }
  return body as unknown as HealthResponse
}

export async function getCatalogue(signal?: AbortSignal): Promise<CatalogueResponse> {
  const body = assertObject(await request<unknown>('/api/catalogue', { signal, label: 'catalogue' }), 'catalogue response')
  if (!Array.isArray(body.topics)) throw contractError('catalogue response', body)
  return body as unknown as CatalogueResponse
}

export async function postGenerate(
  body: GenerateRequest,
  signal?: AbortSignal,
): Promise<GenerateResponse> {
  // Generation can hit an LLM; give it well over the default deadline.
  const res = assertObject(
    await request<unknown>('/api/generate', {
      method: 'POST',
      body,
      signal,
      label: 'generation',
      timeoutMs: GENERATE_TIMEOUT_MS,
    }),
    'generate response',
  )
  assertGameState(res.state, 'generate response state')
  if (typeof res.gameId !== 'string' || typeof res.problemId !== 'string') {
    throw contractError('generate response', res)
  }
  return res as unknown as GenerateResponse
}

export async function postAction(
  gameId: string,
  action: Action,
  signal?: AbortSignal,
): Promise<ActionResponse> {
  const body = { gameId, action } satisfies { gameId: string; action: Action }
  const res = assertObject(
    await request<unknown>('/api/action', {
      method: 'POST',
      body,
      signal,
      label: 'action',
      timeoutMs: Math.max(TIMEOUT_MS, 60_000),
    }),
    'action response',
  )
  assertGameState(res.state, 'action response state')
  if (typeof res.gameId !== 'string' || !isRecord(res.outcome)) {
    throw contractError('action response', res)
  }
  return res as unknown as ActionResponse
}

/**
 * The whole game as the server currently sees it.
 *
 * This is the escape hatch for a cold `/play/<id>` visit: a pasted or bookmarked
 * link arrives with an empty sessionStorage, and without this the player is told
 * to go back and regenerate. The server holds the authoritative spec and state,
 * so one GET is enough to restore the game in any tab. Returns null when the
 * server has forgotten it (evicted, or a different machine).
 */
export async function getGame(
  gameId: string,
  signal?: AbortSignal,
): Promise<{ gameId: string; problemId: string; seed: number; spec: GameSpec; state: GameState; usedTier: ProviderTier; difficulty?:Difficulty; turnPrompt?:TurnPrompt|null } | null> {
  try {
    const res = assertObject(
      await request<unknown>(`/api/game/${encodeURIComponent(gameId)}`, { signal, label: 'game' }),
      'game response',
    )
    if (!looksLikeGameState(res.state)) return null
    return res as unknown as {
      gameId: string
      problemId: string
      seed: number
      spec: GameSpec
      state: GameState
      usedTier: ProviderTier
    }
  } catch {
    // A cold visit to an evicted or unknown game is an expected outcome here,
    // not an error worth surfacing — the caller shows a recovery screen.
    return null
  }
}

/**
 * The debrief for a finished game.
 *
 * The API normally attaches this to the final `/api/action` response, but it is
 * a pure function of the stored game, so the server can re-derive it. That is
 * what makes a `/debrief/<id>` link work in a cold tab. Returns null while the
 * game is still in progress (409) or unknown (404) — both are ordinary here.
 */
export async function getDebrief(gameId: string, signal?: AbortSignal): Promise<DebriefResponse | null> {
  try {
    const res = await request<unknown>(`/api/game/${encodeURIComponent(gameId)}/debrief`, {
      signal,
      label: 'debrief',
    })
    return assertObject(res, 'debrief response') as unknown as DebriefResponse
  } catch {
    return null
  }
}

export async function postHint(gameId: string, signal?: AbortSignal): Promise<HintResponse> {
  const body = { gameId } satisfies HintRequest
  const res = assertObject(
    await request<unknown>('/api/hint', { method: 'POST', body, signal, label: 'hint' }),
    'hint response',
  )
  if (typeof res.hint !== 'string' || res.hint.length === 0) throw contractError('hint response', res)
  return res as unknown as HintResponse
}

// ------------------------------------------------------------------- coach

/**
 * The multi-turn coach.
 *
 * These endpoints are the newest part of the API and may not be mounted on the
 * server this tab is talking to. Rather than making every caller defensive, a
 * missing route is normalised here into a single `CoachUnavailableError` that
 * `CoachPanel` branches on once — see `isCoachUnavailable`.
 */
export class CoachUnavailableError extends DsaApiError {
  constructor(message: string) {
    super({ kind: 'http', code: 'COACH_UNAVAILABLE', message, status: 404, retryable: true })
    this.name = 'CoachUnavailableError'
  }
}

/**
 * True when the failure means "this build has no coach", as opposed to "the
 * coach is down right now". The distinction decides whether the panel offers a
 * retry button or stays in its not-ready state.
 */
export function isCoachUnavailable(cause: unknown): boolean {
  if (cause instanceof CoachUnavailableError) return true
  if (isDsaApiError(cause)) {
    return (
      cause.status === 404 ||
      cause.status === 405 ||
      cause.status === 501 ||
      cause.code === 'COACH_UNAVAILABLE' ||
      cause.code === 'UNKNOWN_GAME'
    )
  }
  return false
}

function raiseCoachUnavailable(): never {
  throw new CoachUnavailableError('This build of the game server has no coach attached, so there is nobody to ask.')
}

export async function postCoachAsk(body: CoachRequest, signal?: AbortSignal): Promise<CoachResponse> {
  let raw: unknown
  try {
    raw = await request<unknown>('/api/coach/ask', {
      method: 'POST',
      body,
      signal,
      label: 'coach',
      timeoutMs: Math.max(TIMEOUT_MS, 60_000),
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    if (isCoachUnavailable(cause)) return raiseCoachUnavailable()
    throw cause
  }
  const parsed = assertObject(raw, 'coach response')
  if (typeof parsed.reply !== 'string') throw contractError('coach response', parsed)
  return parsed as unknown as CoachResponse
}

export interface CoachThreadSummary {
  id: string
  title: string
  turnCount: number
  updatedAt: number
}

export async function getCoachThreads(gameId: string, signal?: AbortSignal): Promise<CoachThreadSummary[]> {
  let raw: unknown
  try {
    raw = await request<unknown>(`/api/coach/threads?gameId=${encodeURIComponent(gameId)}`, {
      signal,
      label: 'coach threads',
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    if (isCoachUnavailable(cause)) return raiseCoachUnavailable()
    throw cause
  }
  const parsed = assertObject(raw, 'coach threads response')
  if (!Array.isArray(parsed.threads)) throw contractError('coach threads response', parsed)
  return parsed.threads as CoachThreadSummary[]
}

export async function deleteCoachThread(threadId: string, signal?: AbortSignal): Promise<void> {
  try {
    await request<unknown>(`/api/coach/threads/${encodeURIComponent(threadId)}`, {
      method: 'DELETE',
      signal,
      label: 'coach thread',
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    if (isCoachUnavailable(cause)) return raiseCoachUnavailable()
    throw cause
  }
}

export async function postDecide(body: DecideRequest, signal?: AbortSignal): Promise<DecideResponse> {
  const res = assertObject(
    await request<unknown>('/api/decide', { method: 'POST', body, signal, label: 'decision' }),
    'decide response',
  )
  if (typeof res.choice !== 'string' || typeof res.confidence !== 'number') {
    throw contractError('decide response', res)
  }
  return res as unknown as DecideResponse
}

// ----------------------------------------------------------------- account
// Signed-in only. Game play stays anonymous; these power resume/interview.

import type {
  InterviewQuestion,
  Resume,
  Target,
} from '@dsa/account'

export interface AuthUser {
  id: string
  email: string
}

export interface AuthResult {
  user: AuthUser
  token: string
  expiresAt: number
}

export async function postSignup(email: string, password: string, signal?: AbortSignal): Promise<AuthResult> {
  const res = assertObject(
    await request<unknown>('/api/auth/signup', { method: 'POST', body: { email, password }, signal, label: 'sign up' }),
    'signup response',
  )
  const user = assertObject(res.user, 'signup response user')
  if (typeof user.id !== 'string' || typeof user.email !== 'string' || typeof res.token !== 'string') {
    throw contractError('signup response', res)
  }
  return res as unknown as AuthResult
}

export async function postLogin(email: string, password: string, signal?: AbortSignal): Promise<AuthResult> {
  const res = assertObject(
    await request<unknown>('/api/auth/login', { method: 'POST', body: { email, password }, signal, label: 'sign in' }),
    'login response',
  )
  const user = assertObject(res.user, 'login response user')
  if (typeof user.id !== 'string' || typeof user.email !== 'string' || typeof res.token !== 'string') {
    throw contractError('login response', res)
  }
  return res as unknown as AuthResult
}

export async function postLogout(signal?: AbortSignal): Promise<void> {
  await request<unknown>('/api/auth/logout', { method: 'POST', signal, label: 'sign out' })
}

export interface MeResponse {
  user: AuthUser
  resume: Resume
  target: Target | null
  progress: Record<string, string>
}

export async function getMe(signal?: AbortSignal): Promise<MeResponse> {
  const res = assertObject(await request<unknown>('/api/auth/me', { signal, label: 'session' }), 'me response')
  return res as unknown as MeResponse
}

export async function getResume(signal?: AbortSignal): Promise<Resume> {
  const res = assertObject(await request<unknown>('/api/me/resume', { signal, label: 'resume' }), 'resume response')
  return res.resume as Resume
}

export async function putResume(resume: Resume, signal?: AbortSignal): Promise<Resume> {
  const res = assertObject(
    await request<unknown>('/api/me/resume', { method: 'PUT', body: resume, signal, label: 'resume' }),
    'resume response',
  )
  return res.resume as Resume
}

export interface ParseResumeResult {
  resume: Resume
  unparsed: string[]
  /** Which extraction path won: the model, or the deterministic fallback. */
  source: 'model' | 'deterministic'
  notes: string[]
  /** Fields the model produced that were not in the source, and were dropped. */
  rejected: string[]
  saved: boolean
}

export async function postParseResume(text: string, save: boolean, signal?: AbortSignal): Promise<ParseResumeResult> {
  const res = assertObject(
    await request<unknown>('/api/me/parse-resume', { method: 'POST', body: { text, save }, signal, label: 'resume parse' }),
    'parse response',
  )
  return res as unknown as ParseResumeResult
}

export async function getTarget(signal?: AbortSignal): Promise<Target | null> {
  const res = assertObject(await request<unknown>('/api/me/target', { signal, label: 'target' }), 'target response')
  return (res.target ?? null) as Target | null
}

export async function putTarget(target: Target, signal?: AbortSignal): Promise<Target> {
  const res = assertObject(
    await request<unknown>('/api/me/target', { method: 'PUT', body: target, signal, label: 'target' }),
    'target response',
  )
  return res.target as Target
}

export async function getServerProgress(signal?: AbortSignal): Promise<Record<string, string>> {
  const res = assertObject(
    await request<unknown>('/api/me/progress', { signal, label: 'progress' }),
    'progress response',
  )
  return (res.completed ?? {}) as Record<string, string>
}

export async function postServerProgress(completed: Record<string, string>, signal?: AbortSignal): Promise<Record<string, string>> {
  const res = assertObject(
    await request<unknown>('/api/me/progress', { method: 'POST', body: { completed }, signal, label: 'progress' }),
    'progress response',
  )
  return (res.completed ?? {}) as Record<string, string>
}

export interface CompanyProfileDto {
  id: string
  label: string
  aliases: string[]
  values: string[]
  hiringAxes: { id: string; label: string; weight: number; categories: string[] }[]
  rounds: { name: string; focus: string }[]
  techSignals: string[]
}

export async function getCompanies(signal?: AbortSignal): Promise<CompanyProfileDto[]> {
  const res = assertObject(await request<unknown>('/api/companies', { signal, label: 'companies' }), 'companies response')
  if (!Array.isArray(res.companies)) throw contractError('companies response', res)
  return res.companies as CompanyProfileDto[]
}

// --------------------------------------------------------------- interview

export interface InterviewKitResult {
  kitId: string
  target: Target
  questions: InterviewQuestion[]
  usedTier: string
  notes: string[]
  createdAt: number
}

export async function postInterviewGenerate(
  body: { target?: Target; newAngle?: boolean; seed?: number },
  signal?: AbortSignal,
): Promise<InterviewKitResult> {
  const res = assertObject(
    await request<unknown>('/api/interview/generate', {
      method: 'POST',
      body,
      signal,
      label: 'interview prep',
      timeoutMs: Math.max(TIMEOUT_MS, 120_000),
    }),
    'interview response',
  )
  if (!Array.isArray(res.questions)) throw contractError('interview response', res)
  return res as unknown as InterviewKitResult
}

export interface InterviewKitSummary {
  kitId: string
  target: Target
  usedTier: string
  createdAt: number
  count: number
}

export async function getInterviewKits(signal?: AbortSignal): Promise<InterviewKitSummary[]> {
  const res = assertObject(await request<unknown>('/api/interview/kits', { signal, label: 'interview kits' }), 'kits response')
  if (!Array.isArray(res.kits)) throw contractError('kits response', res)
  return res.kits as InterviewKitSummary[]
}

export async function getInterviewKit(kitId: string, signal?: AbortSignal): Promise<InterviewKitResult> {
  const res = assertObject(
    await request<unknown>(`/api/interview/kits/${encodeURIComponent(kitId)}`, { signal, label: 'interview kit' }),
    'kit response',
  )
  if (!Array.isArray(res.questions)) throw contractError('kit response', res)
  return res as unknown as InterviewKitResult
}
