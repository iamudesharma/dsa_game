/**
 * THE HINT SAFETY SCREEN.
 *
 * WHY THIS FILE EXISTS. `services/api/src/coach/guardrails.ts` is 610 lines of
 * adversarial filtering whose stated principle is that "a prompt rule is a
 * suggestion; a validator is a guarantee". That validator protected the COACH
 * and nothing else. The HINT path had no validator at all, and on the default
 * template tier it shipped this, with no API key configured:
 *
 *     HINT1: "First move: Set lo=0, hi=n-1."
 *     HINT2: "Then: While lo<=hi compute mid=(lo+hi)/2."
 *     HINT3: "Then: If a[mid]==target stop."
 *
 * Three requests and the caller holds the algorithm, in `lo`/`hi`/`mid`
 * notation the learner has not been introduced to, as an ordered recipe. It is
 * also the exact shape `guardrails.ts::fullSolutionRule` describes — "an
 * imperative followed by a conjunction" — reached through the one door the
 * guardrails never guarded. And the debrief then printed the same five lines
 * under the heading "Hints you did not need" to a player who spent zero hints.
 *
 * The leak is now closed at the source (the template tier no longer derives
 * hints from the canonical text) AND here, because a hint can also be authored
 * by a language model, and a model asked for hints will sometimes include a
 * position because it cannot tell that the position IS the answer.
 *
 * WHAT THIS SCREENS, and why each one
 *
 *   notation          `lo=0`, `a[mid]`, `<=`, `->`. The learner has never been
 *                     shown the algorithm's own bookkeeping, and
 *                     `guidance.ts::deJargon` exists specifically to keep it
 *                     off learner-facing text. A hint that reintroduces it
 *                     teaches the notation without the algorithm.
 *   position          "index 5", "position 5", "the fifth one". The position IS
 *                     the answer for every windowed problem here, so naming it
 *                     ends the game. `guardrails.ts` says this in as many words.
 *   resolution        "the answer is 5", "it's 5", "5 is the answer". Catches a
 *                     claim stated without the word "index".
 *   pasted-code       A fenced block or a line of executable source. Reading a
 *                     finished implementation backwards is a different and much
 *                     harder task than making the next decision.
 *   unearned-praise   "that's correct". The engine is the only thing that may
 *                     say a move is right, and only after the oracle checked.
 *
 * WHAT THIS DELIBERATELY DOES *NOT* SCREEN
 *
 * `full-solution`. The guardrails version of that rule fires on an imperative
 * plus a conjunction, and it fires on a perfectly good LLM hint: "after each
 * comparison, move the bound just past the probed element, then repeat" was
 * rewritten to a state description when the real risk was elsewhere. Stating
 * the RULE completely is what a hint IS. The thing a hint must never do is name
 * this board's answer, and the four rules above are exactly that. Screening for
 * "too helpful" would replace good teaching with a wall, and a wall teaches
 * nothing.
 *
 * THE FALLBACK. A rejected hint is replaced by a WINDOW described in words,
 * derived from `state` and therefore true by construction rather than by
 * authorship. "Four of the eight values are still in play" is not a weaker hint
 * than a rule statement; it is the information a stuck learner actually uses,
 * and it cannot be wrong because nothing chose it.
 */

import type { GameState } from '@dsa/game-schema'

/** Number words, so the fallback can be spoken rather than printed. */
const NUMBER_WORDS: readonly string[] = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
]

/** Why a hint was rejected. Exposed for tests and for the server log line. */
export type HintViolationId =
  | 'notation'
  | 'position'
  | 'resolution'
  | 'pasted-code'
  | 'unearned-praise'

export interface HintViolation {
  readonly id: HintViolationId
  readonly reason: string
}

// ------------------------------------------------------------------- rules

/**
 * The algorithm's own bookkeeping.
 *
 * `\b(?:lo|hi|mid|i|j|n)\s*=` is the shape that actually shipped. The
 * bracketing forms are here because a model writes `a[mid]` and `arr[i]` when
 * it is thinking about code, and the comparison/assignment operators because
 * `lo <= hi` and `->` are the same leak wearing different punctuation.
 */
