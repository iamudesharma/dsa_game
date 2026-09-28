/**
 * The deterministic coach.
 *
 * WHY THIS EXISTS:
 * A coach that says "have another go" when the network is down is worse than no
 * coach at all: the learner has opened a panel, asked a real question, and been
 * told nothing. So the fallback answers from the SNAPSHOT and the engine's
 * `TurnPrompt`, which means it works with no key, no network and no model.
 *
 * It is also the path every test exercises, which is the real reason it has to be
 * good rather than a stub. A stub would let the guardrail, budget and route
 * suites pass while the actual product shipped a robot.
 *
 * ---------------------------------------------------------------------
 * WHY A CLASSIFIER AND NOT A TEMPLATE LIST
 *
 * The five intents below are what a learner actually asks mid-game. Keying on
 * them means the fallback is not "generic advice with the board bolted on": each
 * answer is built from numbers that are on the board RIGHT NOW, so "which half"
 * gets an answer about the current window and not a platitude about halves.
 *
 * The classifier is scored, not a switch, so "no, I meant the other one" still
 * lands on the same intent as the first attempt and the learner gets a coherent
 * second answer rather than a shrug. And it runs BEFORE the reply is screened,
 * so the fallback is held to the same no-answer rule as the model: a deterministic
 * path that could leak would be a hole straight through the guardrails.
 */

import type { GuidancePromptSnapshot, LearnerBand, TurnPrompt } from '@dsa/game-schema'

import { screenCoachReply } from './guardrails.js'

export type CoachIntent =
  | 'greeting'
  | 'which-value'
  | 'which-half'
  | 'why-wrong'
  | 'what-now'
  | 'general'

export interface FallbackInput {
  readonly question: string
  readonly snapshot: GuidancePromptSnapshot
  readonly turnPrompt: TurnPrompt
  readonly band?: LearnerBand
  /** Hints already given, so the fallback does not repeat itself. */
  readonly givenHints?: readonly string[]
}

export interface FallbackAnswer {
  readonly text: string
  readonly intent: CoachIntent
  readonly confidence: number
}

/** The vocabulary a band uses. Small on purpose: a band is a register, not a persona. */
const BAND_TONE: Readonly<Record<LearnerBand, 'short' | 'plain' | 'plain'>> = {
  newcomer: 'short',
  explorer: 'plain',
  builder: 'plain',
}

/**
 * Intent keywords.
 *
 * Weights, not booleans, because a single phrase can be ambiguous: "which one
 * should I press, the left or the right" is a `which-half` question that also
 * contains "which one". The heaviest match wins, so the more specific intent is
 * checked first and gets a higher weight.
 */
