/**
 * Token budgeting for multi-turn coach conversations.
 *
 * THE PROBLEM THIS SOLVES: a single-turn call cannot fail on size, but a
 * conversation grows without bound. Left alone, a learner who chats for twenty
 * turns eventually sends a prompt the provider rejects with a 400 — and a 400 on
 * the coach is indistinguishable to a learner from "the coach broke". The
 * contract (`COACH_BUDGET`) requires the window to be sized BEFORE sending, with
 * headroom for the reply, so truncation is a normal path rather than a failure.
 *
 * NEVER TRUST THE MODEL'S COUNT. Providers report `usage` in vendor-specific
 * tokenisations that disagree with each other by 20%+, several omit the field
 * entirely, and none of them are the tokeniser the NEXT request will be billed
 * against. Every number here is a local `chars / 4` estimate, which is the
 * industry floor for English prose. It is deliberately a floor, not a mean: see
 * the `replyReserveTokens` headroom, which exists to absorb the error.
 */

import { COACH_BUDGET } from '@dsa/game-schema'
import type { CoachTurn } from '@dsa/game-schema'

/**
 * Local token estimate: ~4 characters per token.
 *
 * WHY NOT A REAL TOKENISER: a real one is a model-specific dependency (tiktoken
 * for GPT, a sentencepiece for Llama, Google's own for Gemini) and we do not know
 * which model will answer. A single provider-independent floor plus explicit
 * headroom is both cheaper and more honest than a precise number for the wrong
 * model. The comparison below (4 chars) is a floor: it UNDER-counts code and
 * punctuation-heavy text, which is exactly why the reserve is a real budget and
 * not a rounding error.
 */
export function estimateTokens(text: string): number {
  if (text === '') return 0
  return Math.ceil(text.length / 4)
}

export interface CoachBudget {
  readonly maxPromptTokens: number
  readonly replyReserveTokens: number
  readonly maxTurns: number
}

export const DEFAULT_BUDGET: CoachBudget = COACH_BUDGET

export interface AssembledWindow {
  /** The turns to actually send, oldest first, in the order they happened. */
  readonly turns: CoachTurn[]
  /** Rolling summary of what was dropped, merged with the previous one. */
  readonly summary: string | null
  /** Local estimate of the tokens this window occupies. */
  readonly approxPromptTokens: number
  /** How many turns did not make it into the window at all. */
  readonly droppedTurns: number
  /** Turns that survived only because their snapshot was stripped. */
  readonly snapshotStrippedTurns: number
  /** Ids of turns whose text was shortened to fit. */
  readonly truncatedTurnIds: string[]
}

/** Summary growth is itself a budget: a rolling summary must not become a log. */
const MAX_SUMMARY_LINES = 10
const MAX_SUMMARY_LINE_CHARS = 96
const MAX_SUMMARY_CHARS = 900
const MIN_SNIPPET_CHARS = 28

/**
 * Size the window to send, and account for what was left behind.
 *
 * TWO INDEPENDENT LIMITS, applied in this order:
 *   1. `maxTurns` — a count cap, so a thread of tiny messages cannot send 400
 *      turns just because they happen to fit. Cheapest to apply, so it goes first.
 *   2. `maxPromptTokens - replyReserveTokens` — a weight cap.
 *
 * WHY THE NEWEST TURN IS NEVER DROPPED: the current question is the only part of
 * the context that cannot be recovered. An older turn can be re-read by the
 * learner; this one cannot. So the walk runs newest-first, and the last seat is
 * filled with a truncated copy of the newest turn rather than left empty. A
 * window with no recent question is not a conversation, it is a monologue.
 */
