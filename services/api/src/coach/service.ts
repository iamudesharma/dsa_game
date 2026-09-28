/**
 * The coach, end to end.
 *
 * The order of operations here is the design, so it is worth stating once:
 *
 *   1. derive the `TurnPrompt` and the `GuidancePromptSnapshot` from the LIVE game.
 *      Both are pure and oracle-derived, so the coach is always answering about the
 *      board the learner is actually looking at, even though the game has moved on
 *      three times since they opened the panel.
 *   2. record the learner's turn WITH that snapshot. This is what makes "no, I
 *      meant the other one" resolvable three questions later.
 *   3. size the window against the budget, preferring the newest turns and
 *      shedding snapshots before words.
 *   4. ask the model — or do not, and use the deterministic fallback.
 *   5. screen the reply. The guardrail is not advisory and does not run "if it
 *      looks bad"; it runs on every reply from every source, and a hit REPLACES
 *      the text rather than annotating it.
 *   6. record the coach turn, fold the cost into the thread, emit one span.
 *
 * THE COACH NEVER TOUCHES THE GAME. There is no `runtime.apply` call anywhere in
 * this file and there must never be one: the contract says a coach turn returns
 * text only, and a coach that could move the board could give the answer away by
 * moving it. The strongest guarantee available is structural, and that is the one
 * we take — the only game state this file can reach is the `GameSession` it reads.
 */

import { COACH_BUDGET, COACH_SYSTEM_RULES } from '@dsa/game-schema'
import type {
  CoachResponse,
  CoachRequest,
  CoachRole,
  CoachThread,
  CoachTurn,
  GameSpec,
  GameState,
  GuidancePromptSnapshot,
  LearnerBand,
  Oracle,
  TurnPrompt,
} from '@dsa/game-schema'
import { defaultChatTransport } from '@dsa/provider-chain'
import type { ChatMessage, ChatTransport } from '@dsa/provider-chain'

import { assembleWindow, budgetAfterPreamble, estimateTokens, estimateTurnTokens, serialiseSnapshot } from './budget.js'
import { classifyIntent, fallbackAnswer } from './fallback.js'
import { screenCoachReply } from './guardrails.js'
import { buildTurnPrompt } from './prompt.js'
import { buildSnapshot } from './snapshot.js'
import { makeCoachSpan, traceCoachCall } from './trace.js'
import type { CoachOutcome } from './trace.js'
import { appendTurn, createThread, getThread, listThreadsForGame, rememberHint, setThreadSummary } from './threads.js'
import type { CoachThreadSummary } from './threads.js'

/** Hard ceiling on what a learner can type. Past this it is a paste, not a question. */
const MAX_QUESTION_CHARS = 1000
const MAX_TITLE_CHARS = 60

export interface CoachWorld {
  readonly gameId: string
  readonly problemId: string
  readonly spec: GameSpec
  readonly state: GameState
  readonly oracle: Oracle
}

export interface CoachDeps {
  /** Null means "no model reachable"; the coach then always falls back. */
  readonly transport: ChatTransport | null
  /** Injected so `latencyMs` is real in tests rather than an artefact of speed. */
  readonly now?: () => number
}

export interface CoachService {
  ask(world: CoachWorld, request: CoachRequest): Promise<CoachResponse>
  listThreads(gameId: string): CoachThreadSummary[]
}

export class UnknownCoachThreadError extends Error {
  constructor(readonly threadId: string) {
    super(`Unknown coach thread '${threadId}'`)
    this.name = 'UnknownCoachThreadError'
  }
}

