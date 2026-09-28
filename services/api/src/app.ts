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
import {
  API_ERRORS,
  DSA_TOPICS,
  PROBLEMS,
  PROVIDER_TIERS,
  TOPIC_LABELS,
  getProblem,
} from '@dsa/game-schema'
import type { ApiError, ProviderTier } from '@dsa/game-schema'
import { requireOracle } from '@dsa/dsa-oracles'
import {
  createGameRuntime,
  deriveFeedback,
  deriveTurnPrompt,
  nextHint,
  incrementHintsUsed,
} from '@dsa/game-engine'
import { chainGenerateSpec } from '@dsa/provider-chain'
import type { SpecProvider } from '@dsa/provider-chain'
import { createDecisionEngine, pickHint, routeProblem, scoreProblems } from '@dsa/decision-layer'

import { getSession, newGameId, popUndo, pushUndo, putSession, sessionCount } from './store.js'
import { buildDebrief } from './debrief.js'
import { getCoachService, deleteThread as deleteCoachThread, UnknownCoachThreadError } from './coach/index.js'
import {
  ActionBodySchema,
  CoachAskBodySchema,
  CoachThreadsQuerySchema,
  DecideBodySchema,
  GenerateBodySchema,
  HintBodySchema,
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
      c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      c.header('Access-Control-Allow-Headers', 'content-type')
      c.header('Access-Control-Max-Age', '600')
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  })

  const fail = (c: any, status: number, code: string, message: string, details?: unknown) => {
    const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } }
    return c.json(body, status as 400)
  }

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
    const layaAvailable = await deps.decisions.isAvailable()
    return c.json({
      ok: true,
      version: deps.version,
      tiers,
      laya: {
        enabled: deps.decisions.isEnabled(),
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
        problems: PROBLEMS.filter((p) => p.topic === topic),
      })),
      tiers: PROVIDER_TIERS.map((tier) => ({ tier, available: false })),
      laya: { enabled: deps.decisions.isEnabled(), available: false },
      activeGames: sessionCount(),
    }),
  )

  // ----------------------------------------------------------------- generate

  app.post('/api/generate', async (c) => {
    const parsed = GenerateBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid generate request', parsed.error.issues)

    const body = parsed.data
    const problem = getProblem(body.problemId)
    if (!problem) {
      return fail(c, 400, API_ERRORS.unknownProblem, `Unknown problem '${body.problemId}'`, {
        known: PROBLEMS.map((p) => p.id),
      })
    }

    const oracle = requireOracle(problem.id)
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
          instance: state.instance,
          seed,
          difficulty,
          freeText: body.freeText,
          forceTemplate: body.forceTemplate,
        },
        { providers: deps.chain, onAttempt: () => {} },
      )
    } catch (err) {
      console.error('[generate] every provider tier failed:', err)
      return fail(c, 502, API_ERRORS.generationFailed, 'All provider tiers failed', errText(err))
    }

    const gameId = newGameId(problem.id)
    const now = Date.now()
    putSession({
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
    session.state = restored
    return c.json({ gameId: session.gameId, state: restored, undone: true })
  })

  // -------------------------------------------------------------------- hint

  app.post('/api/hint', async (c) => {
    const parsed = HintBodySchema.safeParse(await safeJson(c))
    if (!parsed.success) return fail(c, 400, API_ERRORS.badRequest, 'Invalid hint request')
    const session = getSession(parsed.data.gameId)
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, `Unknown game '${parsed.data.gameId}'`)

    const lastWrong = [...session.state.trace].reverse().find((f) => !f.correct)
    const pool = session.spec.narration.hintPool
    const used = session.state.progress.hintsUsed

    // The engine owns hint CONTENT (the deterministic ladder, which is always
    // algorithmically true). The decision layer only orders the pool, and for
    // that the keyword heuristic is both instant and predictable — see the note
    // in debrief.ts on why Laya is not consulted for structured decisions.
    const chosen = pickHint(pool, used, lastWrong?.dsaOp)
    const index = Number(chosen.choice)
    const hint =
      Number.isInteger(index) && index >= 0 && index < pool.length
        ? (pool[index] as string)
        : (pool[Math.min(used, Math.max(0, pool.length - 1))] ?? nextHint(session.state, session.oracle, session.spec).hint)

    session.state = incrementHintsUsed(session.state)
    return c.json({ hint, source: 'heuristic', confidence: chosen.confidence })
  })

  // ------------------------------------------------------------------ suggest

  /**
   * "I want to practise something" -> the problem we think you meant.
   *
   * Deterministic keyword routing with a synonym map rather than an LLM call:
   * the candidate set is 12 known problems, so a scored match is faster, free,
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
    const result = routeProblem(text)
    const problem = getProblem(result.choice)
    const alternatives = scoreProblems(text)
      .filter((s) => s.id !== result.choice)
      .slice(0, 3)
      .map((s) => ({ problemId: s.id, score: s.score }))
    return c.json({
      problemId: result.choice,
      title: problem?.title ?? null,
      confidence: result.confidence,
      source: result.source,
      alternatives,
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
      const response = await getCoachService().ask(
        { gameId: session.gameId, problemId: session.problemId, spec: session.spec, state: session.state, oracle: session.oracle },
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
  app.delete('/api/coach/threads/:threadId', (c) => {
    const threadId = c.req.param('threadId')
    const deleted = deleteCoachThread(threadId)
    if (!deleted) return fail(c, 404, API_ERRORS.unknownThread, `Unknown coach thread '${threadId}'`)
    return c.json({ threadId, deleted: true })
  })

  // --------------------------------------------------------------- game state

  app.get('/api/game/:gameId', (c) => {
    const session = getSession(c.req.param('gameId'))
    if (!session) return fail(c, 404, API_ERRORS.unknownGame, 'Unknown game')
    return c.json({
      gameId: session.gameId,
      problemId: session.problemId,
      seed: session.seed,
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
