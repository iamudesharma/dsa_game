/**
 * TIER 4 — the deterministic, zero-I/O guarantee.
 *
 * Everything here is derived from `ProblemMeta` + `seed`. There is no hand
 * written copy of any problem: theme comes from the eight-entry table in
 * `themes.ts`, mechanics are a subset of `problem.allowedMechanics`, and every
 * algorithmic sentence is lifted from `problem.canonicalAlgorithm` /
 * `problem.learningObjective`. That is what lets this tier claim "always
 * playable" without any risk of teaching a falsehood.
 */

import {
  GameSpecSchema,
  MECHANICS,
  TOPIC_LABELS,
  makeRng,
  pick,
  type DsaOp,
  type DsaTopic,
  type Difficulty,
  type GameSpec,
  type MechanicId,
} from '@dsa/game-schema'
import type { ProblemMeta } from '@dsa/game-schema'
import { TEMPLATE_THEMES, type ThemeDef } from '../themes.js'
import type { GenerateSpecInput, SpecProvider } from '../types.js'

/** How many mechanics each difficulty wants. Capped by the problem's allowed set. */
const MECHANICS_WANTED: Record<Difficulty, number> = { easy: 3, medium: 4, hard: 4 }

/**
 * Topic-specific vocabulary for the debrief mapping. Both columns are plain
 * algorithmic statements, not theme flourishes — the debrief is teaching.
 */
const CONTAINER_TERM: Record<DsaTopic, string> = {
  arrays: 'the array',
  sorting: 'the array',
  'binary-search': 'the sorted array',
  stack: 'the stack',
  queue: 'the queue',
  'linked-list': 'the linked list',
  'hash-table': 'the frequency table',
  strings: 'the string',
  trees: 'the level-order array',
  heap: 'the array with its heap zone',
}

const SCOPE_TERM: Record<DsaTopic, string> = {
  arrays: 'the part of the array still under consideration',
  sorting: 'the range that is not sorted yet',
  'binary-search': 'the half of the range still under consideration',
  stack: 'the top of the stack, where every push and pop happens',
  queue: 'the ends of the queue, front and rear',
  'linked-list': 'the position the cursor has reached so far',
  'hash-table': 'the counts recorded so far',
  strings: 'the pair of positions still unchecked',
  trees: 'the subtree still under consideration',
  heap: 'the heap zone at the front of the array',
}

/**
 * The hint ladder, keyed by OPERATION.
 *
 * WHY NOT THE CANONICAL ALGORITHM. This used to split
 * `problem.canonicalAlgorithm` into sentences and ship them as the hint pool,
 * on the argument that a hint "can never drift from the algorithm because it IS
 * the algorithm". True, and it produced this, on the default tier, with no API
 * key configured:
 *
 *     HINT1: "First move: Set lo=0, hi=n-1."
 *     HINT2: "Then: While lo<=hi compute mid=(lo+hi)/2."
 *     HINT3: "Then: If a[mid]==target stop."
 *
 * Three requests, and the caller has the algorithm in raw notation with the
 * `lo`/`hi`/`mid` bookkeeping the learner has not been introduced to. It is a
 * recipe, and it is the exact shape `coach/guardrails.ts` calls a recipe
 * ("an imperative followed by a conjunction"). The `RESULT_ASSERTION` filter
 * that used to sit here removed answer-revealing SENTENCES; it could not remove
 * a procedure, because a procedure is not a sentence about the answer.
 *
 * The ladder below replaces it, and it is exhaustive in a way the old version
 * was not: `DsaOp` is a closed 13-value union and this is a `Record` over it,
 * so adding an operation is a COMPILE ERROR rather than a silently unhinted
 * problem. That is a stronger guarantee than "it is the algorithm", because a
 * new problem inherits a ladder without anyone re-reading its canonical text.
 *
 * Each rung is about the OPERATION, never about a position or a value:
 *   0 — the principle being exploited (why this step exists at all)
 *   1 — the constraint that decides it (which way, which side)
 *   2 — the move, still unnamed
 * Slot substitution keeps it in the theme's vocabulary.
 */