export function createCoachService(deps: CoachDeps): CoachService {
  const now = deps.now ?? ((): number => Date.now())

  return {
    async ask(world, request) {
      const startedAt = now()
      const question = request.message.trim().slice(0, MAX_QUESTION_CHARS)
      const band = request.band

      // 1. The world, read fresh. The game has moved on while the panel was open.
      //    The band is threaded through so the prompt's register matches the one the
      //    board is already using, rather than the coach being the only surface that
      //    knows how old the learner is.
      const turnPrompt = buildTurnPrompt({
        state: world.state,
        spec: world.spec,
        oracle: world.oracle,
        ...(band === undefined ? {} : { band }),
      })
      const snapshot = buildSnapshot({
        state: world.state,
        spec: world.spec,
        oracle: world.oracle,
        turnPrompt,
      })

      // 2. The thread, then the learner's turn with the board it was asked about.
      const thread =
        request.threadId === undefined
          ? createThread({
              gameId: world.gameId,
              problemId: world.problemId,
              title: request.title?.trim().slice(0, MAX_TITLE_CHARS),
              now: startedAt,
            })
          : resolveThread(request.threadId, world)

      const prior = getThread(thread.id, startedAt) ?? thread
      const learnerTurn = makeTurn('learner', question, now(), snapshot, false)
      const afterLearner = appendTurn(thread.id, learnerTurn, now()) ?? prior
      // `appendTurn` already recorded the learner's turn, so the conversation is
      // the thread's own turns. The explicit fallback covers the one case where the
      // append did not land (an evicted thread), because a coach that answers the
      // current question without it would be answering out of nowhere.
      const conversationTurns = afterLearner.turns.includes(learnerTurn)
        ? afterLearner.turns
        : [...afterLearner.turns, learnerTurn]

      // 3. The window. The system prompt and the dropped-turn summary are real
      //    tokens but are not turns, so the ceiling is lowered by their exact cost
      //    rather than guessed at. Both are built ONCE and reused, so the estimate
      //    and the bytes on the wire cannot drift apart.
      const classified = classifyIntent(question)
      const system = buildSystemPrompt(band)
      const summaryBlock = conversationSummary(afterLearner.summary)
      const preambleTokens = estimateTokens(system) + estimateTokens(summaryBlock)
      const windowBudget = budgetAfterPreamble([system, summaryBlock], COACH_BUDGET)
      const window = assembleWindow(conversationTurns, windowBudget, afterLearner.summary)
      // The message envelope (role labels, the goal/instruction block, the current
      // question) is not counted, so this is a slight UNDER-estimate. That is the
      // right direction to be wrong in: the reserve absorbs the gap, whereas an
      // over-estimate would silently throw away conversation for no reason.
      const approxPromptTokens = window.approxPromptTokens + preambleTokens

      // 4. Ask, or fall back. The fallback is a normal outcome, not an error: an
      //    unavailable key must not turn a learner's question into a 5xx.
      const asked = await askModel(deps.transport, {
        system,
        summary: summaryBlock,
        snapshot,
        turnPrompt,
        window,
        question,
        band,
        maxTokens: COACH_BUDGET.replyReserveTokens,
      })

      // 5. Screen. ALWAYS. A model reply, a fallback reply and an empty reply all
      //    go through the same validator, and a hit replaces the text.
      const source: 'model' | 'fallback' = asked.text === null ? 'fallback' : 'model'
      const rawReply = asked.text ?? ''
      const screened = screenCoachReply(rawReply, snapshot)
      const guardrailFired = !screened.ok

      // An empty reply must still produce coaching, so the deterministic path is
      // the FLOOR under the model rather than a rival to it. A guardrail rewrite is
      // never empty (the canned lines are whole sentences), so this only fires for
      // a transport that returned nothing at all.
      const finalText =
        screened.text.trim() === ''
          ? fallbackAnswer({ question, snapshot, turnPrompt, band, givenHints: afterLearner.givenHints }).text
          : screened.text

      // 6. Record and report.
      const coachTurn = makeTurn('coach', finalText, now(), snapshot, source === 'fallback')
      const afterCoach = appendTurn(thread.id, coachTurn, now()) ?? afterLearner
      setThreadSummary(thread.id, window.summary, now())
      rememberHint(thread.id, finalText, now())

      const latencyMs = now() - startedAt
      const approxReplyTokens = estimateTokens(finalText)
      traceCoachCall(
        makeCoachSpan({
          threadId: thread.id,
          gameId: world.gameId,
          problemId: world.problemId,
          model: asked.model,
          source,
          intent: classified.intent,
          confidence: classified.confidence,
          latencyMs,
          approxPromptTokens,
          approxReplyTokens,
          // What the thread has actually been charged, so `spentTokens` and the
          // span cannot drift apart.
          approxTotalTokens: estimateTurnTokens(learnerTurn) + estimateTurnTokens(coachTurn),
          droppedTurns: window.droppedTurns,
          snapshotStrippedTurns: window.snapshotStrippedTurns,
          guardrailFired,
          redactedReason: screened.ok ? null : screened.redacted.reason,
          turnsInThread: afterCoach.turns.length,
          outcome: outcomeFor(source, guardrailFired, rawReply, asked.error),
          // Only present when a transport actually failed. An unconfigured coach is
          // a mode, not an incident, and `askModel` deliberately leaves it unset.
          ...(asked.error === undefined ? {} : { error: asked.error }),
        }),
      )

      const response: CoachResponse = {
        threadId: thread.id,
        reply: finalText,
        // The original is preserved verbatim so a client can show it under a
        // "this was blocked" disclosure, for a curious learner and for whoever is
        // debugging a model that keeps trying to cheat.
        redacted: screened.ok ? null : screened.redacted,
        source,
        model: asked.model,
        latencyMs,
        approxTokens: afterCoach.spentTokens,
        turnPrompt,
        turns: afterCoach.turns,
        threads: listThreadsForGame(world.gameId),
      }
      return response
    },

    listThreads(gameId) {
      return listThreadsForGame(gameId)
    },
  }
}

