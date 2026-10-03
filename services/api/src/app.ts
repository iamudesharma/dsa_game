import { RoutingPolicy } from './routing.js'
/**
 * The HTTP surface. Both clients (Next.js and Flutter) talk only to this.
 *
 * Route policy: a malformed request is a 400 with a machine-readable code, an
 * unknown game is a 404, and an internal failure is a 500 that logs the real
 * error but returns nothing sensitive. A generation failure is a 502 because
 * it is an upstream provider problem, not ours — though in practice the
 * template tier means it should be unreachable.
 */

import { Hono } from 'hono'
import { installLearningRoutes } from './learning/routes.js'
import { persistPractice } from './learning/store.js'
import { getThread as getCoachThread, getThreadOwner } from './coach/threads.js'
import {
  API_ERRORS,
  DSA_TOPICS,
  PROBLEMS,
  PROVIDER_TIERS,
  TOPIC_LABELS,
  getProblem,
} from '@dsa/game-schema'
import type { ApiError, ProviderTier } from '@dsa/game-schema'
import { getOracle } from '@dsa/dsa-oracles'
import {
  createGameRuntime,
  deriveFeedback,
  deriveTurnPrompt,
  nextHint,
  incrementHintsUsed,
  rewindProgressTo,
} from '@dsa/game-engine'
import { chainGenerateSpec } from '@dsa/provider-chain'
import type { SpecProvider } from '@dsa/provider-chain'
import { createDecisionEngine, pickHint, routeProblem, scoreProblems } from '@dsa/decision-layer'

import { getSession, newGameId, popUndo, pushUndo, putSession, sessionCount } from './store.js'
import { buildDebrief } from './debrief.js'
import { getCoachService, deleteThread as deleteCoachThread, UnknownCoachThreadError } from './coach/index.js'
import { getDb } from './db/index.js'
import { hashPassword, isValidEmail, normaliseEmail, verifyPassword } from './auth/password.js'
import {
  AUTH_EMAIL_LIMIT,
  AUTH_EMAIL_WINDOW_MS,
  AUTH_IP_LIMIT,
  AUTH_IP_WINDOW_MS,
  INTERVIEW_LIMIT,
  INTERVIEW_WINDOW_MS,
  checkRateLimit,
} from './auth/rate-limit.js'
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  sessionCookie,
  tokenFromAuthHeader,
  tokenFromCookieHeader,
} from './auth/session.js'
import { createUser, findUserByEmail, getRequestIp, resolveUser } from './auth/middleware.js'
import { getKit, getProgress, getResume, getTarget, listKits, mergeProgress, putResume, putTarget, saveKit } from './account/store.js'
import { extractResume } from './account/extract.js'
import { generateInterviewKit } from './interview/service.js'
import {
  COMPANY_PROFILES,
  parseResumeText,
  type Target,
} from '@dsa/account'
import {
  ActionBodySchema,
  AuthBodySchema,
  CoachAskBodySchema,
  CoachThreadsQuerySchema,
  DecideBodySchema,
  GenerateBodySchema,
  HintBodySchema,
  InterviewGenerateBodySchema,
  ParseResumeBodySchema,
  ProgressBodySchema,
  ResumeBodySchema,
  TargetBodySchema,
  UndoBodySchema,
} from './validate.js'

const startedAt = Date.now()

export interface AppDeps {
  /** Tiers in priority order; the last must be the always-available template. */
  chain: SpecProvider[]
  decisions: ReturnType<typeof createDecisionEngine>
  version: string
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  const routing = new RoutingPolicy(deps.decisions)

