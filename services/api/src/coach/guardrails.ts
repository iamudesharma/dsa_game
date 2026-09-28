/**
 * COACH GUARDRAILS.
 *
 * READ THIS FIRST:
 * The whole feature rests on one promise: a learner who asks the coach does not
 * get the answer. The contract asks for that promise to be kept in the SYSTEM
 * PROMPT, and a prompt instruction is a REQUEST, not a guarantee. A model asked
 * to be helpful and not to leak will, under enough pressure, leak — and the
 * pressure here is constant, because a frustrated twelve-year-old asking "so is
 * it 5 or 6?" is exactly the input that maximises the chance the model caves.
 *
 * So the rules are duplicated HERE as a validator over the generated text, and
 * this file — not the prompt — is the actual enforcement point. The prompt is
 * there to make refusals rare. This is what makes them impossible.
 *
 * WHAT "THE ANSWER" IS, PRECISELY
 *
 * It is NOT the value under the target. The learner can already see the target
 * on the board; it is a given, not a reward.
 *
 * It IS the position. Telling a learner "the 51 is at index 5" hands over the
 * only non-obvious fact in the game, and the entire lesson of binary search is
 * how to FIND that position. Handing it over converts a learning exercise into a
 * two-click affair with a narration track.
 *
 * It is ALSO the full solution path. "Select the 51, then click the right half,
 * then submit 5" is just as fatal as naming the index, because the learner ends
 * up in the same place without having made the decision that teaches anything.
 * Naming the next OPERATION is explicitly allowed; naming every operation in
 * order is not.
 *
 * It is ALSO unearned praise. "That's correct!" is the engine's line to say, and
 * only once the oracle has actually confirmed the move. A coach that says it
 * early teaches a learner that their untested guesses are right.
 *
 * WHAT HAPPENS WHEN A RULE FIRES
 *
 * Not a pass-through, and not a crash. The reply is REPLACED with a canned,
 * in-character line that points at the next operation without naming the answer,
 * and the original is returned in `redacted.original`. That original is not
 * cosmetic: the contract wants it available so the client can put it behind a
 * "this was blocked" disclosure — useful for a curious learner who wants to know
 * the coach was tempted, and for a developer who needs to see exactly what the
 * model said when a guardrail keeps firing.
 *
 * THE REWRITE INVARIANT (the reason the rewrites are boring)
 *
 * NO REWRITE EVER CONTAINS A DIGIT.
 *
 * This is a hard, testable invariant, and it is what makes "the rewrite never
 * contains the answer" true BY CONSTRUCTION rather than by inspection — including
 * for the fragments copied out of the snapshot, which is why `digitsOut` is
 * applied to those too. It is tempting to make rewrites richly board-specific
 * ("there are three values left between your ends"), but a count can coincide
 * with the answer index and a themed noun can be the answer's value, so every
 * interpolation is one more way for the filter to leak the very thing it exists
 * to withhold. Counts are spelled out in words; positions are never mentioned.
 * The rewrites still feel like coaching because they name the OPERATION and the
 * RULE, which is what actually helps.
 */

import type { GuidancePromptSnapshot } from '@dsa/game-schema'

export interface CoachRedaction {
  readonly reason: string
  readonly original: string
}

export type CoachScreen =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly redacted: CoachRedaction; readonly text: string }

export type GuardrailId =
  | 'pasted-code'
  | 'answer-claim'
  | 'answer-is-target-value'
  | 'index-claim'
  | 'value-claim'
  | 'full-solution'
  | 'future-leak'
  | 'unearned-correction'

export interface GuardrailViolation {
  readonly id: GuardrailId
  readonly reason: string
}

/** Number words, so a rewrite can say "five" without ever writing "5". */
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

/**
 * Rules, most severe first.
 *
 * ORDER IS THE SEMANTICS. `pasted-code` is checked first because a code block
 * usually contains an answer-claim pattern too, and the useful reason for a
 * reviewer is "it pasted the algorithm", not "it mentioned a number". The
 * answer-claim family runs next for the same reason: when a reply both names an
 * index and solves the board, "it named the answer" is the report anyone wants.
 * `full-solution` and `future-leak` follow, then unearned praise.
 *
 * A function rather than a `const` because the rules are declared further down the
 * file, grouped with the patterns they use: keeping the table next to the code it
 * summarises is worth more than saving a few lines of module scope.
 */
