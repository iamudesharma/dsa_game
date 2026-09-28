/**
 * Prompt construction for every generative tier.
 *
 * The system prompt is the *only* place the rules live; tiers 1–3 all send the
 * same two strings so behaviour is comparable across providers. The JSON Schema
 * is the bulk of the token budget and is embedded exactly once.
 */

import {
  gameSpecJsonSchemaForPrompt,
  mechanicsCatalogForPrompt,
  type Difficulty,
} from '@dsa/game-schema'
import type { GenerateSpecInput } from './types.js'

/**
 * Keys the model must never *add*. GameSpecSchema is `strict()`, so an extra
 * `correct: true` anywhere rejects the whole object. Named explicitly so a
 * repair round-trip has something concrete to strip.
 *
 * Note `win` and `result` are legitimate *inside* the documented shape
 * (`narration.win`); the rule is about adding new fields, not about those words.
 */
const FORBIDDEN_KEYS = ['correct', 'expected', 'solution', 'code', 'answer', 'valid', 'hintAnswer'] as const

const HARD_RULES = `HARD RULES — violating any of these makes the payload unusable.

1. You may ONLY write presentation and narration text, and choose which mechanics to enable.
2. You must NEVER reveal, imply or encode the answer. Do not state the correct index,
   the correct value, the correct ordering, or the correct next move anywhere — not in the
   story, not in a hint, not in the debrief, not in a "flavour" line.
3. Never add fields named ${FORBIDDEN_KEYS.map((k) => `"${k}"`).join(', ')}, and never add any
   other key that is not in the schema below. The schema is strict: one unknown key rejects the
   whole object. ("win" inside narration and "codeLanguages" inside debrief are fine — they are
   in the schema.)
4. Mechanics must come from the catalog below. Never invent a mechanic id.
5. Every mechanic id you emit MUST be in the problem's allowedMechanics list, and ids must
   be unique. Use between 1 and 4 of them.
6. "boundDsaOp" for a mechanic must be the catalog's default op for that id. Do not invent
   an op either.
7. vocabulary must be internally consistent: if object is "lantern" then objectPlural is
   "lanterns", and every mechanic label, the story, the hints and the debrief use those same
   nouns. Never mix two vocabularies in one spec.
8. "objective" is a plain-language restatement of the learning objective, phrased in the theme.
   It is a goal, never a procedure and never an answer.
9. narration.hintPool must contain between 2 and 6 lines, ordered from the weakest nudge to
   the most explicit one. Hints teach the ALGORITHM; they must stay true to the canonical
   algorithm you are given and must not contain the answer.
10. debrief.actionMeaning is keyed by mechanic id and explains what that interaction IS in
    algorithm terms. No correctness claims.
11. Output raw JSON only. No markdown fences, no commentary before or after.

MECHANIC CATALOG (the complete set of legal mechanics)
${mechanicsCatalogForPrompt()}`

/**
 * Built lazily: `gameSpecJsonSchemaForPrompt()` walks the whole zod schema, and
 * the template tier never needs it.
 */
let cachedSystem: string | null = null

export function systemPrompt(): string {
  if (cachedSystem) return cachedSystem
  cachedSystem = [
    'You design puzzle-game scenarios that teach exactly one data-structures-and-algorithms',
    'algorithm. You are given one problem, one concrete instance of it, and a seed. You return a',
    'single JSON object: a GameSpec.',
    '',
    'The game engine owns correctness. The oracle decides whether the player is right, what the',
    'answer is, and what code to show in the debrief. Your job is to make the *presentation* of',
    'that algorithm memorable: a theme, a vocabulary, flavourful labels and narration that teach',
    'the idea without ever giving the answer away.',
    '',
    HARD_RULES,
    '',
    'JSON SCHEMA — your output must validate against this exactly',
    gameSpecJsonSchemaForPrompt(),
  ].join('\n')
  return cachedSystem
}

const DIFFICULTY_BRIEF: Record<Difficulty, string> = {
  easy: 'easy — short narration, gentle hints, 2-3 mechanics',
  medium: 'medium — a real narrative hook, 3 mechanics, hints that name the operation',
  hard: 'hard — tense tone, 4 mechanics, hints that push the player to reason about invariants',
}

/**
 * The concrete instance is included on purpose: without the real numbers the
 * model invents labels like "the second lantern" that do not exist.
 */
function instanceBlock(input: GenerateSpecInput): string {
  const { instance } = input
  const lines: string[] = []
  lines.push(`instance.values (the primary data array, in order): ${JSON.stringify(instance.values)}`)
  lines.push(`instance length: ${instance.values.length}`)
  if (instance.target !== undefined) lines.push(`instance.target: ${instance.target}`)
  if (instance.tokens && instance.tokens.length > 0) {
    lines.push(`instance.tokens (the actual sequence to play): ${JSON.stringify(instance.tokens)}`)
  }
  if (instance.list && instance.list.length > 0) {
    const chain = instance.list
      .map((n) => `${n.id}(${n.value})`)
      .join(' -> ')
    lines.push(`instance.list (linked nodes in order): ${chain}`)
  }
  return lines.join('\n')
}

export function userPrompt(input: GenerateSpecInput): string {
  const { problem, seed, difficulty, freeText } = input
  const allowed = problem.allowedMechanics.join(', ')

  const parts: string[] = [
    'Generate one GameSpec for the problem below.',
    '',
    'PROBLEM',
    `title: ${problem.title}`,
    `topic: ${problem.topic}`,
    `learningObjective: ${problem.learningObjective}`,
    `canonicalAlgorithm (this is the ground truth your hints and debrief must stay true to):`,
    `  ${problem.canonicalAlgorithm}`,
    `allowedMechanics (your mechanics[] must be a subset of exactly this list): ${allowed}`,
    `complexity: time ${problem.complexity.time}, space ${problem.complexity.space}`,
    '',
    'ACTUAL INSTANCE (use these real values so any position you refer to is real)',
    instanceBlock(input),
    '',
    `seed: ${seed}`,
    `difficulty: ${DIFFICULTY_BRIEF[difficulty]}`,
    `specVersion: 1`,
  ]

  if (freeText && freeText.trim().length > 0) {
    parts.push(
      '',
      'PLAYER REQUEST (steer the theme towards it; keep every hard rule above)',
      freeText.trim(),
    )
  }

  parts.push(
    '',
    'Set problemId, seed and generatedBy to exactly the values above; the server overwrites',
    'them anyway. Reply with the JSON object and nothing else.',
  )
  return parts.join('\n')
}

/** Convenience: both halves, for providers that take a single string. */
export function buildPrompts(input: GenerateSpecInput): { system: string; user: string } {
  return { system: systemPrompt(), user: userPrompt(input) }
}

/**
 * The one allowed retry. Keeps the original payload out of the prompt (it can
 * be 3k tokens of half-correct JSON) and just states the violations.
 */
export function repairPrompt(issues: string): string {
  return [
    'Your previous reply was rejected. It is NOT valid against the GameSpec JSON Schema.',
    '',
    'Schema violations reported by the validator:',
    issues,
    '',
    'Fix ONLY these problems. Do not change your theme, vocabulary or mechanics choice.',
    'Re-send the complete corrected JSON object and nothing else — no fences, no explanation.',
  ].join('\n')
}

/** Rough token estimate (~4 chars/token), used by the test to police the budget. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}