const HINT_LADDER: Readonly<Record<DsaOp, readonly string[]>> = {
  read: [
    'Everything in the {place} is in order, so order is the tool here. You never need to look at every value to make progress.',
    'Do not begin at either end. Begin at the value in the middle of what is left, because that is the one that rules out the most.',
    'Take whichever {object} sits in the middle of what is still in play. That is the only one this step needs.',
  ],
  compare: [
    'A comparison here does not just answer yes or no — it produces a direction, and the direction is what decides everything after it.',
    'Hold your {object} next to the {target} and ask which is bigger. Whichever side is bigger, the other side is finished.',
    'Say which of the two is the {lower} one. That single word is the whole decision.',
  ],
  'choose-path': [
    'Whatever is left is still in order, so a whole side of it can be ruled out at once. Being able to do that is the only reason this is quick.',
    'Throw away the side that cannot hold the {target}. Keep the side that might, and start it just past the value you looked at.',
    'Keep the half where the {target} could still be. Do not keep both — making the next step smaller is the entire point.',
  ],
  swap: [
    'Two values that are the wrong way round cannot both be where they are. Exchanging them puts both right in a single move.',
    'Exchange only the pair that is out of order. Everything else is already where it belongs.',
    'Exchange those two and leave the rest alone.',
  ],
  push: [
    'A stack hands values back in the opposite order to the one they went in. Adding to it only ever touches the top.',
    'Add to the top, never into the middle. A stack has no middle to add to.',
    'Put it on the top.',
  ],
  pop: [
    'Last in, first out. The newest value is the one you get back, and it is the only one you are allowed to take.',
    'Take from the top, and only from the top. If the top is empty there is nothing to take, whatever is still in the {place}.',
    'Take the one on top.',
  ],
  move: [
    'Moving a value is not the same as copying it. After the move the {place} has to still be usable for whatever comes next.',
    'Put it where the algorithm expects to find it next, not merely somewhere nearby.',
    'Move it to its next place in the {place}.',
  ],
  insert: [
    'Keeping what you have already worked out is cheaper than working it out again, so the program saves it.',
    'Save it once, so the next step can read it rather than recompute it.',
    'Record the value.',
  ],
  assign: [
    'A named value is how the program remembers something without carrying it around. It is the cheapest kind of storage there is.',
    'Write it down in one place, and read it from there rather than working it out again.',
    'Write the value into the slot.',
  ],
  traverse: [
    'There is no counting along a chain of links — you can only follow one. Each step forward is exactly one link followed.',
    'Move one link at a time. You cannot skip ahead and you cannot look back without starting over.',
    'Follow the next link.',
  ],
  link: [
    'A link decides where the traversal goes next. Rewiring one changes the route without rebuilding anything.',
    'Point the link where the algorithm needs to go next, and the rest of the route follows on its own.',
    'Rewire the pointer.',
  ],
  unlink: [
    'Cutting a link is how a route stops being available. Nothing else has to move for that to be true.',
    'Cut it so the traversal can no longer reach that way.',
    'Cut that link.',
  ],
  terminate: [
    'Finishing is a result, not a guess. The program stops when the rule allows it to stop, and reports what it found.',
    'Commit only once the rule has actually been satisfied — not when it merely feels right.',
    'Commit your answer.',
  ],
}

/**
 * `a` or `an`, decided by how the NOUN sounds rather than by how the sentence
 * was written.
 *
 * The themes are hand-authored and the object nouns are theirs ("actuator",
 * "satellite", "pitch", "book"), so the article cannot be baked into the
 * template string: an earlier version hardcoded `a` and produced "take a
 * actuator in hand" for every vowel-initial noun in the table. Vowel letters
 * are the right test for every noun in `themes.ts` (they are all pronounced
 * from the letter), and the consonant exceptions (hour, honest, ...) are not in
 * this vocabulary.
 */
function articleFor(noun: string): 'a' | 'an' {
  return /^[aeiou]/i.test(noun.trim()) ? 'an' : 'a'
}

/** Theme-flavoured name for each interaction. All slots come from the theme. */
function mechanicLabel(id: MechanicId, t: ThemeDef): string {
  const a = articleFor(t.object)
  switch (id) {
    case 'selectObject':
      return `take ${a} ${t.object} in hand`
    case 'moveObject':
      return `shift ${a} ${t.object} to another spot`
    case 'swapPair':
      return `trade places between two ${t.objectPlural}`
    case 'comparePair':
      return `${t.actionVerb} two ${t.objectPlural} against each other`
    case 'pushPop':
      return `stack or unstack ${a} ${t.object}`
    case 'choosePath':
      return `decide which side of the ${t.place} stays open`
    case 'traverseNode':
      return `advance to the next ${t.object}`
    case 'connectNodes':
      return `rewire the pointer between two ${t.objectPlural}`
    case 'assignValue':
      return `write a value into the ${t.target} slot`
    case 'submitAnswer':
      return `commit the ${t.target}`
  }
}

/**
 * Flatten the ladder into this problem's pool, in escalating order.
 *
 * `requiredMechanics` rather than `allowedMechanics`: the load-bearing subset is
 * the one whose operations the learner cannot avoid, so it is the one worth
 * hinting. It is also already in declaration order, which is roughly the order
 * the algorithm performs them, and that ordering is what makes the flattened
 * list read as a ladder rather than as a shuffled deck.
 *
 * The rung is interleaved ACROSS operations (all principles, then all
 * constraints) rather than nested per operation. The learner reaching for a hint
 * is nearly always trying to work out which operation comes next, not how to
 * finish one they have already identified — so the first thing the pool should
 * offer is a reason for each step, and the thing it should withhold is the
 * decision itself.
 *
 * Capped at 6 because `NarrationSchema.hintPool` is `max(6)`, and floored at 2
 * because it is `min(2)`. Every operation in the ladder has three rungs, so the
 * floor holds for any problem that declares at least one mechanic — which every
 * one in the catalogue does.
 */