// ---------------------------------------------------------------- prompting

/**
 * The system prompt.
 *
 * The rules are the contract's own `COACH_SYSTEM_RULES`, plus two things the model
 * cannot guess:
 *   - the answer is the POSITION of the target, not its value (the value is
 *     already on the board; the position is the thing being learned);
 *   - the snapshot below describes a board that has already moved on.
 *
 * The last clause matters and is easy to miss. The learner opened a panel, the game
 * kept running, and the model is looking at a board from before their last two
 * moves. Without that warning it will confidently coach a board that no longer
 * exists, and a stale-but-plausible answer is worse than a vague one.
 */
function buildSystemPrompt(band: LearnerBand | undefined): string {
  const register =
    band === 'newcomer'
      ? 'The learner is brand new to this. Use the smallest words you can and never assume a term.'
      : band === 'builder'
        ? 'The learner is comfortable with code terms, but still explain any term you do use.'
        : 'The learner knows the basics. Explain any term you do use.'
  return [
    ...COACH_SYSTEM_RULES,
    '',
    'Two things you are not told elsewhere:',
    '- The answer is the POSITION of the target on the board, never its value. The value is already visible to them; the position is what they are learning to find.',
    '- The board description below was taken when they asked. They may have moved since. If it disagrees with what they tell you, believe them.',
    '',
    register,
  ].join('\n')
}

/**
 * The message list actually sent.
 *
 * Snapshots are embedded as compact JSON rather than prose because (a) it is what
 * the budget estimated, and (b) a model parses a flat object more reliably than a
 * sentence describing one. Prose formatting is where models most often get
 * confident about a field that was never there.
 */
function buildMessages(args: {
  system: string
  summary: string
  snapshot: GuidancePromptSnapshot
  turnPrompt: TurnPrompt
  window: ReturnType<typeof assembleWindow>
  question: string
}): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: args.system }]

  const history: string[] = []
  if (args.summary.trim() !== '') {
    history.push('EARLIER IN THIS CONVERSATION (older turns, condensed):', args.summary)
  }
  for (const turn of args.window.turns) {
    if (turn.role === 'learner') {
      const board = turn.snapshot === undefined ? '' : `\n[board at the time: ${serialiseSnapshot(turn.snapshot)}]`
      history.push(`learner: ${turn.text}${board}`)
    } else {
      history.push(`coach: ${turn.text}`)
    }
  }
  if (history.length > 0) messages.push({ role: 'user', content: history.join('\n') })

  messages.push({
    role: 'user',
    content: [
      'THE BOARD RIGHT NOW',
      serialiseSnapshot(args.snapshot),
      '',
      'WHAT THE GAME IS ASKING THEM TO DO NEXT',
      `goal: ${args.turnPrompt.goal}`,
      `instruction: ${args.turnPrompt.instruction}`,
      `why: ${args.turnPrompt.reason}`,
      args.turnPrompt.nudge === null ? '' : `they need: ${args.turnPrompt.nudge.message}`,
      '',
      'Answer their question in your own words. Two or three short sentences.',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  })

  // The current question goes last and alone so it is unmistakably the thing to
  // answer, even when the history is long.
  messages.push({ role: 'user', content: args.question })

  return messages
}

function conversationSummary(summary: string | null): string {
  return summary === null || summary.trim() === '' ? '' : summary
}

// ------------------------------------------------------------- the transport

interface ModelAnswer {
  /** Null means "no model answered"; the caller uses the fallback. */
  readonly text: string | null
  readonly model: string
  readonly error?: string
}

async function askModel(
  transport: ChatTransport | null,
  args: {
    system: string
    summary: string
    snapshot: GuidancePromptSnapshot
    turnPrompt: TurnPrompt
    window: ReturnType<typeof assembleWindow>
    question: string
    band: LearnerBand | undefined
    maxTokens: number
  },
): Promise<ModelAnswer> {
  if (transport === null) {
    // A deliberately unconfigured coach (`COACH_TRANSPORT=0`) is a CONFIGURATION,
    // not a failure, so it is not reported as one. The deterministic path is a
    // first-class mode and the trace should not report it as an incident.
    return { text: null, model: 'fallback' }
  }

  const messages = buildMessages(args)
  try {
    // Two guards, in this order, because the first is free and the second costs a
    // round trip: a missing key is reported without a request, and only a
    // configured transport is asked.
    const available = await transport.isAvailable()
    if (!available) {
      return { text: null, model: 'fallback', error: `transport '${transport.id}' is not configured` }
    }
    const reply = await transport.chat({
      messages,
      maxTokens: args.maxTokens,
      // Lower than the spec tiers: the coach has one job and no need to be
      // surprising. Creativity in a coach is only a way to say the wrong thing
      // confidently.
      temperature: 0.4,
    })
    return { text: reply.text, model: reply.model }
  } catch (error) {
    // A provider failure is a normal event on this path, not a 500: the learner
    // asked a question and still gets an answer.
    return { text: null, model: 'fallback', error: errorText(error) }
  }
}

