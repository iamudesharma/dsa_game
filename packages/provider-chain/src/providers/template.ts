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
  type DsaTopic,
  type Difficulty,
  type GameSpec,
  type MechanicId,
} from '@dsa/game-schema'
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
}

const SCOPE_TERM: Record<DsaTopic, string> = {
  arrays: 'the part of the array still under consideration',
  sorting: 'the range that is not sorted yet',
  'binary-search': 'the half of the range still under consideration',
  stack: 'the top of the stack, where every push and pop happens',
  queue: 'the ends of the queue, front and rear',
  'linked-list': 'the position the cursor has reached so far',
}

/**
 * Only used when `canonicalAlgorithm` is too short to yield two hint steps.
 * Each line is an unconditional property of the structure, so it cannot be
 * false for a particular instance.
 */
const TOPIC_FALLBACK_HINT: Record<DsaTopic, string> = {
  arrays: 'Read one value at a time, and keep every decision in a single recorded place.',
  sorting: 'Compare neighbours, and only ever exchange two that are out of order.',
  'binary-search': 'Every comparison should leave roughly half of what is left still in play.',
  stack: 'Push when you meet an opener, pop when you meet a closer, and never pop an empty stack.',
  queue: 'Enqueue at the rear, dequeue from the front, and the front is the one that leaves first.',
  'linked-list': 'The only way forward is to follow a next pointer from the node you are on.',
}

/** Theme-flavoured name for each interaction. All slots come from the theme. */
function mechanicLabel(id: MechanicId, t: ThemeDef): string {
  switch (id) {
    case 'selectObject':
      return `take a ${t.object} in hand`
    case 'moveObject':
      return `shift a ${t.object} to another spot`
    case 'swapPair':
      return `trade places between two ${t.objectPlural}`
    case 'comparePair':
      return `${t.actionVerb} two ${t.objectPlural} against each other`
    case 'pushPop':
      return `stack or unstack a ${t.object}`
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
 * A step that *asserts the result* rather than describing a move.
 *
 * Several canonical algorithms end with their own solution ("best is the
 * answer", "the answer is (indexOf(need), i)", "The new head is prev"). Quoting
 * those verbatim as a hint would hand the player the answer, which is the one
 * thing a spec must never do — so result-asserting steps are dropped from the
 * pool while the *procedure* steps are kept. The hints are still the algorithm,
 * just not its conclusion.
 */
const RESULT_ASSERTION =
  /\b(?:answer|result|new head|final value|answer pair)\s+(?:is|are)\b|\b(?:is|are)\s+(?:the\s+)?(?:answer|result|new head|target|final value)\b|\bbest\s+is\b/i

/**
 * Split the canonical algorithm into ordered steps. The canonical text is
 * written as sentences, so splitting on sentence punctuation yields statements
 * that are true by construction — the hint pool can never drift from the
 * algorithm because it *is* the algorithm.
 */
function algorithmSteps(canonical: string): string[] {
  const sentences = canonical
    .split(/(?<=[.;])\s+/)
    .map((s) => s.replace(/[.;\s]+$/, '').trim())
    .filter((s) => s.length > 0)
  if (sentences.length > 1) return safeSteps(sentences)
  // Some canonical algorithms are one long comma-chained sentence (bubble sort).
  // Splitting on commas keeps every fragment a true statement.
  const fragments = sentences[0]?.split(/,\s+/) ?? []
  return safeSteps(fragments.map((f) => f.trim()).filter((f) => f.length > 0))
}

function safeSteps(steps: string[]): string[] {
  return steps.filter((s) => !RESULT_ASSERTION.test(s))
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

  // Hints: canonical steps first, topically-true fallback only if we are short.
  const steps = algorithmSteps(problem.canonicalAlgorithm)
  const hintPool: string[] = steps.slice(0, 6).map((step, i) =>
    i === 0 ? `First move: ${step}.` : `Then: ${step}.`,
  )
  if (hintPool.length < 2) hintPool.push(TOPIC_FALLBACK_HINT[problem.topic])
  if (hintPool.length < 2) {
    hintPool.push(`Keep every decision about the ${theme.target} in the same place.`)
  }

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

  const mapping: [string, string][] = [
    [theme.object, 'a single data element — one array slot or one node value'],
    [theme.objectPlural, CONTAINER_TERM[problem.topic]],
    [theme.place, SCOPE_TERM[problem.topic]],
    [
      `${theme.lowerWord} / ${theme.equalWord} / ${theme.higherWord}`,
      'the three outcomes of a comparison: less than, equal, greater than',
    ],
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
      objectGlyphs: { ...theme.glyphs },
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