export function assembleWindow(
  turns: readonly CoachTurn[],
  budget: CoachBudget = DEFAULT_BUDGET,
  priorSummary: string | null = null,
): AssembledWindow {
  const usable = Math.max(0, budget.maxPromptTokens - budget.replyReserveTokens)
  const capped = turns.length > budget.maxTurns ? turns.slice(-budget.maxTurns) : turns.slice()

  // Oldest-first cost, so the walk can be a simple running total.
  const costs = capped.map((turn) => estimateTurnTokens(turn))

  const kept: CoachTurn[] = []
  const dropped: CoachTurn[] = []
  const truncatedTurnIds: string[] = []
  let snapshotStrippedTurns = 0
  let spent = 0

  for (let i = capped.length - 1; i >= 0; i -= 1) {
    const turn = capped[i]
    const cost = costs[i]
    // `noUncheckedIndexedAccess`: the two lookups above are index-aligned by
    // construction, so the guard is a type assertion made explicit rather than
    // an assumption hidden in a cast.
    if (turn === undefined || cost === undefined) continue

    if (spent + cost <= usable) {
      kept.push(turn)
      spent += cost
      continue
    }

    if (turn.snapshot !== undefined) {
      // The degradation step that matters: try again with the board gone.
      const stripped: CoachTurn = { ...turn, snapshot: undefined }
      const strippedCost = estimateTurnTokens(stripped)
      if (spent + strippedCost <= usable) {
        snapshotStrippedTurns += 1
        kept.push(stripped)
        spent += strippedCost
        continue
      }
    }

    if (kept.length === 0) {
      // Newest-turn guarantee. Trim the prose to whatever room is left rather
      // than sending a question with no context, and record that we did it.
      const fitted = fitTurnToBudget(turn, usable)
      if (fitted !== null) {
        kept.push(fitted.turn)
        spent += fitted.cost
        if (fitted.turn.text !== turn.text) truncatedTurnIds.push(turn.id)
        if (fitted.turn.snapshot === undefined && turn.snapshot !== undefined) {
          snapshotStrippedTurns += 1
        }
      } else {
        dropped.push(turn)
      }
      continue
    }

    dropped.push(turn)
  }

  kept.reverse()

  // The walk ran newest-first, so `dropped` is in reverse chronological order.
  // It has to be flipped before the summary is built or every line reads "I said X;
  // you asked Y" — which reads as the coach answering before it was asked, and
  // teaches a model the wrong thing about the order of a conversation.
  dropped.reverse()

  // The turns the COUNT cap removed are older than any turn the weight walk
  // dropped, so they go in front: history stays in order end to end.
  const overCount = turns.length - capped.length
  const overCountTurns = overCount > 0 ? turns.slice(0, overCount) : []
  const everythingDropped = [...overCountTurns, ...dropped]

  const fresh = summariseTurns(everythingDropped)
  const summary = mergeSummaries(priorSummary, fresh)
  const approxPromptTokens = kept.reduce((sum, turn) => sum + estimateTurnTokens(turn), 0)

  return {
    turns: kept,
    summary,
    approxPromptTokens,
    droppedTurns: everythingDropped.length,
    snapshotStrippedTurns,
    truncatedTurnIds,
  }
}

/**
 * A turn's cost is its words PLUS its board, and the board is the expensive part.
 *
 * A 16-cell board serialised as JSON is roughly 700 characters to a child's
 * fifteen-word question, so a snapshot can be forty times the cost of the text it
 * accompanies. That asymmetry is the whole reason the drop order below matters.
 */
export function estimateTurnTokens(turn: CoachTurn): number {
  const text = estimateTokens(turn.text)
  if (turn.snapshot === undefined) return text
  return text + estimateTokens(serialiseSnapshot(turn.snapshot))
}

/** Stable, compact JSON. A model reads this shape well and it is cheap. */
export function serialiseSnapshot(snapshot: NonNullable<CoachTurn['snapshot']>): string {
  return JSON.stringify(snapshot)
}

/**
 * Shorten a turn until it fits, or admit it cannot.
 *
 * Order inside the fallback: shed the board before touching the words, then cut
 * the words at a sentence boundary if there is one, then mid-word as a last
 * resort. Cutting prose mid-word produces an obviously truncated string, which is
 * the correct signal — a learner must never be shown a half-finished coach
 * sentence and believe it is the whole thought.
 */
function fitTurnToBudget(turn: CoachTurn, budget: number): { turn: CoachTurn; cost: number } | null {
  const withoutSnapshot: CoachTurn = turn.snapshot === undefined ? turn : { ...turn, snapshot: undefined }
  if (estimateTurnTokens(withoutSnapshot) <= budget) {
    return { turn: withoutSnapshot, cost: estimateTurnTokens(withoutSnapshot) }
  }
  if (budget <= 0) return null

  // Leave room for the role/id envelope, which is pure overhead in our estimate.
  const textRoom = budget * 4 - 24
  if (textRoom <= 0) return null

  const shortened = shortenText(turn.text, textRoom)
  if (shortened === '') return null
  const candidate: CoachTurn = { ...withoutSnapshot, text: shortened }
  const cost = estimateTurnTokens(candidate)
  if (cost > budget) return null
  return { turn: candidate, cost }
}