function rules(): readonly Rule[] {
  return [
    pastedCodeRule,
    answerClaimRule,
    answerIsTargetValueRule,
    indexClaimRule,
    valueClaimRule,
    fullSolutionRule,
    futureLeakRule,
    unearnedCorrectionRule,
  ]
}

/** What a rule reports on a hit. The id lives on the rule, not on the hit. */
interface RuleHit {
  readonly reason: string
}

interface Rule {
  readonly id: GuardrailId
  check(text: string, snapshot: GuidancePromptSnapshot): RuleHit | null
}

/**
 * The one entry point. Total: it never throws, whatever the reply contains.
 */
export function screenCoachReply(reply: string, snapshot: GuidancePromptSnapshot): CoachScreen {
  const text = typeof reply === 'string' ? reply.trim() : ''
  // Empty is not a leak. The service substitutes the deterministic fallback, and
  // inventing a rewrite here would only hide a transport that said nothing.
  if (text === '') return { ok: true, text: '' }

  for (const rule of rules()) {
    const hit = rule.check(text, snapshot)
    if (hit === null) continue
    return {
      ok: false,
      redacted: { reason: `${rule.id}: ${hit.reason}`, original: reply },
      text: rewriteFor(rule.id, snapshot),
    }
  }
  return { ok: true, text }
}

/** Exposed for tests and for the trace line, which reports WHICH rule fired. */
export function findViolation(reply: string, snapshot: GuidancePromptSnapshot): GuardrailViolation | null {
  const text = typeof reply === 'string' ? reply.trim() : ''
  if (text === '') return null
  for (const rule of rules()) {
    const hit = rule.check(text, snapshot)
    if (hit !== null) return { id: rule.id, reason: hit.reason }
  }
  return null
}

// ---------------------------------------------------------------- the rules

/**
 * Rule: the canonical algorithm, pasted.
 *
 * A learner handed the working implementation has not been coached; the code is a
 * translation of the idea, and reading it backwards is a different and much harder
 * task than making the next decision. Detected STRUCTURALLY — fences, line
 * comments, brace-terminated statements, a `return` inside prose — rather than by
 * matching any specific problem's source, so a paraphrase in a language we do not
 * implement is caught too.
 */