const INTENTS: readonly IntentDef[] = [
  {
    intent: 'which-half',
    weight: 3,
    patterns: [
      /\bwhich\s+(?:half|side|way|direction|one\s+of\s+the\s+two)\b/,
      /\b(?:left|right)\s+(?:or|vs\.?|versus)\b/,
      /\bshould\s+(?:i|we)\s+go\b/,
      /\bgo\s+(?:left|right|up|down)\b/,
      /\bkeep\s+(?:which|the)\b/,
      /\bwhich\s+(?:end|edge)\b/,
    ],
  },
  {
    intent: 'which-value',
    weight: 3,
    patterns: [
      /\bwhich\s+(?:value|number|one|stone|card|item|cell|box|tile|object)\b/,
      /\bwhat\s+(?:value|number)\b/,
      /\bwhat'?s\s+in\s+the\s+middle\b/,
      /\b(?:compare|how\s+does)\s+.{0,24}\b(?:compare|differ)\b/,
      /\bhow\s+do\s+i\s+compare\b/,
      /\bis\s+it\s+(?:bigger|smaller|higher|lower)\b/,
    ],
  },
  {
    intent: 'why-wrong',
    weight: 3,
    patterns: [
      /\bwhy\s+(?:is|was|are|were|am|did|do|does|doesn'?t|can'?t|isn'?t)\b/,
      /\b(?:wrong|incorrect|mistake|failed|fail|didn'?t\s+work|not\s+working)\b/,
      /\bi\s+clicked\b.*\bbut\b/,
      /\bwhat\s+happened\b/,
      /\bit\s+said\b.*\b(?:no|wrong|again)\b/,
    ],
  },
  {
    intent: 'what-now',
    weight: 2,
    patterns: [
      /\bwhat\s+(?:now|do\s+i\s+do|should\s+i\s+do|next)\b/,
      /\b(?:next|now)\s*[?.!]?\s*$/,
      /\b(?:hint|help|stuck|lost|confused|no\s+idea|don'?t\s+know)\b/,
      /\bwhat\s+is\s+this\b/,
      /\bhow\s+do\s+i\s+(?:play|start|begin|win)\b/,
    ],
  },
  {
    intent: 'greeting',
    weight: 1,
    patterns: [
      /^\s*(?:hi|hey|hello|yo|sup|hiya|good\s+morning|good\s+evening)\b/,
      /\b(?:thanks|thank\s+you|cheers|ok|okay|k|cool|nice|bye|goodbye)\b/,
    ],
  },
]

interface IntentDef {
  readonly intent: CoachIntent
  readonly weight: number
  readonly patterns: readonly RegExp[]
}

/** Classify the learner's words. Scored, so mixed questions still resolve. */
export function classifyIntent(question: string): { intent: CoachIntent; confidence: number } {
  const text = question.toLowerCase()
  const scores = INTENTS.map((def) => ({
    intent: def.intent,
    score: def.weight * def.patterns.filter((pattern) => pattern.test(text)).length,
  })).sort((a, b) => b.score - a.score)

  const top = scores[0]
  if (top === undefined || top.score === 0) return { intent: 'general', confidence: 0.2 }
  // Confidence is the MARGIN over the runner-up, not the raw score, so a question
  // that matches two intents equally reports low confidence and a client could ask
  // instead of pretending to understand.
  const margin = top.score - (scores[1]?.score ?? 0)
  return { intent: top.intent, confidence: Math.min(0.95, 0.5 + margin * 0.1) }
}

/**
 * Produce the deterministic answer, then hold it to the same guardrail as a model
 * reply.
 *
 * The screening pass is not ceremonial. A template that interpolates a board value
 * could one day interpolate the wrong board value, and the guardrail is the only
 * thing standing between a formatting change and a spoiler. Running it here means
 * the invariant is tested on BOTH paths.
 */
export function fallbackAnswer(input: FallbackInput): FallbackAnswer {
  const { intent, confidence } = classifyIntent(input.question)
  const text = build(intent, input)
  const screened = screenCoachReply(text, input.snapshot)
  // A rewrite here would mean the fallback itself tripped a rule, which is a bug
  // in this file rather than a learner-facing event. The original is still
  // returned so the failure is visible rather than silent.
  return { text: screened.ok ? screened.text : text, intent, confidence }
}

/**
 * Pick an answer, preferring the classified intent and falling through to the
 * others.
 *
 * The fall-through is not padding: a classifier that guessed wrong should still
 * produce a board-specific answer, because "I did not understand" is the one
 * reply guaranteed to teach nothing. Every branch below is built from the snapshot,
 * so any of them is a real answer about this board.
 */
function build(intent: CoachIntent, input: FallbackInput): string {
  const { snapshot, turnPrompt, band } = input
  const tone = BAND_TONE[band ?? 'explorer']
  const avoid = input.givenHints ?? []

  const answers: Record<CoachIntent, string> = {
    'which-value': answerWhichValue(snapshot, tone),
    'which-half': answerWhichHalf(snapshot, turnPrompt),
    'why-wrong': answerWhyWrong(snapshot),
    'what-now': answerWhatNow(snapshot, turnPrompt, tone),
    greeting: answerGreeting(snapshot),
    general: answerGeneral(snapshot, turnPrompt),
  }

  // 'general' is the catch-all, so it goes LAST as a fallback: a question the
  // classifier could not place is best served by the broad board summary.
  const order: CoachIntent[] = [
    ...(intent === 'general' ? [] : [intent]),
    ...INTENT_FALLBACK_ORDER,
    'general',
  ]

  for (const candidate of order) {
    const text = answers[candidate]
    if (text === undefined || text.trim() === '') continue
    // Do not repeat: a coach that says the same sentence twice teaches nothing and
    // reads as a broken parrot.
    if (avoid.some((hint) => similar(hint, text))) continue
    return text
  }
  return answers.general
}

/** Tried, in order, when the classified intent's answer was already given. */
const INTENT_FALLBACK_ORDER: readonly CoachIntent[] = [
  'what-now',
  'which-value',
  'which-half',
  'why-wrong',
  'greeting',
]

// -------------------------------------------------------------- the answers

/**
 * "Which one?" — the most common question, and the one where naming a value is
 * SAFE and naming a position is not. The learner is asking what to compare, so the
 * answer hands them the two values to compare and asks which way they go. It never
 * resolves the comparison for them, because that resolution IS the move.
 */
function answerWhichValue(snapshot: GuidancePromptSnapshot, tone: 'short' | 'plain'): string {
  const { mid, targetValue, targetLabel } = snapshot
  const target = article(targetLabel)
  if (mid === null) {
    const first = snapshot.board[0]?.label ?? 'value'
    const last = snapshot.board[snapshot.board.length - 1]?.label ?? 'value'
    return `There is no single middle yet, so start from an end. Read ${first} at one end and ${last} at the other, and compare those against ${target}.`
  }
  const held = labelFor(snapshot, mid)
  if (targetValue === null) {
    return `The one you are holding is ${held}. Read it, then decide which way it goes against ${target}.`
  }
  const lead = tone === 'short' ? `${held} is what you are holding.` : `Right now the one you are holding is ${held}.`
  // The comparison is ASKED, never made. Resolving it here would be the move.
  return `${lead} ${target} is ${targetValue}, so all you have to do is ask yourself: is ${held} bigger than ${targetValue}, smaller, or exactly equal?`
}

/**
 * "Which half?" — answered with the RULE, never with the half.
 *
 * The learner does not know which half survives yet, and telling them is the entire
 * move. So this explains how to work it out from the value they just read, and is
 * safe to give at any point in the game, which is why it can answer the very first
 * question.
 *
 * It deliberately does NOT branch on whether the held value equals the target. That
 * comparison is the answer — `mid === targetIndex` on the winning turn — so a
 * branch that said "it is here" would be a spoiler written in a deterministic path
 * that the guardrail would have no reason to suspect. The fallback is allowed to
 * know the answer. It is not allowed to use it.
 */
function answerWhichHalf(snapshot: GuidancePromptSnapshot, turnPrompt: TurnPrompt): string {
  const { lo, hi, mid, targetLabel } = snapshot
  const held = mid === null ? null : labelFor(snapshot, mid)
  const target = article(targetLabel)

  if (held === null) {
    return `You cannot pick a half until you have read a value. ${turnPrompt.reason}`
  }
  return `Only one side of ${held} can still hold ${target}. ${boundsPhrase(lo, hi)}, so throw away whichever side ${held} is on and keep the other — the side the value is not sitting on. Say which one that is, and we go on.`
}

/**
 * "Why was that wrong?" — answered from the engine's own record.
 *
 * The oracle already knows what the learner was supposed to do (`outcome.expected`)
 * and what it did instead. The fallback does NOT restate the expected action: that
 * action is often the next move, and restating it is a solution. It names the
 * OPERATION that was mis-played and re-frames the rule, which is what teaches.
 */
function answerWhyWrong(snapshot: GuidancePromptSnapshot): string {
  const op = snapshot.lastMistakeDsaOp

  if (op === null) {
    if (snapshot.mistakes === 0) {
      // Still board-specific: naming the value in hand gives the learner something
      // to go and look at, which is what they wanted when they asked why.
      const held = snapshot.mid === null ? null : labelFor(snapshot, snapshot.mid)
      const where = held === null ? snapshot.instruction : `You are holding ${held} and nothing has gone wrong yet`
      return `${where}. ${snapshot.instruction}`
    }
    return 'I cannot see which move you are asking about, so tell me the one just before the screen changed, and we will work out what it should have been.'
  }

  const lead: Record<string, string> = {
    compare: 'The comparison was the part that went wrong',
    'choose-path': 'The half you kept was the part that went wrong',
    read: 'The value you chose to read was the part that went wrong',
    assign: 'The edge you moved was the part that went wrong',
    terminate: 'The answer you committed was the part that went wrong',
  }
  const reason: Record<string, string> = {
    compare: 'a comparison is not a guess — hold both values in your head and say which is larger before you touch anything',
    'choose-path': 'the value you read decides the half, and reading it carefully costs nothing',
    read: 'the middle is a calculation, not a hunch: take the two edges you are left with and halve the distance between them',
    assign: 'moving an edge is how you throw a half away, so move it to just past what you ruled out',
    terminate: 'only commit once the window is down to something you can read yourself',
  }
  const opener = lead[op] ?? 'That move did not land'
  const detail = reason[op] ?? 'go back one move and take it again, this time from the values'
  const tail = ` You are ${wordCount(snapshot.step)} ${snapshot.step === 1 ? 'move' : 'moves'} in, and ${snapshot.mistakes} of ${snapshot.mistakes === 1 ? 'them has' : 'them have'} not landed — that is information, not failure.`
  return `${opener}: ${detail}.${tail}`
}

/**
 * "What now?" — the engine's own instruction, plus why it matters, plus where the
 * learner actually is.
 *
 * The instruction comes from the engine's oracle-derived prompt, so it is the one
 * line on the server guaranteed to describe a legal next move and guaranteed not to
 * contain the answer. Restating it is honest; paraphrasing it would not be.
 *
 * The board facts are appended because the instruction alone is too thin to answer
 * the question on its own. The engine's line is written for a UI that is already
 * showing the board ("take a pressure pod in hand"), which is right there and not
 * right in a chat panel where the learner has to picture the board from memory. So
 * the answer names what is in hand and what is still in play — without resolving
 * anything, which is the line this whole file walks.
 */
function answerWhatNow(snapshot: GuidancePromptSnapshot, turnPrompt: TurnPrompt, tone: 'short' | 'plain'): string {
  if (snapshot.phase === 'won') {
    return `You found it, and that is the whole algorithm. ${turnPrompt.reason} Open the debrief to watch your moves run next to the real code.`
  }
  if (snapshot.phase === 'lost') {
    return `This run is over, so there is no next move to give you. ${turnPrompt.reason} Undo a step and try that move again, or read the debrief to see the run the algorithm would have played.`
  }
  const instruction = turnPrompt.instruction.trim()
  const why = turnPrompt.reason.trim()
  const where = whereYouAre(snapshot)
  if (tone === 'short') return `${where} ${instruction} ${why}`
  return `${where}\n\nNext: ${lowerFirst(instruction)}\n\nWhy it matters: ${lowerFirst(why)}`
}

/**
 * One sentence about the live board. Never resolves a comparison — it reports what
 * is in hand and what is left, and stops there.
 */
function whereYouAre(snapshot: GuidancePromptSnapshot): string {
  const left = snapshot.board.length - snapshot.eliminated.length
  const held = snapshot.mid === null ? null : labelFor(snapshot, snapshot.mid)
  if (held === null) {
    return `${boundsPhrase(snapshot.lo, snapshot.hi)}, with ${String(left)} of ${String(snapshot.board.length)} values still to play.`
  }
  return `${boundsPhrase(snapshot.lo, snapshot.hi)}; you are holding ${held}, and ${String(left)} of ${String(snapshot.board.length)} values are still in play.`
}

function answerGreeting(snapshot: GuidancePromptSnapshot): string {
  const left = snapshot.board.length - snapshot.eliminated.length
  const where =
    snapshot.mid === null
      ? `nothing has been looked at yet, so the whole row is still in play`
      : `you are holding ${labelFor(snapshot, snapshot.mid)}, and ${left} of ${snapshot.board.length} values are still in play`
  return `Hello! Ask me anything about the board. Right now ${where}. ${lowerFirst(snapshot.instruction)}`
}

/**
 * Anything else. Not an apology and not "I did not understand" — a board fact plus
 * an invitation, because almost every unclassified question is a learner pointing
 * at the board without knowing what to call it.
 */
function answerGeneral(snapshot: GuidancePromptSnapshot, turnPrompt: TurnPrompt): string {
  const { lo, hi, mid, eliminated, board, targetValue, targetLabel } = snapshot
  const parts: string[] = []
  parts.push(
    `Here is where you are: ${boundsPhrase(lo, hi)}, with ${board.length - eliminated.length} of ${board.length} values still in play.`,
  )
  if (mid !== null && targetValue !== null) {
    parts.push(`The one you are holding is ${labelFor(snapshot, mid)}, and ${article(targetLabel)} is ${targetValue}.`)
  }
  parts.push(`That comparison is the only thing that decides your next move, so start there. ${lowerFirst(turnPrompt.reason)}`)
  return parts.join(' ')
}

// ------------------------------------------------------------------- helpers

/**
 * The two ends, described WITHOUT naming a position as the answer.
 *
 * Saying "between 3 and 7" is safe — those are the current window, which the board
 * already shows, and the guardrail's soft pass-through exists precisely to let this
 * kind of sentence through. Saying "at 5" is not. So this helper only ever emits
 * BOUNDS.
 */
function boundsPhrase(lo: number | null, hi: number | null): string {
  if (lo === null || hi === null) return 'The whole row is still in play'
  if (lo === hi) return `Only the one value in the middle of the row is still in play`
  return `Everything still in play sits between ${lo} and ${hi}`
}

function labelFor(snapshot: GuidancePromptSnapshot, index: number): string {
  const entry = snapshot.board[index]
  if (entry === undefined) return 'the one you are holding'
  return entry.value === null ? entry.label : String(entry.value)
}

function wordCount(n: number): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  return words[n] ?? String(n)
}

/** Cheap similarity: a fallback that repeats itself verbatim is a broken parrot. */
function similar(a: string, b: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a))
}

function lowerFirst(text: string): string {
  const first = text[0]
  if (first === undefined) return text
  return `${first.toLowerCase()}${text.slice(1)}`
}

/**
 * `pressure hull` -> `the pressure hull`.
 *
 * A `GameSpec`'s `vocabulary.target` is a bare noun, so the coach owns the article.
 * Getting it wrong in a dozen places is how a product ends up saying "against
 * pressure hull" in one reply and "the pressure hull" in the next, which reads to a
 * learner as two different objects on the board.
 */
function article(label: string): string {
  const trimmed = label.trim()
  if (trimmed === '') return 'the target'
  return /^(the|a|an|my|your|this|that)\b/i.test(trimmed) ? trimmed : `the ${trimmed}`
}