const NOTATION = [
  String.raw`\b(?:lo|hi|mid|left|right|start|end|idx|index|ptr|cursor)\s*=\s*-?\w+`,
  String.raw`\b\w+\s*\[\s*\w+\s*\]`,
  // `<=` and `>=` first, then the bare operators: "If lo>hi the target is
  // absent" is one of the five lines the default tier actually shipped, and it
  // contains no `=` at all.
  String.raw`<=|>=|!=|==|->|=>|::|\+\+|--|[\w)\]]\s*[<>]\s*[\w(]`,
  String.raw`\bwhile\s*\(|\bfor\s*\(|\bif\s*\(|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(`,
  // A bare `return <identifier>` with nothing after it. Deliberately narrow:
  // "return to the left half" is a legitimate hint and has four words after the
  // keyword, so requiring end-of-string keeps it.
  String.raw`^\s*return\s+[\w"'-]+\s*;?\s*$`,
].join('|')

/** Naming a place on the board, which for a windowed problem is the answer. */
const POSITION = [
  String.raw`\b(?:index|indices|position|positions|slot|slots|cell|cells|tile|tiles|square|squares|spot|spots)\s*#?\s*-?\d+\b`,
  String.raw`\b-?\d+(?:st|nd|rd|th)\s+(?:one|cell|slot|square|tile|position|place|pitch|value|element)\b`,
  String.raw`\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|cell|slot|square|tile|position|place)\b`,
].join('|')

/** Asserting a result rather than describing a constraint. */
const RESOLUTION = [
  String.raw`\banswer\s*(?:is|=|:)\s*(?:the\s+)?(?:number\s+|value\s+|index\s+|position\s+)?#?-?\d+`,
  String.raw`\b(?:it'?s|it is|this is|that'?s|that is)\s+(?:the\s+)?(?:answer|number|value|index|position)\s*#?\s*-?\d+`,
  String.raw`\b-?\d+\s+is\s+(?:the\s+)?answer\b`,
  // "Submit 4 as the answer", "Commit 4", "take the fifth one". The number may
  // sit on either side of the resolution phrase, so both orders are listed.
  String.raw`\b(?:take|choose|pick|select|go\s+with|submit|commit)\s+(?:the\s+)?#?-?\d+(?:st|nd|rd|th)?\s*(?:as\s+(?:the\s+)?answer)?\b`,
  String.raw`\b-?\d+(?:st|nd|rd|th)?\s+as\s+(?:the\s+)?answer\b`,
].join('|')