function hintPoolFor(problem: ProblemMeta, slots: Record<string, string>): string[] {
  const ops: DsaOp[] = []
  for (const id of problem.requiredMechanics) {
    const op = MECHANICS[id]?.op
    if (op !== undefined && !ops.includes(op)) ops.push(op)
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (let rung = 0; rung < 3 && out.length < 6; rung += 1) {
    for (const op of ops) {
      if (out.length >= 6) break
      const line = HINT_LADDER[op][rung]
      if (line === undefined) continue
      const filled = fillSlots(line, slots)
      if (seen.has(filled)) continue
      seen.add(filled)
      out.push(filled)
    }
  }
  return out
}

function fillSlots(template: string, slots: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(slots)) {
    out = out.split(`{${key}}`).join(value)
  }
  return out
}

/**
 * Mechanics chosen from the problem's allowed set only.
 *
 * `submitAnswer` is pulled in first whenever it is allowed, because without a
 * terminating mechanic the player can never finish and the puzzle is not
 * playable. The rest are taken in the order the problem declares them, which
 * keeps the result stable and predictable.
 */
export function chooseTemplateMechanics(
  allowed: readonly MechanicId[],
  difficulty: Difficulty,
  required: readonly MechanicId[] = [],
): MechanicId[] {
  if (allowed.length === 0) {
    // A problem with no renderable mechanics is a registry bug, not a runtime
    // condition. Fail loudly rather than emitting a spec that teaches nothing.
    throw new Error('chooseTemplateMechanics: problem declares no allowedMechanics')
  }

  // The load-bearing set comes first and is never dropped. Taking "the first N
  // allowed" instead produced an unwinnable binary search — selectObject,
  // comparePair and submitAnswer, with no choosePath, so `lo`/`hi` could never
  // move and the game could never be won. A difficulty setting may ADD
  // mechanics; it must never remove the ones the algorithm needs.
  const chosen: MechanicId[] = []
  for (const id of required) {
    if (!allowed.includes(id)) {
      throw new Error(
        `chooseTemplateMechanics: ${id} is required but not in the allowed set [${allowed.join(', ')}]`,
      )
    }
    if (!chosen.includes(id)) chosen.push(id)
  }
  // Finishing the round is never optional. It was the one mechanic the old
  // "first N allowed" rule reliably kept, so keep it explicitly — otherwise a
  // difficulty change can silently remove the ending.
  if (allowed.includes('submitAnswer') && !chosen.includes('submitAnswer')) {
    chosen.push('submitAnswer')
  }

  const want = Math.max(chosen.length, Math.min(allowed.length, MECHANICS_WANTED[difficulty]))
  for (const id of allowed) {
    if (chosen.length >= want) break
    if (!chosen.includes(id)) chosen.push(id)
  }
  // Restore the problem's declaration order for a stable mechanic list.
  return allowed.filter((id) => chosen.includes(id))
}