// ------------------------------------------------------------------- helpers

function makeTurn(
  role: CoachRole,
  text: string,
  at: number,
  snapshot: GuidancePromptSnapshot,
  synthetic: boolean,
): CoachTurn {
  const turn: CoachTurn = {
    id: `turn-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    at,
    approxTokens: estimateTokens(text) + (snapshot === undefined ? 0 : estimateTokens(serialiseSnapshot(snapshot))),
    ...(synthetic ? { synthetic: true } : {}),
    // The snapshot rides on BOTH sides of an exchange, not just the learner's
    // side, so a turn can be read without reaching back to the turn it answered.
    snapshot,
  }
  return turn
}

/**
 * A thread may only be continued within the game that owns it.
 *
 * Without the gameId check, a client holding a thread id from game A could append
 * turns to a thread that is describing game B, and the coach would then answer
 * questions about a board the learner is no longer playing — silently, and in a
 * thread that looks correct. Unknown id and wrong game are the same 404 for the
 * same reason: from the caller's point of view there is no such thread.
 */
function resolveThread(threadId: string, world: CoachWorld): CoachThread {
  const thread = getThread(threadId)
  if (thread === undefined) throw new UnknownCoachThreadError(threadId)
  if (thread.gameId !== world.gameId) throw new UnknownCoachThreadError(threadId)
  return thread
}

/**
 * The one word a log reader needs, so they never have to combine three booleans
 * to answer "did this work?".
 *
 * ORDER MATTERS. `source` is checked before `rawReply` because an empty `rawReply`
 * only MEANS something on the model path: on the fallback path there was no reply
 * to be empty, and reporting "the model returned nothing" when no model was
 * consulted sends whoever is on call looking for the wrong outage.
 */
function outcomeFor(
  source: 'model' | 'fallback',
  guardrailFired: boolean,
  rawReply: string,
  error: string | undefined,
): CoachOutcome {
  if (error !== undefined) return 'transport-unavailable'
  if (source === 'fallback') return 'answered-fallback'
  if (rawReply.trim() === '') return 'empty-reply-fell-back'
  return guardrailFired ? 'answered-after-rewrite' : 'answered'
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

// ------------------------------------------------------------ the singleton

let instance: CoachService | null = null
let transportPromise: Promise<ChatTransport | null> | null = null

/**
 * The process-wide coach, built from the environment on first use.
 *
 * Built LAZILY and held in a module singleton rather than constructed in
 * `index.ts` and threaded through `AppDeps`, so wiring the coach does not touch
 * the shared app signature and cannot be half-done.
 *
 * The TRANSPORT is resolved lazily too, and asynchronously, because choosing one
 * asks each candidate whether it is configured. Resolving it on the first question
 * rather than at boot matters: a process that starts before the environment is
 * fully populated should not be stuck with "no transport" forever, and the check
 * itself costs nothing (both transports read the environment, no network).
 *
 * `COACH_TRANSPORT=0` forces the deterministic path, which is what the test suite
 * relies on and what a demo without a key should get.
 */
export function getCoachService(env: NodeJS.ProcessEnv = process.env): CoachService {
  if (instance !== null) return instance

  if (env.COACH_TRANSPORT === '0' || env.COACH_TRANSPORT === 'off') {
    instance = createCoachService({ transport: null })
    return instance
  }

  // Cached as a promise, so a burst of concurrent first questions all await ONE
  // resolution instead of each starting their own.
  if (transportPromise === null) transportPromise = defaultChatTransport(env)
  // The service is created synchronously with a deferred lookup, so `ask` stays the
  // only async entry point and the route has nothing extra to await or handle.
  instance = createCoachService({
    transport: {
      id: 'deferred',
      get model(): string {
        return 'unresolved'
      },
      isAvailable: async () => {
        transportPromise = transportPromise ?? defaultChatTransport(env)
        return (await transportPromise) !== null
      },
      chat: async (request) => {
        transportPromise = transportPromise ?? defaultChatTransport(env)
        const resolved = await transportPromise
        if (resolved === null) throw new Error('no coach transport is configured')
        return resolved.chat(request)
      },
    },
  })
  return instance
}

/** Test hook: install a specific service (or reset to the env-built one). */
export function setCoachService(service: CoachService | null): void {
  instance = service
}

/** Test hook: reset so the next `getCoachService` re-reads the environment. */
export function resetCoachService(): void {
  instance = null
  transportPromise = null
}