/** Source code, fenced or not. */
const CODE_SHAPES = [
  /^\s*(\/\/|#|\/\*)/,
  /^\s*(function|def|class|const|let|var|while|for|if|else|return|int|bool)\b/,
  /[{};]\s*$/,
]

/**
 * Claiming a move is right before the engine has confirmed it.
 *
 * `that` matches "that's", "that is" and "that has" — a model writes all three,
 * and only the contracted spelling is a reliable shape to test.
 */
const UNEARNED_PRAISE =
  /\b(?:that'?s|that\s+is|that\s+has)\s+(?:correct|right|it|the\s+answer)\b|\b(?:you'?re|you\s+are)\s+(?:right|correct)\b|\bspot\s+on\b|\bwell\s+done\b|\bnice\s+work\b|\bgreat\s+job\b/i

/**
 * Rules, most severe first.
 *
 * ORDER IS THE SEMANTICS. A fenced code block is checked before `notation`
 * because a block of source usually trips the notation rule too, and the useful
 * report is "it pasted the code" rather than "it mentioned an operator".
 * `resolution` precedes `position` because "it is the index 5" trips both, and
 * "it asserted a result" is the more serious of the two.
 */
const RULES: readonly { id: HintViolationId; pattern: RegExp; reason: string }[] = [
  { id: 'pasted-code', pattern: /```/, reason: 'contained a fenced code block' },
  { id: 'notation', pattern: new RegExp(NOTATION, 'i'), reason: 'used the algorithm’s own bookkeeping' },
  { id: 'resolution', pattern: new RegExp(RESOLUTION, 'i'), reason: 'asserted a result' },
  { id: 'position', pattern: new RegExp(POSITION, 'i'), reason: 'named a position on the board' },
  { id: 'unearned-praise', pattern: UNEARNED_PRAISE, reason: 'claimed correctness the engine has not established' },
]

/**
 * The first rule a hint breaks, or null.
 *
 * Total: it never throws, and a non-string is treated as empty (empty is not a
 * violation, because an empty hint is a caller's problem, not a leak).
 *
 * `looksLikeCode` is consulted BEFORE the ordered rules, not inside them, and
 * that ordering is deliberate. Source code trips several patterns at once — a
 * pasted `function binarySearch(a, target) { return 3; }` contains `==` and a
 * bare `return`, so the `notation` rule would report it as bookkeeping when the
 * honest report is "it pasted the implementation". Checking the structural
 * signal once, first, means the report names the actual defect. It is gated on
 * `looksLikeCode` so that a single prose sentence beginning "If the value is
 * higher..." is not mistaken for a conditional.
 */
export function findHintViolation(text: string): HintViolation | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '') return null

  if (looksLikeCode(trimmed)) {
    return { id: 'pasted-code', reason: 'read as source code' }
  }

  for (const rule of RULES) {
    if (!rule.pattern.test(trimmed)) continue
    return { id: rule.id, reason: rule.reason }
  }
  return null
}

/** Two or more lines that look like source, or a `return` with punctuation. */
function looksLikeCode(text: string): boolean {
  if (text.includes('```')) return true
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const codeish = lines.filter((line) => CODE_SHAPES.some((shape) => shape.test(line)))
  if (lines.length >= 2 && codeish.length >= 2) return true
  return /\breturn\s+(-?\d+|\w+)\s*;?/.test(text) && /[{};]/.test(text)
}

// ---------------------------------------------------------------- fallback

/**
 * The window, in words, with no positions and no notation.
 *
 * WHY NOT THE `variables` LINE. `hints.ts` can print `lo=0, hi=7, mid=3` from
 * `state.variables`, and for twenty years of notes that was the useful hint. It
 * is also precisely what this screen rejects, so the fallback cannot be built
 * from the same source — a screen that falls back to the thing it forbids is
 * not a screen. Counting what is still in play is true by construction,
 * survives the notation rule, and is what a stuck learner actually acts on.
 */
export function describeSearchWindow(state: GameState): string {
  const values = Array.isArray(state?.instance?.values) ? state.instance.values : []

  const lo = intOrNull(state?.variables?.['lo'])
  const hi = intOrNull(state?.variables?.['hi'])
  const hasWindow = lo !== null && hi !== null && lo >= 0 && hi >= 0

  // The WINDOW is the count that matters, and it is derived from the bounds —
  // not from `values.length`, which is the whole board and does not shrink as
  // the algorithm discards. Computing `left` from the bounds and `total` from
  // the board is what makes the sentence a progress report.
  const left = hasWindow ? Math.max(0, hi - lo + 1) : values.length

  // A state that declares a window has to have a board for that window to be a
  // fraction OF. Without one, the bounds are unverifiable, so the count is
  // reported on its own rather than as "six of the four".
  if (values.length === 0) {
    return hasWindow
      ? `${capitalise(wordFor(left))} of the values are still in play.`
      : 'Start at the end you can see and work inwards.'
  }
  if (!hasWindow) {
    return `All ${wordFor(values.length)} of the values are still in play. Decide from those.`
  }
  if (left === 0) return 'Nothing is left to check, so the target is not here.'
  if (left === 1) return 'Only one value is still in play. Look at it closely.'
  return (
    `${capitalise(wordFor(left))} of the ${wordFor(values.length)} values are still in play. ` +
    'Work out which end the target has to be on, and rule the other one out.'
  )
}

/**
 * Screen a candidate hint, substituting the state-derived fallback if it fails.
 *
 * The returned string is ALWAYS non-empty, and always either the candidate
 * verbatim or a description of the board. `hints.ts` calls this on every rung
 * of the ladder, which is what makes the guarantee structural rather than a
 * property of the tier that happened to author a given hint.
 */
export function screenHint(candidate: string, state: GameState): string {
  const fallback = describeSearchWindow(state)
  if (typeof candidate !== 'string') return fallback
  const trimmed = candidate.trim()
  if (trimmed === '') return fallback
  return findHintViolation(trimmed) === null ? trimmed : fallback
}

// ----------------------------------------------------------------- helpers

function wordFor(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? value : null
}

function capitalise(text: string): string {
  const first = text[0]
  return first === undefined ? text : `${first.toUpperCase()}${text.slice(1)}`
}
