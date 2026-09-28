/**
 * One structured line per coach call.
 *
 * WHY A SPAN AND NOT A LOG LINE: the questions this file exists to answer are all
 * cross-cutting — "is the guardrail firing constantly?", "are we paying for long
 * threads we throw away?", "is the fallback carrying more load than the model?".
 * None of those is visible in a per-request log, and all of them are the ones that
 * decide whether this feature is affordable. So the record is flat JSON with fixed
 * keys and a stable event name, which makes it greppable (`grep '"event":"coach"'`)
 * and countable without a tracing backend.
 *
 * DELIBERATELY NOT LOGGED: the learner's message, the coach's reply, and the
 * board. This is a children's game; the questions are in their own words and the
 * board is their game. Token counts and booleans answer every operational question
 * without writing a single word the learner said to disk. `redactedReason` is safe
 * because it is a rule id plus a matched pattern, not the sentence.
 */

export type CoachOutcome =
  | 'answered'
  | 'answered-after-rewrite'
  | 'answered-fallback'
  | 'answered-fallback-after-rewrite'
  | 'empty-reply-fell-back'
  | 'transport-unavailable'

export interface CoachSpan {
  readonly event: 'coach'
  readonly threadId: string
  readonly gameId: string
  readonly problemId: string
  /** The transport that answered, or `'fallback'`. */
  readonly model: string
  readonly source: 'model' | 'fallback'
  readonly intent?: string
  readonly confidence?: number
  readonly latencyMs: number
  readonly approxPromptTokens: number
  readonly approxReplyTokens: number
  /** Total cost folded into `CoachThread.spentTokens` for this turn. */
  readonly approxTotalTokens: number
  /** Turns that did not fit the window. */
  readonly droppedTurns: number
  /** Turns that survived only because their snapshot was stripped. */
  readonly snapshotStrippedTurns: number
  readonly guardrailFired: boolean
  /** Which rule fired, or `null`. */
  readonly redactedReason: string | null
  readonly turnsInThread: number
  readonly outcome: CoachOutcome
  /** Present only on an unexpected transport failure; already truncated. */
  readonly error?: string
}

const MAX_ERROR_CHARS = 300

/**
 * Emit the span. Total: a tracing failure must never fail a learner's question.
 *
 * The only way to lose the line is for `console.log` itself to throw, which is
 * worth swallowing — a broken stdout must not become a 500 on `/api/coach/ask`.
 */
export function traceCoachCall(span: CoachSpan): void {
  try {
    console.log(JSON.stringify(span))
  } catch {
    // A trace is diagnostics, not behaviour.
  }
}

/** Build a span, normalising the fields most likely to be wrong at the boundary. */
export function makeCoachSpan(input: {
  threadId: string
  gameId: string
  problemId: string
  model: string
  source: 'model' | 'fallback'
  intent?: string
  confidence?: number
  latencyMs: number
  approxPromptTokens: number
  approxReplyTokens: number
  approxTotalTokens: number
  droppedTurns: number
  snapshotStrippedTurns: number
  guardrailFired: boolean
  redactedReason: string | null
  turnsInThread: number
  outcome: CoachOutcome
  error?: string
}): CoachSpan {
  const span: CoachSpan = {
    event: 'coach',
    threadId: input.threadId,
    gameId: input.gameId,
    problemId: input.problemId,
    model: input.model,
    source: input.source,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    approxPromptTokens: Math.max(0, Math.round(input.approxPromptTokens)),
    approxReplyTokens: Math.max(0, Math.round(input.approxReplyTokens)),
    approxTotalTokens: Math.max(0, Math.round(input.approxTotalTokens)),
    droppedTurns: Math.max(0, input.droppedTurns),
    snapshotStrippedTurns: Math.max(0, input.snapshotStrippedTurns),
    guardrailFired: input.guardrailFired,
    redactedReason: input.redactedReason,
    turnsInThread: Math.max(0, input.turnsInThread),
    outcome: input.outcome,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    ...(input.error === undefined ? {} : { error: input.error.slice(0, MAX_ERROR_CHARS) }),
  }
  return span
}