function shortenText(text: string, maxChars: number): string {
  if (maxChars <= 1) return ''
  if (text.length <= maxChars) return text
  const clipped = text.slice(0, maxChars - 1)
  const lastBreak = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('? '), clipped.lastIndexOf('! '))
  if (lastBreak > MIN_SNIPPET_CHARS) return `${clipped.slice(0, lastBreak + 1).trim()}…`
  const lastSpace = clipped.lastIndexOf(' ')
  const body = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped
  return `${body.trim()}…`
}

/**
 * One short line per exchange, not per turn.
 *
 * A learner asking a question and the coach answering it are ONE fact about the
 * conversation ("asked about the middle; I explained halving"). Emitting two
 * lines for one exchange doubles the summary's length for zero extra meaning, and
 * the summary is the thing that has to stay short.
 */
function summariseTurns(turns: readonly CoachTurn[]): string {
  const lines: string[] = []
  let i = 0
  while (i < turns.length) {
    const turn = turns[i]
    if (turn === undefined) {
      i += 1
      continue
    }
    if (turn.role === 'learner') {
      const next = turns[i + 1]
      if (next !== undefined && next.role === 'coach') {
        lines.push(`asked ${snippet(turn.text)}; I answered ${snippet(next.text)}`)
        i += 2
        continue
      }
      lines.push(`asked ${snippet(turn.text)}`)
      i += 1
      continue
    }
    if (turn.role === 'coach') {
      lines.push(`I said ${snippet(turn.text)}`)
      i += 1
      continue
    }
    i += 1
  }
  if (lines.length === 0) return ''
  return lines.slice(-MAX_SUMMARY_LINES).join('\n')
}

function snippet(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ')
  if (flat === '') return 'something'
  if (flat.length <= MAX_SUMMARY_LINE_CHARS) return `"${flat}"`
  return `"${flat.slice(0, MAX_SUMMARY_LINE_CHARS - 4).trimEnd()}…"`
}

/**
 * Fold a new summary into the previous one, keeping it bounded.
 *
 * The previous summary is kept even though it describes turns that were dropped
 * long ago, because a learner who asks "no, I meant the other one" three questions
 * later is relying on exactly that. Newer lines win when the bound bites: the
 * current question matters more than the first one of the session.
 */
function mergeSummaries(prior: string | null, fresh: string): string | null {
  const combined = [prior?.trim(), fresh.trim()].filter((part) => part !== undefined && part !== '').join('\n')
  if (combined === '') return null

  let lines = combined.split('\n').filter((line) => line.trim() !== '')
  if (lines.length > MAX_SUMMARY_LINES) lines = lines.slice(-MAX_SUMMARY_LINES)

  let out = lines.join('\n')
  while (out.length > MAX_SUMMARY_CHARS && lines.length > 1) {
    lines = lines.slice(1)
    out = lines.join('\n')
  }
  if (out.length > MAX_SUMMARY_CHARS) {
    out = `…${out.slice(out.length - MAX_SUMMARY_CHARS + 1)}`
  }
  return out
}

/**
 * Lower `maxPromptTokens` by a fixed preamble, keeping the reserve intact.
 *
 * The system prompt and the dropped-turn summary are real tokens on the wire but
 * are not "turns", so they never appear in `turns` and cannot be measured by
 * walking it. Ignoring them is precisely how a carefully-sized window still
 * overflows on the wire, so callers shrink the ceiling by the exact cost of the
 * preamble they are about to send. The reply reserve is deliberately NOT
 * consumed here: that headroom is for the answer, not for our own instructions.
 */
export function budgetAfterPreamble(
  preamble: readonly string[],
  budget: CoachBudget = DEFAULT_BUDGET,
): CoachBudget {
  const spent = preamble.reduce((sum, part) => sum + estimateTokens(part), 0)
  return { ...budget, maxPromptTokens: Math.max(budget.replyReserveTokens + 1, budget.maxPromptTokens - spent) }
}