  /**
   * CORS, restricted to loopback origins.
   *
   * The web client is served from a different port than this API (3000 vs 8787),
   * so the browser treats every call as cross-origin and blocks it without these
   * headers: the UI then looks broken while the API is perfectly healthy.
   *
   * Only loopback hosts are allowed, deliberately. This API has no auth and can
   * spend money (it calls paid LLM tiers), so it must not become reachable from
   * the LAN. Widen `isLoopbackOrigin` only if you want the phone to drive it,
   * and understand that anyone on that wifi could then generate on your key.
   */
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    if (origin && isLoopbackOrigin(origin)) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Vary', 'Origin')
      c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
      c.header('Access-Control-Allow-Headers', 'content-type, authorization')
      // Cookies are the primary session transport when the page and the API
      // share a host; the bearer fallback covers localhost-vs-127.0.0.1.
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Access-Control-Max-Age', '600')
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  })

  const fail = (c: any, status: number, code: string, message: string, details?: unknown) => {
    const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } }
    return c.json(body, status as 400)
  }

  app.use('/api/*', async (c, next) => {
    const path = c.req.path
    const actor = resolveUser(c)
    let gameId: string | undefined
    if (path.startsWith('/api/game/')) gameId = c.req.param('gameId') || path.split('/')[3]
    else if (['/api/action','/api/undo','/api/hint','/api/coach/ask'].includes(path)) {
      try { gameId = ((await c.req.raw.clone().json()) as { gameId?: string }).gameId } catch { /* route validates */ }
    } else if (path === '/api/coach/threads') gameId = c.req.query('gameId')
    else if (path.startsWith('/api/coach/threads/')) {
      const threadId = path.split('/').pop()!
      const owner = getThreadOwner(threadId)
      if (owner && owner !== actor?.id) return fail(c, 404, API_ERRORS.unknownThread, 'Unknown conversation')
      const coach = getCoachThread(threadId)
      gameId = coach?.gameId
    }
    if (typeof gameId === 'string') {
      const session = getSession(gameId)
      if (session?.userId && session.userId !== actor?.id) return fail(c, 404, API_ERRORS.unknownGame, 'Unknown game')
    }
    await next()
  })
  installLearningRoutes(app, routing)

  // ------------------------------------------------------------------ health

  app.get('/api/health', async (c) => {
    const tiers = await Promise.all(
      PROVIDER_TIERS.map(async (tier) => {
        const provider = deps.chain.find((p) => p.tier === tier)
        if (!provider) return { tier, available: false, detail: 'not registered' }
        try {
          const available = await provider.isAvailable()
          return { tier, available, detail: available ? undefined : 'not reachable / not configured' }
        } catch (err) {
          return { tier, available: false, detail: errText(err) }
        }
      }),
    )
    const decision = deps.decisions.status?.()
    const layaAvailable = !decision || decision.backend === 'laya' ? await deps.decisions.isAvailable() : false
    return c.json({
      ok: true,
      version: deps.version,
      tiers,
      decision: decision?.backend === 'laya' ? { ...decision, available: layaAvailable } : decision ?? { backend: 'laya', available: layaAvailable },
      laya: {
        enabled: (!decision || decision.backend === 'laya') && deps.decisions.isEnabled(),
        available: layaAvailable,
        detail: layaAvailable ? undefined : 'sidecar offline — heuristics in use',
      },
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    })
  })

  // --------------------------------------------------------------- catalogue

  app.get('/api/catalogue', (c) =>
    c.json({
      topics: DSA_TOPICS.map((topic) => ({
        id: topic,
        label: TOPIC_LABELS[topic],
        // `playable` is the catalogue telling the truth about itself. Without
        // it, every problem rendered as an equal, equally-clickable option and
        // the learner discovered the ten missing oracles by hitting a 500 —
        // which is not something a catalogue should make you do. `PROBLEMS` is
        // the list of what is PLANNED; this is the list of what works.
        problems: PROBLEMS.filter((p) => p.topic === topic).map((p) => ({
          ...p,
          playable: getOracle(p.id) !== undefined,
        })),
      })),
      tiers: PROVIDER_TIERS.map((tier) => ({ tier, available: false })),
      laya: { enabled: deps.decisions.status?.().backend === 'laya' && deps.decisions.isEnabled(), available: false },
      activeGames: sessionCount(),
    }),
  )

  // ----------------------------------------------------------------- generate

  app.post('/api/generate', async (c) => {
    const parsed = GenerateBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid generate request', parsed.error.issues)

    const body = parsed.data
    const ownerId = resolveUser(c)?.id
    const problem = getProblem(body.problemId)
    if (!problem) {
      return fail(c, 400, API_ERRORS.unknownProblem, `Unknown problem '${body.problemId}'`, {
        known: PROBLEMS.map((p) => p.id),
      })
    }

    // Keep a defensive response for a future catalogue/registry mismatch.
    // The shipped catalogue currently has an oracle for every listed problem.
    const oracle = getOracle(problem.id)
    if (!oracle) {
      return fail(
        c,
        409,
        API_ERRORS.problemNotPlayable,
        `'${problem.id}' is listed but its game is not finished yet`,
        {
          problemId: problem.id,
          playable: PROBLEMS.filter((p) => getOracle(p.id) !== undefined).map((p) => p.id),
        },
      )
    }

    const seed = body.seed ?? randomSeed()
    const difficulty = body.difficulty ?? problem.defaultDifficulty

    let state
    try {
      const runtime = createGameRuntime(oracle)
      state = runtime.init(seed, difficulty)
    } catch (err) {
      // A broken oracle is our bug, not the client's.
      console.error(`[generate] oracle '${problem.id}' failed to build an instance:`, err)
      return fail(c, 500, API_ERRORS.internal, `Oracle '${problem.id}' could not build an instance`, errText(err))
    }

    let generated
    try {
      generated = await chainGenerateSpec(
        {
          problem,
          signal: c.req.raw.signal,
          instance: state.instance,
          seed,
          difficulty,
          freeText: body.freeText,
          forceTemplate: body.forceTemplate,
        },
        {
          providers: body.forceTemplate ? deps.chain : await routing.providers(deps.chain, body.freeText ?? problem.title, c.req.raw.signal),
          onAttempt: attempt => {
            if (!attempt.error?.startsWith('skipped:')) routing.record(attempt.tier, attempt.ok, attempt.ms)
          },
        },
      )
    } catch (err) {
      console.error('[generate] every provider tier failed:', err)
      return fail(c, 502, API_ERRORS.generationFailed, 'All provider tiers failed', errText(err))
    }

    if (c.req.raw.signal.aborted) return fail(c, 408, API_ERRORS.badRequest, 'Generation cancelled')
    const gameId = newGameId(problem.id)
    const now = Date.now()
    putSession({
      ...(ownerId ? { userId: ownerId } : {}),
      gameId,
      problemId: problem.id,
      seed,
      difficulty,
      oracle,
      spec: generated.spec,
      state,
      undo: [],
      usedTier: generated.tier,
      createdAt: now,
      lastAccessedAt: now,
    })

    return c.json({
      gameId,
      problemId: problem.id,
      seed,
      spec: generated.spec,
      state,
      usedTier: generated.tier,
      attempts: generated.attempts,
      notes: generated.notes,
      // The opening instruction. Without it the board is a blank puzzle and the
      // learner has to guess what the first move even is.
      turnPrompt: deriveTurnPrompt({ state, oracle, spec: generated.spec }),
    })
  })

  // ------------------------------------------------------------------ action

  app.post('/api/action', async (c) => {
    const parsed = ActionBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid action request', parsed.error.issues)

    const { gameId, action } = parsed.data
    const session = getSession(gameId)
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, `Unknown game '${gameId}'`)

    const runtime = createGameRuntime(session.oracle)
    const prior = session.state
    const { state, outcome, warnings } = runtime.apply(prior, action)

    if (warnings.length) console.warn(`[action] engine repairs for ${gameId}:`, warnings)

    session.state = state
    pushUndo(session, prior)
    persistPractice(session)

    // The frame this action produced, if any. A rejected move produces none,
    // which is why feedback must not require one.
    const frame = state.trace[state.trace.length - 1]

    const response: Record<string, unknown> = {
      gameId,
      state,
      outcome,
      usedTier: session.usedTier,
      turnPrompt: deriveTurnPrompt({ state, oracle: session.oracle, spec: session.spec }),
      feedback: deriveFeedback({
        state,
        oracle: session.oracle,
        spec: session.spec,
        outcome,
        frame,
      }),
    }
    if (state.phase !== 'playing') {
      response.debrief = await buildDebrief({
        spec: session.spec,
        state,
        oracle: session.oracle,
        usedTier: session.usedTier as ProviderTier,
      })
    }
    return c.json(response)
  })

  // -------------------------------------------------------------------- undo

  app.post('/api/undo', async (c) => {
    const parsed = UndoBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid undo request')
    const session = getSession(parsed.data.gameId)
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, `Unknown game '${parsed.data.gameId}'`)
    const restored = popUndo(session)
    if (!restored) {
      return c.json({ gameId: session.gameId, state: session.state, undone: false })
    }
    session.state = rewindProgressTo(session.state, restored)
    persistPractice(session)
    return c.json({ gameId: session.gameId, state: session.state, undone: true })
  })

  // -------------------------------------------------------------------- hint

  /**
   * The hint ladder.
   *
   * THE ORDERING DECISION IS NOT THE CONTENT DECISION. This route used to read
   * `pool[index]` itself, so whichever entry the decision layer chose went to
   * the learner verbatim — unscreened, unprefixed, and on the default tier
   * literally "First move: Set lo=0, hi=n-1." The decision layer is good at
   * choosing an INDEX (a hint ordered by the operation just got wrong beats the
   * next one in a list) and has no business choosing text. So it now picks an
   * index, `nextHint` picks the words, and `hint-safety` clears them.
   */
  app.post('/api/hint', async (c) => {
    const parsed = HintBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid hint request')
    const session = getSession(parsed.data.gameId)
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, `Unknown game '${parsed.data.gameId}'`)

    const lastWrong = [...session.state.trace].reverse().find((f) => !f.correct)
    const pool = session.spec.narration.hintPool
    const used = session.state.progress.hintsUsed

    // The keyword heuristic orders the pool: it is instant, predictable, and
    // good enough that Laya is not consulted here — see the note in debrief.ts
    // on why the decision layer is not asked for structured decisions.
    const chosen = pickHint(pool, used, lastWrong?.dsaOp)
    const index = Number(chosen.choice)
    const preferIndex = Number.isInteger(index) && index >= 0 ? index : undefined

    const result = nextHint(session.state, session.oracle, session.spec, { preferIndex })
    if (result.screened !== undefined) {
      console.warn(
        `[api] hint screened (${result.screened.id}: ${result.screened.reason}) for game ${session.gameId}`,
      )
    }

    session.state = incrementHintsUsed(session.state)
    persistPractice(session)
    return c.json({
      hint: result.hint,
      source: result.source,
      confidence: chosen.confidence,
      ...(result.screened !== undefined
        ? { screened: { id: result.screened.id, reason: result.screened.reason } }
        : {}),
    })
  })

  // ------------------------------------------------------------------ suggest

  /**
   * "I want to practise something" -> the problem we think you meant.
   *
   * Deterministic keyword routing with a synonym map rather than an LLM call:
   * the candidate set is the problem catalogue, so a scored match is faster, free,
   * reproducible, and cannot hallucinate a problem that does not exist. The
   * confidence reflects the margin between the best and second-best match, so
   * an ambiguous request reports low confidence and the client can ask.
   */
  app.post('/api/suggest', async (c) => {
    const body = (await safeJson(c)) as { freeText?: unknown }
    const freeText = typeof body?.freeText === 'string' ? body.freeText : ''
    if (!freeText.trim()) {
      return fail(c, 400, API_ERRORS.badRequest, 'freeText is required')
    }
    const text = freeText.slice(0, 500)
    const playable = PROBLEMS.filter(p => getOracle(p.id) !== undefined)
    const options = Object.fromEntries(playable.map(p => [p.id, `${p.title}: ${p.learningObjective}`]))
    const normalized = text.trim().toLowerCase().replaceAll('-', ' ')
    const direct = playable.find(p => normalized === p.id.replaceAll('-', ' ') || normalized === p.title.toLowerCase())
    const result = direct ? { choice: direct.id, confidence: 1, source: 'heuristic' as const, scoreKind: 'heuristic' as const } : await deps.decisions.decide({ kind: 'route-problem', stateText: text, options, instructions: 'Select the playable problem matching this request.' })
    const problem = getProblem(result.choice)
    const alternatives = scoreProblems(text)
      .filter((s) => s.id !== result.choice && getOracle(s.id) !== undefined)
      .slice(0, 3)
      .map((s) => ({ problemId: s.id, score: s.score }))
    return c.json({
      problemId: result.choice,
      title: problem?.title ?? null,
      confidence: result.confidence,
      source: result.source,
      alternatives,
      scoreKind: result.scoreKind,
      model: result.model,
    })
  })

  // ------------------------------------------------------------------ decide

  app.post('/api/decide', async (c) => {
    const parsed = DecideBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid decide request', parsed.error.issues)
    const body = parsed.data
    try {
      const result = await deps.decisions.decide(body)
      return c.json({
        kind: body.kind,
        choice: result.choice,
        confidence: result.confidence,
        source: result.source,
        distribution: result.distribution,
        model: result.model,
        scoreKind: result.scoreKind,
        score: result.score,
        margin: result.margin,
        fallbackReason: result.fallbackReason,
      })
    } catch (err) {
      return fail(c, 500, API_ERRORS.internal, 'Decision layer failed', errText(err))
    }
  })

  // -------------------------------------------------------------------- coach

  /**
   * The coach is a QUESTION, not a move. It reads the live game and returns text;
   * it never applies an action and never mutates the session. That is why there is
   * no `session.state = ...` anywhere in this handler, and it is the structural
   * version of the contract's "a coach turn can never mutate the game" rule — a
   * coach that could move the board could give the answer away by moving it.
   *
   * A 404 for an unknown game comes first, before the coach runs, so a typo
   * produces a clear error instead of a confident answer about a board that does
   * not exist.
   */
  app.post('/api/coach/ask', async (c) => {
    const parsed = CoachAskBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid coach request', parsed.error.issues)
    const body = parsed.data

    const session = getSession(body.gameId)
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, `Unknown game '${body.gameId}'`)

    try {
      const response = await getCoachService(process.env, routing.chat()).ask(
        { userId: session.userId, gameId: session.gameId, problemId: session.problemId, spec: session.spec, state: session.state, oracle: session.oracle },
        { gameId: body.gameId, threadId: body.threadId, message: body.message, band: body.band, title: body.title },
      )
      return c.json(response)
    } catch (err) {
      if (err instanceof UnknownCoachThreadError) {
        return fail(c, 404, API_ERRORS.unknownThread, err.message, { threadId: err.threadId })
      }
      // A coach failure must not look like a broken game, but it also must not
      // look like the learner's fault — hence a 500 with a code, and no stack.
      console.error(`[coach] thread '${body.threadId ?? 'new'}' on game ${body.gameId} failed:`, err)
      return fail(c, 500, API_ERRORS.internal, 'The coach could not answer that', errText(err))
    }
  })

  /**
   * The conversation switcher. Several threads per game is the feature, not a
   * detail: a learner who realises they asked about the wrong thing needs a second
   * conversation, not a longer one. Listing them is what makes that possible.
   *
   * The 404 is checked BEFORE listing, so a bad `gameId` is an error rather than an
   * empty array that a client would render as "you have no conversations yet".
   */
  app.get('/api/coach/threads', (c) => {
    const parsed = CoachThreadsQuerySchema.safeParse({ gameId: c.req.query('gameId') })
    if (!parsed.success) {
      return fail(c, 400, API_ERRORS.badRequest, 'gameId is required', parsed.error.issues)
    }
    if (!getSession(parsed.data.gameId)) {
      return fail(c, 404, API_ERRORS.unknownGame, `Unknown game '${parsed.data.gameId}'`)
    }
    return c.json({ gameId: parsed.data.gameId, threads: getCoachService().listThreads(parsed.data.gameId) })
  })

  /**
   * Deleting a thread does NOT end the game and does not touch the session. It is
   * a conversation, and a learner is entitled to close one — including the one
   * they are looking at, which is why the client should call this before asking
   * again rather than after.
   */
  app.get('/api/coach/threads/:threadId', (c) => {
    const thread = getCoachThread(c.req.param('threadId'))
    if (!thread) return fail(c, 404, API_ERRORS.unknownThread, 'Unknown conversation')
    return c.json({ thread })
  })

  app.delete('/api/coach/threads/:threadId', (c) => {
    const threadId = c.req.param('threadId')
    const deleted = deleteCoachThread(threadId)
    if (!deleted) return fail(c, 404, API_ERRORS.unknownThread, `Unknown coach thread '${threadId}'`)
    return c.json({ threadId, deleted: true })
  })

  // -------------------------------------------------------------------- auth
  // Email + password, server-side sessions. The game loop stays anonymous;
  // these routes only gate resume/interview/progress-sync.

  /**
   * Signup. Duplicate emails and invalid input return the same generic shape
   * as login failures so an attacker cannot enumerate accounts. The raw
   * session token is returned once (bearer fallback) AND set as an httpOnly
   * cookie (same-host case); both authorize identically.
   */
  app.post('/api/auth/signup', async (c) => {
    const parsed = AuthBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid signup request', parsed.error.issues)
    const ip = getRequestIp(c)
    const email = normaliseEmail(parsed.data.email)
    if (!isValidEmail(email)) return fail(c, 400, API_ERRORS.badRequest, 'Enter a valid email address.')
    const emailGate = checkRateLimit(`auth:email:${email}`, AUTH_EMAIL_LIMIT, AUTH_EMAIL_WINDOW_MS)
    const ipGate = checkRateLimit(`auth:ip:${ip}`, AUTH_IP_LIMIT, AUTH_IP_WINDOW_MS)
    if (!emailGate.allowed || !ipGate.allowed) {
      return fail(c, 429, API_ERRORS.rateLimited, 'Too many attempts. Try again in a few minutes.')
    }
    getDb()
    if (findUserByEmail(email)) {
      // Generic message: do not reveal the account exists.
      return fail(c, 409, API_ERRORS.emailTaken, 'Could not create that account. Try signing in instead.')
    }
    const user = createUser(email, await hashPassword(parsed.data.password))
    const sess = createSession(user.id, c.req.header('user-agent') ?? '')
    c.header('Set-Cookie', sessionCookie(sess.token, sess.expiresAt))
    return c.json({ user: { id: user.id, email: user.email }, token: sess.token, expiresAt: sess.expiresAt })
  })

  app.post('/api/auth/login', async (c) => {
    const parsed = AuthBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid login request', parsed.error.issues)
    const ip = getRequestIp(c)
    const email = normaliseEmail(parsed.data.email)
    const emailGate = checkRateLimit(`auth:email:${email}`, AUTH_EMAIL_LIMIT, AUTH_EMAIL_WINDOW_MS)
    const ipGate = checkRateLimit(`auth:ip:${ip}`, AUTH_IP_LIMIT, AUTH_IP_WINDOW_MS)
    if (!emailGate.allowed || !ipGate.allowed) {
      return fail(c, 429, API_ERRORS.rateLimited, 'Too many attempts. Try again in a few minutes.')
    }
    getDb()
    const found = findUserByEmail(email)
    // Same message and similar work whether or not the account exists.
    const ok = found ? await verifyPassword(parsed.data.password, found.passwordHash) : false
    if (!found || !ok) {
      // Burn comparable time for an unknown email so timing reveals nothing.
      if (!found) await hashPassword(parsed.data.password)
      return fail(c, 401, API_ERRORS.invalidCredentials, 'Email or password did not match.')
    }
    const sess = createSession(found.id, c.req.header('user-agent') ?? '')
    c.header('Set-Cookie', sessionCookie(sess.token, sess.expiresAt))
    return c.json({ user: { id: found.id, email: found.email }, token: sess.token, expiresAt: sess.expiresAt })
  })

  app.post('/api/auth/logout', async (c) => {
    const cookie = c.req.header('cookie')
    const auth = c.req.header('authorization')
    const t = tokenFromCookieHeader(cookie) ?? tokenFromAuthHeader(auth)
    if (t) revokeSession(t)
    c.header('Set-Cookie', clearSessionCookie())
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', (c) => {
    const user = resolveUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    getDb()
    return c.json({
      user: { id: user.id, email: user.email },
      resume: getResume(user.id),
      target: getTarget(user.id),
      progress: getProgress(user.id),
    })
  })

  // ------------------------------------------------------------------ account

  const needUser = (c: any): { id: string; email: string } | null => {
    const user = resolveUser(c)
    if (!user) {
      return null
    }
    return { id: user.id, email: user.email }
  }

  app.get('/api/me/resume', (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    return c.json({ resume: getResume(user.id) })
  })

  app.put('/api/me/resume', async (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    const parsed = ResumeBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid resume', parsed.error.issues)
    return c.json({ resume: putResume(user.id, parsed.data) })
  })

  /**
   * Paste/upload text → structured resume.
   *
   * A model gets first refusal on real-world messy resumes, but every field it
   * produces is screened against the source text by `groundedResume` before it
   * can be served: an ungrounded employer, date, or skill is replaced from the
   * deterministic parse. `source` reports which path won, and `unparsed`
   * carries the lines neither path could place so the user fixes them by hand.
   * The endpoint always returns a resume — a failed model is a mode, not an error.
   */
  app.post('/api/me/parse-resume', async (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    const parsed = ParseResumeBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid parse request', parsed.error.issues)

    const { unparsed } = parseResumeText(parsed.data.text)
    const result = await extractResume({ text: parsed.data.text })
    const saved = parsed.data.save === true ? putResume(user.id, result.resume) : null
    return c.json({
      resume: saved ?? result.resume,
      unparsed,
      source: result.source,
      notes: result.notes,
      rejected: result.rejected,
      saved: saved !== null,
    })
  })

  app.get('/api/me/target', (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    return c.json({ target: getTarget(user.id) })
  })

  app.put('/api/me/target', async (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    const parsed = TargetBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid target', parsed.error.issues)
    return c.json({ target: putTarget(user.id, parsed.data) })
  })

  app.get('/api/me/progress', (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    return c.json({ completed: getProgress(user.id) })
  })

  /**
   * First-login merge: the client posts its device-local completion map and
   * gets the union back. Server wins on conflicts already stored.
   */
  app.post('/api/me/progress', async (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    const parsed = ProgressBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid progress', parsed.error.issues)
    return c.json({ completed: mergeProgress(user.id, parsed.data.completed) })
  })

  app.get('/api/companies', (c) => c.json({ companies: COMPANY_PROFILES }))

  // --------------------------------------------------------------- interview

  /**
   * Generate an interview kit from the stored resume + target.
   *
   * The model fills wording; `validateInterviewKit` enforces that every
   * sourceRef exists in the resume, every practice.problemId is a playable
   * catalogue problem, and no company process facts are asserted. Any failure
   * falls back to the deterministic template — the endpoint always returns a
   * kit, mirroring the game-generation guarantee.
   */
  app.post('/api/interview/generate', async (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    const gate = checkRateLimit(`interview:${user.id}`, INTERVIEW_LIMIT, INTERVIEW_WINDOW_MS)
    if (!gate.allowed) return fail(c, 429, API_ERRORS.rateLimited, 'Too many interview kits. Try again later.')
    const parsed = InterviewGenerateBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid interview request', parsed.error.issues)

    const resume = getResume(user.id)
    let target: Target | null = parsed.data.target ?? getTarget(user.id)
    if (parsed.data.target) target = putTarget(user.id, parsed.data.target)
    if (!target) {
      return fail(c, 400, API_ERRORS.badRequest, 'Set your goal and target company first.', {
        missing: 'target',
      })
    }

    const result = await generateInterviewKit({
      resume,
      target,
      newAngle: parsed.data.newAngle,
      seed: parsed.data.seed,
    })
    const stored = saveKit(user.id, target, result.kit.questions, result.usedTier)
    return c.json({
      kitId: stored.id,
      target,
      questions: result.kit.questions,
      usedTier: result.usedTier,
      notes: result.notes,
      createdAt: stored.createdAt,
    })
  })

  app.get('/api/interview/kits', (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    const kits = listKits(user.id, 10)
    return c.json({
      kits: kits.map((k) => ({ kitId: k.id, target: k.target, usedTier: k.usedTier, createdAt: k.createdAt, count: k.questions.length })),
    })
  })

  app.get('/api/interview/kits/:kitId', (c) => {
    const user = needUser(c)
    if (!user) return fail(c, 401, API_ERRORS.unauthorized, 'Sign in to continue.')
    const kit = getKit(user.id, c.req.param('kitId'))
    if (!kit) return fail(c, 404, API_ERRORS.badRequest, 'Unknown interview kit')
    return c.json({ kitId: kit.id, target: kit.target, questions: kit.questions, usedTier: kit.usedTier, createdAt: kit.createdAt })
  })

  // --------------------------------------------------------------- game state

  app.get('/api/game/:gameId', (c) => {
    const session = getSession(c.req.param('gameId'))
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, 'Unknown game')
    return c.json({
      gameId: session.gameId,
      problemId: session.problemId,
      seed: session.seed,
      difficulty:session.difficulty,
      turnPrompt:deriveTurnPrompt({state:session.state,oracle:session.oracle,spec:session.spec}),
      spec: session.spec,
      state: session.state,
      usedTier: session.usedTier,
    })
  })

  /**
   * The debrief is a pure function of (spec, state, oracle), so a finished game
   * can be re-derived on demand instead of only being handed over with the final
   * /api/action response. That is what makes a debrief link shareable: without
   * this, `/debrief/<id>` only works in the tab that played the game.
   */
  app.get('/api/game/:gameId/debrief', async (c) => {
    const session = getSession(c.req.param('gameId'))
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, 'Unknown game')
    if (session.state.phase === 'playing') {
      return fail(c, 409, API_ERRORS.badRequest, 'This game is still in progress', {
        phase: session.state.phase,
      })
    }
    return c.json(
      await buildDebrief({
        spec: session.spec,
        state: session.state,
        oracle: session.oracle,
        usedTier: session.usedTier as ProviderTier,
      }),
    )
  })

  app.notFound((c) => fail(c, 404, API_ERRORS.badRequest, `No route for ${c.req.method} ${c.req.path}`))
  app.onError((err, c) => {
    console.error('[api] unhandled error:', err)
    return fail(c, 500, API_ERRORS.internal, 'Internal error', errText(err))
  })

  return app
}

/**
 * True only for a browser origin served from this machine.
 *
 * Matching on a suffix like `.localhost` or `:3000` alone would let a hostile
 * page at `http://evil.localhost` or `http://x:3000` through, so the hostname
 * is checked exactly and the port is pinned to the one Next.js dev serves on.
 */
function isLoopbackOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  return loopback && (url.port === '' || url.port === '3000')
}

async function safeJson(c: any): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return {}
  }
}

function errText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}