const CODE_LINE_SHAPES = [
  /^\s*(\/\/|#|\/\*)/,
  /^\s*(function|def|class|const|let|var|while|for|if|else|return|int|bool)\b/,
  /[{};]\s*$/,
  /=>|==|\blo\s*=\s*mid\b|\bmid\s*=\s*Math\.floor/,
]

const pastedCodeRule: Rule = {
  id: 'pasted-code',
  check(text) {
    if (/```/.test(text)) return { reason: 'reply contains a fenced code block' }
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    const codeish = lines.filter((line) => CODE_LINE_SHAPES.some((shape) => shape.test(line)))
    if (lines.length >= 2 && codeish.length >= 2) {
      return { reason: 'reply is source code, not coaching' }
    }
    if (/\breturn\s+(-?\d+|\w+)\s*;?/.test(text) && /[{};]/.test(text)) {
      return { reason: 'reply contains executable statements' }
    }
    return null
  },
}

/**
 * Rule: an explicit answer sentence.
 *
 * "the answer is 5", "it's number 5", "5 is the answer" — any of these is the
 * whole feature's failure mode in one clause. Deliberately narrow: the trigger is
 * a CLAIM word next to a number, so ordinary coaching that happens to mention
 * numbers ("you have three values left") is untouched.
 */
const ANSWER_CLAIM = new RegExp(
  [
    String.raw`\banswer\s*(?:is|=|:|was)\s*(?:the\s+)?(?:number\s+|value\s+|index\s+|position\s+)?#?(-?\d+)\b`,
    String.raw`\b(?:it'?s|it is|this is|that'?s|that is|they'?re)\s+(?:the\s+)?(?:answer|number|value|index|position)\s*#?\s*(-?\d+)\b`,
    String.raw`\b(-?\d+)\s+is\s+(?:the\s+)?answer\b`,
  ].join('|'),
  'i',
)

const answerClaimRule: Rule = {
  id: 'answer-claim',
  check(text) {
    const match = ANSWER_CLAIM.exec(text)
    if (match === null) return null
    return { reason: `asserted "${match[1] ?? match[0].trim()}" as the answer` }
  },
}

/**
 * Rule: the reply hands the target's own VALUE over as the resolution.
 *
 * `answer-claim` catches a bare number, but a themed coach may also say "it is the
 * 51 stone", and a phrasing like that is only reliably caught by comparing against
 * the board. The snapshot carries the target value, so this is a real
 * cross-check rather than a pattern guess.
 *
 * Note what is NOT checked: whether the named value is the right answer. The coach
 * is caught for *asserting a resolution*, not for being wrong — a wrong assertion
 * is still a spoiler, and still a claim the learner has no way to check.
 */
const answerIsTargetValueRule: Rule = {
  id: 'answer-is-target-value',
  check(text, snapshot) {
    const target = snapshot.targetValue
    if (target === null || target === undefined) return null
    const literal = escapeRegExp(String(target))
    if (!new RegExp(String.raw`\b${literal}\b`).test(text)) return null

    const framed = new RegExp(
      [
        String.raw`\b(?:answer|found|it|that|this)\b[^.!?\n]{0,40}\b${literal}\b`,
        String.raw`\b${literal}\b[^.!?\n]{0,20}\b(?:is\s+the\s+answer|is\s+it|got\s+it|the\s+target)\b`,
      ].join('|'),
      'i',
    )
    if (!framed.test(text)) return null
    return { reason: `used the target value ${String(target)} as a resolution` }
  },
}

/**
 * Rule: naming a position on the board.
 *
 * "index 5", "position 5", "the sixth slot" — the position IS the answer, so
 * naming it is the leak. Word-form ordinals are included because "the fifth one" is
 * the same leak written the way a coach naturally writes.
 *
 * --------------------------------------------------------------------
 * THE SOFT PASS-THROUGH
 *
 * This is the rule that an over-aggressive filter mangles good coaching with,
 * because legitimate coaching is full of positions: "your two ends are the lowest
 * and the highest", "you have narrowed it down to a few". Those describe the
 * CURRENT WINDOW, which the board already highlights — repeating what the learner
 * can already see teaches nothing and spoils nothing.
 *
 * So this rule yields to `looksLikeSafeCoaching`: a reply with no resolution
 * vocabulary at all, which is structurally incapable of asserting an outcome. The
 * bypass is deliberately a SHAPE test, not a list of phrases we liked, because a
 * phrase allowlist is how filters rot — someone adds "you are right" one day and
 * "right on, keep going" the next, and the list becomes the specification. It also
 * cannot rescue a reply that tripped a hard rule, because those return before this
 * rule is ever reached.
 */
const INDEX_CLAIM = new RegExp(
  [
    String.raw`\b(?:index|indices|position|positions|slot|slots|cell|cells|square|squares|tile|tiles|spot|spots|box|boxes|place)\s*#?\s*(-?\d+)\b`,
    String.raw`\b(?:the\s+)?(-?\d+)(?:st|nd|rd|th)\s+(?:one|cell|slot|square|tile|position|place|box)\b`,
    // Word-form ordinals. A coach does not usually write "position 5"; it writes
    // "the fifth one", which is the same leak in the register the whole feature
    // is trying to sound like. Covering only the digit form would be a filter that
    // only catches computers writing.
    String.raw`\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|cell|slot|square|tile|position|place|box)\b`,
  ].join('|'),
  'i',
)

/** Vocabulary that turns a number into a RESOLUTION rather than a description. */
const RESOLUTION_WORDS =
  /\b(?:answer|found|there\s+you|submit|commit|congratulations|exactly|spot\s+on|goal|won|win)\b/i

const indexClaimRule: Rule = {
  id: 'index-claim',
  check(text) {
    if (looksLikeSafeCoaching(text)) return null
    const match = INDEX_CLAIM.exec(text)
    if (match === null) return null
    return { reason: `named a board position ("${match[0].trim()}")` }
  },
}

/**
 * Soft pass-through.
 *
 * True only when the reply contains no resolution vocabulary whatsoever — so it
 * cannot be asserting an outcome, not even incidentally — AND it engages with the
 * board. Engagement is the second half of the test: a reply that is pure
 * encouragement has no position to leak in the first place, and a reply that
 * talks about the window but never about a result is describing something the
 * learner can already see for themselves.
 */
function looksLikeSafeCoaching(text: string): boolean {
  if (RESOLUTION_WORDS.test(text)) return false
  return /\b(?:window|ends?|edge|edges|half|halves|middle|mid|between|left|right|smaller|bigger|larger|narrow|discard|ruled\s+out|out\s+of|numbers?|values?|stones?|cards?|cells?|compare|comparing|checking|still\s+in\s+play|remaining|left)\b/i.test(
    text,
  )
}

/**
 * Rule: "it's five" and its relatives, without the word "answer".
 *
 * A claim can be laundered past `index-claim` by dropping the noun: "it's five",
 * "that one, number five". Bare numbers are legitimate everywhere in this domain,
 * so the trigger is a copula followed by a number, and a direction hint that has
 * no copula ("keep anything above 51") is deliberately allowed — that is a
 * constraint, not a resolution.
 */
const VALUE_CLAIM = new RegExp(
  [
    String.raw`\b(?:it'?s|that'?s|this is|it is|we want|you want|go with|take)\s+(?:the\s+)?(?:number\s+|value\s+|position\s+)?#?(-?\d+)\b`,
    String.raw`\b(?:it'?s|that'?s|this is|it is)\s+(-?\d+)(?:st|nd|rd|th)\b`,
    String.raw`\banswer\s+(?:me\s+)?(?:with\s+)?(?:is\s+)?(?:just\s+|only\s+)?(-?\d+)\b`,
  ].join('|'),
  'i',
)

const valueClaimRule: Rule = {
  id: 'value-claim',
  check(text) {
    const match = VALUE_CLAIM.exec(text)
    if (match === null) return null
    return { reason: `asserted a specific value as the resolution ("${match[0].trim()}")` }
  },
}

/**
 * Rule: a full solution as an ordered instruction list.
 *
 * The line between naming the next operation and solving the board is a SEQUENCE.
 * "Now probe the middle" is coaching. "Select the middle, then choose the right
 * half, then submit the index" is the game being played for them. So the trigger is
 * an imperative followed by a conjunction, which is the shape of a recipe and not
 * the shape of a nudge — and a lone imperative stays clean.
 */
const SOLUTION_STEP =
  /\b(?:press|click|tap|select|choose|pick|drag|move|type|enter|write|submit|commit|highlight|go\s+to)\b/i
const SOLUTION_JOIN = /(?:\bthen\b|\band\s+then\b|\bafter\s+that\b|→)/i

const fullSolutionRule: Rule = {
  id: 'full-solution',
  check(text) {
    for (const sentence of splitSentences(text)) {
      if (!SOLUTION_STEP.test(sentence)) continue
      if (!SOLUTION_JOIN.test(sentence)) continue
      return { reason: 'gave an ordered list of moves instead of the next one' }
    }
    return null
  },
}

/**
 * Rule: narrating the future.
 *
 * "Next you will halve the range" is not a spoiler on its own — but a learner told
 * what happens after their move stops making the decision that the move exists to
 * make, and the coach then has nothing left to coach. A future step is the answer
 * played one beat later, so it counts as leakage.
 */
const FUTURE_LEAK = new RegExp(
  [
    String.raw`\bnext\s+(?:you(?:'ll|\s+will|\s+are\s+going\s+to)|it|that|the\s+\w+\s+will)\b`,
    String.raw`\bafter\s+(?:this|that|you\s+do\s+that)\s*[,\s]+you(?:'ll|\s+will|\s+are\s+going\s+to)\b`,
    String.raw`\bthen\s+it\s+(?:becomes|will\s+be|is)\b`,
    String.raw`\b(?:it|that|this)\s+(?:will|'ll)\s+(?:become|be)\b`,
    String.raw`\byou(?:'ll|\s+will)\s+(?:end\s+up|have|be\s+left|get)\b`,
    String.raw`\bthe\s+answer\s+(?:will|is\s+going\s+to)\b`,
    String.raw`\beventually\s+(?:you|it|the)\b`,
  ].join('|'),
  'i',
)

const futureLeakRule: Rule = {
  id: 'future-leak',
  check(text) {
    const match = FUTURE_LEAK.exec(text)
    if (match === null) return null
    return { reason: `narrated a future step ("${match[0].trim()}")` }
  },
}

/**
 * Rule: praise the engine has not earned.
 *
 * The engine is the only thing that can say a move is right, and it says so only
 * after the oracle has checked. A coach that congratulates a move the engine
 * rejected teaches the learner to trust an unchecked guess — the exact opposite of
 * what a coach is for. PHASE is the one exemption: on a finished game the engine HAS
 * established the outcome, so "you found it" is a fact and must not be rewritten.
 * Without that exemption the coach would scold a learner for congratulating them
 * on a win.
 */
const UNEARNED_CORRECTION = new RegExp(
  [
    String.raw`\bthat'?s\s+(?:correct|right|it|the\s+answer)\b`,
    String.raw`\b(?:you're|you\s+are)\s+(?:right|correct)\b`,
    String.raw`\bthis\s+is\s+(?:correct|right|it)\b`,
    String.raw`\bthis\s+is\s+the\s+(?:correct|right)\s+(?:move|answer|one|choice|step)\b`,
    String.raw`\b(?:correct|exactly\s+right|perfect|nice\s+work|great\s+job|well\s+done|excellent)\b[!,.]?\s*(?:you|that|you've|you\s+have)\b`,
    String.raw`\byou\s+(?:found|got|guessed)\s+(?:it|the\s+answer)\b`,
    String.raw`\b(?:there\s+you\s+go|congratulations|well\s+done|spot\s+on)\b`,
    String.raw`\bthat\s+(?:is|was)\s+the\s+answer\b`,
  ].join('|'),
  'i',
)

const unearnedCorrectionRule: Rule = {
  id: 'unearned-correction',
  check(text, snapshot) {
    if (snapshot.phase === 'won') return null
    const match = UNEARNED_CORRECTION.exec(text)
    if (match === null) return null
    return { reason: `claimed correctness the engine has not established ("${match[0].trim()}")` }
  },
}

// ---------------------------------------------------------------- the rewrites

/**
 * The line used when even a composed rewrite would not be verifiably clean.
 *
 * It contains no numbers, no board nouns and no snapshot text at all, so it cannot
 * leak a position whatever the state holds. It is the bottom of the stack, and it
 * is REACHABLE, which is the point: a guardrail whose worst case is unreachable is
 * a guardrail whose worst case is untested.
 */
const SAFE_LAST_RESORT =
  'I cannot put that into words without handing you the answer, and that is the part worth doing yourself. Look again at what is still in play, and tell me what you notice about the two values you can see.'

/**
 * Canned, in-character, answer-free lines — one per rule.
 *
 * Each names the next OPERATION or restates the RULE, which is exactly what the
 * contract permits and exactly what helps a stuck learner. None interpolate a
 * number, a position or a board value: see the digit invariant at the top of this
 * file. `digitsOut` is applied to every fragment copied out of the snapshot, since
 * a spec's vocabulary is model-authored and could contain a digit.
 */
function rewriteFor(id: GuardrailId, snapshot: GuidancePromptSnapshot): string {
  const subject = subjectFor(snapshot)
  const window = describeWindow(snapshot)
  const target = article(digitsOut(snapshot.targetLabel))

  const composed = ((): string => {
    switch (id) {
      case 'pasted-code':
        return `I am not going to paste you the code — reading the finished answer backwards is not the same as deciding. So let us decide instead: ${subject}. What would you check first?`
      case 'answer-claim':
      case 'answer-is-target-value':
      case 'index-claim':
      case 'value-claim':
        return `I cannot hand you the answer, and that is the part worth doing yourself. ${window} Compare what is left against ${target} and tell me which one it sits nearer.`
      case 'full-solution':
        return `I will give you the next step, not the whole recipe — a recipe played for you teaches you nothing. So: ${subject}. Stop there, tell me what you see, and then we go on.`
      case 'future-leak':
        return `Let us stay on the move in front of you, because deciding it is the whole game. ${window} What is the first thing you would check?`
      case 'unearned-correction':
        return `I will not call that right yet — only ${target} and the board get to decide, not me. ${window} What do those two numbers tell you?`
      default: {
        const exhaustive: never = id
        return exhaustive
      }
    }
  })()

  // Defence in depth, and the reason the digit invariant above is an invariant
  // rather than a hope: the composed rewrite is screened by the SAME rules before
  // it is allowed out. A future change to a rule, or a new snapshot field that
  // gets interpolated, therefore degrades to `SAFE_LAST_RESORT` instead of to a
  // spoiler — and the degradation is itself covered by a test.
  //
  // `findViolation`, NOT `screenCoachReply`. The screening entry point rewrites what
  // it catches, so using it here would recurse: rewrite -> screen -> rewrite -> ...
  // This function only needs the DETECTION half, and detection half is exactly what
  // `findViolation` is.
  return findViolation(composed, snapshot) === null ? composed : SAFE_LAST_RESORT
}

/**
 * The next operation, in the theme's own words.
 *
 * The `TurnPrompt`'s instruction is the engine's, and the engine's instruction is
 * derived from the oracle's legal actions — so it is the one line on the whole
 * server guaranteed to describe a legal next move. Using it is not a shortcut; it
 * is the entire point of deriving the prompt from the oracle rather than the model.
 *
 * It is used ONLY when it is digit-free, and that is not paranoia about the
 * oracle. Binary search's own label is "Choose index 6, the middle of [6, 7]", and
 * on the final turn `mid` IS the answer — so the engine's instruction can name the
 * very position this file exists to withhold. Stripping its digits would leave
 * broken prose ("the middle of [, ]"), so an instruction carrying a number is
 * discarded in favour of a generic description of the same operation.
 */
function subjectFor(snapshot: GuidancePromptSnapshot): string {
  const instruction = snapshot.instruction.trim()
  if (instruction !== '' && !/\d/.test(instruction)) return lowerFirstLetter(instruction)
  return 'look at the values that are still in play, and start from the middle of them'
}

/**
 * How much of the board is left, in words, with no positions.
 *
 * A count is safe where a position is not: "three of the eight are still in play"
 * is progress information, and it cannot be the answer, because the answer is a
 * PLACE and this is a tally. Spelled out, so no digit ever reaches the learner.
 * The trailing full stop is deliberate: these are whole sentences that get
 * concatenated, and a missing one reads as a typo in front of a child.
 */
function describeWindow(snapshot: GuidancePromptSnapshot): string {
  const total = snapshot.board.length
  const eliminated = snapshot.eliminated.length
  if (total === 0) return 'Nothing has been ruled out yet, so start from the end you can see.'
  const left = total - eliminated
  if (left <= 0) return 'Everything has been ruled out, so go back and re-read your two ends.'
  if (left === 1) return 'Only one value is still in play.'
  return `${capitalise(`${wordFor(left)} of the ${wordFor(total)} values are still in play`)}.`
}

/** `pressure hull` -> `the pressure hull`; a label that already has one is left. */
function article(label: string): string {
  if (label === '') return 'the target'
  return /^(the|a|an|my|your)\b/i.test(label) ? label : `the ${label}`
}

function wordFor(n: number): string {
  return NUMBER_WORDS[n] ?? 'some'
}

/**
 * Remove every digit, and any word that was nothing but digits.
 *
 * Applied to snapshot fragments on the way into a rewrite. A themed label is
 * model-authored, so "the 51 vault" is a legal string in a `GameSpec` and would
 * smuggle a number straight past the invariant this file is built on.
 */
function digitsOut(text: string): string {
  return text
    .replace(/\d+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function capitalise(text: string): string {
  const first = text[0]
  if (first === undefined) return text
  return `${first.toUpperCase()}${text.slice(1)}`
}

function lowerFirstLetter(text: string): string {
  const first = text[0]
  if (first === undefined) return text
  return `${first.toLowerCase()}${text.slice(1)}`
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