export function buildTemplateSpec(input: GenerateSpecInput): GameSpec {
  const { problem, instance, seed, difficulty } = input
  const rng = makeRng(seed >>> 0)

  const theme = pick(rng, TEMPLATE_THEMES)
  const n = instance.values.length > 0 ? instance.values.length : instance.list?.length ?? 0

  const slots: Record<string, string> = {
    object: theme.object,
    objectPlural: theme.objectPlural,
    place: theme.place,
    action: theme.actionVerb,
    target: theme.target,
    lower: theme.lowerWord,
    equal: theme.equalWord,
    higher: theme.higherWord,
    n: String(n),
    // "This is Binary Search, and it has to be done by the book." — the topic
    // label, not the problem title, which reads badly lowercased mid-sentence.
    problem: TOPIC_LABELS[problem.topic],
  }

  const title = `${fillSlots(theme.titleTemplate, slots)} — ${pick(rng, theme.titleTails)}`
  const story = fillSlots(theme.storyTemplate, slots)
  const lowerFirst = (s: string): string => (s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s)

  const targetClause =
    instance.target !== undefined
      ? ` The ${theme.target} reads ${instance.target}, and it is in there somewhere.`
      : ''

  const intro =
    `${story} Right now the ${theme.place} holds ${n} ${theme.objectPlural}.${targetClause} ` +
    `Work one at a time; the hints spell out the plan if you want them.`

  const objective =
    `In the ${theme.place}, ${lowerFirst(problem.learningObjective)}`

  // The pool is ladder hints for this problem's operations, but an LLM tier may
  // have authored a pool of its own. `hintPoolFor` is the SAFE default; the
  // screen below is what makes an authored pool safe to ship, and it lives here
  // because this is the last point at which a spec exists before it reaches a
  // client. Anything the screen rejects is replaced by the engine's own
  // state-derived description at serve time (`hint-safety.ts`), so a spec with a
  // rejected pool is still a playable spec — this is belt-and-braces on top of
  // that, and it fails the generation rather than the learner.
  //
  // Hints come from the operation ladder, not from the canonical text. Ordered
  // weakest-to-strongest ACROSS the whole problem, as `NarrationSchema`
  // requires: every operation's principle first, then every operation's
  // constraint. Within a problem that is a more useful ladder than per-operation
  // deepening, because the learner is usually stuck on WHICH operation to do
  // next rather than on how to execute one they have identified.
  const hintPool = hintPoolFor(problem, slots)

  const win =
    `The ${theme.target} gives. Every ${theme.object} in the ${theme.place} was handled in the ` +
    `order the plan demanded — ${problem.complexity.time} in the worst case, ` +
    `${problem.complexity.space} of extra space, and not one step spent that the algorithm did ` +
    `not require.`

  const lose =
    `The ${theme.target} stays shut. The ${theme.place} resets, but the ${theme.objectPlural} ` +
    `are exactly where you left them, and so is the plan. Same rules, different order.`

  const mechanics = chooseTemplateMechanics(problem.allowedMechanics, difficulty, problem.requiredMechanics).map((id) => {
    const def = MECHANICS[id]
    const label = mechanicLabel(id, theme)
    return { id, boundDsaOp: def.op, label, hint: `${label} — the ${def.op} step of the algorithm.` }
  })

  const actionMeaning: Record<string, string> = {}
  for (const m of mechanics) {
    const def = MECHANICS[m.id]
    actionMeaning[m.id] = `${m.label} — the ${def.op} operation. Mechanically: ${def.description}`
  }

  const summary =
    `You worked the ${theme.place} one ${theme.object} at a time until the ${theme.target} ` +
    `resolved. What this problem is built to teach: ${problem.learningObjective} The run is ` +
    `bounded by ${problem.complexity.time} time and ${problem.complexity.space} extra space, ` +
    `and that bound comes from the algorithm rather than from how carefully you played.`

  // Objects, not `[from, to]` tuples: see the note on DebriefSchema.mapping in
  // game-schema. Tuples compile to a JSON-Schema form that opencode-go rejects.
  const mapping: { gameTerm: string; algorithmTerm: string }[] = [
    { gameTerm: theme.object, algorithmTerm: 'a single data element — one array slot or one node value' },
    { gameTerm: theme.objectPlural, algorithmTerm: CONTAINER_TERM[problem.topic] },
    { gameTerm: theme.place, algorithmTerm: SCOPE_TERM[problem.topic] },
    {
      gameTerm: `${theme.lowerWord} / ${theme.equalWord} / ${theme.higherWord}`,
      algorithmTerm: 'the three outcomes of a comparison: less than, equal, greater than',
    },
  ]

  // Re-parsing applies every zod default and proves the spec validates before
  // it ever reaches a client. If this throws, tier 4 has a bug — fail loudly.
  return GameSpecSchema.parse({
    specVersion: 1,
    problemId: problem.id,
    seed,
    language: input.language ?? 'en',
    objective,
    theme: { title, story, genre: theme.genre, tone: theme.tone },
    visual: {
      palette: theme.palette,
      // An ordered palette, not a map: see the note on VisualSchema in game-schema.
      objectGlyphs: Object.values(theme.glyphs),
      boardLabel: theme.boardLabel,
    },
    vocabulary: {
      object: theme.object,
      objectPlural: theme.objectPlural,
      place: theme.place,
      actionVerb: theme.actionVerb,
      target: theme.target,
      lowerWord: theme.lowerWord,
      equalWord: theme.equalWord,
      higherWord: theme.higherWord,
    },
    mechanics,
    narration: {
      intro,
      hintPool,
      win,
      lose,
      correctFlavour: [
        `The ${theme.object} settles into place.`,
        `One down in the ${theme.place}.`,
        `The ${theme.place} exhales.`,
      ],
    },
    debrief: { summary, actionMeaning, mapping },
    generatedBy: 'template',
  })
}

export class TemplateProvider implements SpecProvider {
  readonly tier = 'template' as const

  async isAvailable(): Promise<boolean> {
    return true
  }

  async generate(input: GenerateSpecInput): Promise<GameSpec> {
    return buildTemplateSpec(input)
  }
}
