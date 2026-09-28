/**
 * The GameSpec: the ONLY thing an LLM is allowed to produce.
 *
 * Design rule enforced here: the model fills *presentation* and *narration*
 * text slots and picks mechanics from the fixed catalog. It can never express
 * correctness, expected answers, win conditions, or code — those come from the
 * deterministic oracle. The schema is `strict()` so unknown fields (an
 * over-eager `correct: true`) are rejected outright.
 */

import { z } from 'zod'
import { MECHANIC_IDS, DSA_OPS } from './mechanics.js'

const MechId = z.enum(MECHANIC_IDS)
const Op = z.enum(DSA_OPS)

/** Bounded natural-language string so the model cannot ramble. */
const Line = z.string().min(1).max(240)
const Sentence = z.string().min(1).max(400)
const Paragraph = z.string().min(1).max(1200)

export const VisualSchema = z
  .object({
    palette: z
      .object({
        background: Line,
        primary: Line,
        accent: Line,
        success: Line,
        danger: Line,
      })
      .strict(),
    objectGlyphs: z.record(z.string().max(40), z.string().min(1).max(24)).default({}),
    boardLabel: Line.optional(),
  })
  .strict()

export const VocabularySchema = z
  .object({
    /** What one data element is called in the theme, e.g. "room". */
    object: Line,
    objectPlural: Line,
    /** What the data collection is called, e.g. "the west wing". */
    place: Line,
    /** Verb used for the main operation, e.g. "search", "compare", "push". */
    actionVerb: Line,
    /** What the target is called, e.g. "the vault". */
    target: Line,
    /** How a comparison result reads, e.g. "lower", "equal", "higher". */
    lowerWord: Line,
    equalWord: Line,
    higherWord: Line,
  })
  .strict()

export const MechanicBindingSchema = z
  .object({
    id: MechId,
    /** Which real DSA op this mechanic instance represents. */
    boundDsaOp: Op,
    /** Theme-flavoured name for the interaction, e.g. "enter the left wing". */
    label: Line,
    /** Optional one-line nudge shown before the player acts. */
    hint: Line.optional(),
  })
  .strict()

export const NarrationSchema = z
  .object({
    intro: Paragraph,
    /** Ordered hint pool; the engine/Laya picks which to reveal next. */
    hintPool: z.array(Line).min(2).max(6),
    win: Paragraph,
    lose: Paragraph,
    /** Optional flavour shown on a correct action. */
    correctFlavour: z.array(Line).max(4).default([]),
  })
  .strict()

export const DebriefSchema = z
  .object({
    /** One-paragraph recap of what the player actually did. */
    summary: Paragraph,
    /**
     * Per-action-type player-facing explanation of the algorithmic meaning.
     * Keys must be action types. No correctness claims, no answers.
     */
    actionMeaning: z.record(z.string().max(40), Line).default({}),
    /** Optional metaphor-to-algorithm table: [gameTerm, algorithmTerm]. */
    mapping: z.array(z.tuple([Line, Line])).max(12).default([]),
    /** Language tags for the code blocks (the code itself is oracle-owned). */
    codeLanguages: z.array(z.string().min(2).max(20)).max(4).default(['javascript', 'python']),
  })
  .strict()

export const GameSpecSchema = z
  .object({
    specVersion: z.literal(1),
    problemId: z.string().min(1).max(60),
    seed: z.number().int().nonnegative(),
    language: z.string().min(2).max(10).default('en'),

    /** Plain-language restatement of the learning objective, in theme. */
    objective: Sentence,

    theme: z
      .object({
        title: Line,
        story: Paragraph,
        genre: z.enum(['fantasy', 'sci-fi', 'detective', 'everyday', 'sport', 'cooking', 'space', 'nature']),
        tone: z.enum(['playful', 'tense', 'calm', 'mysterious']),
      })
      .strict(),

    visual: VisualSchema,
    vocabulary: VocabularySchema,

    /** 1..4 mechanics, all of which must be in the problem's allowed set. */
    mechanics: z.array(MechanicBindingSchema).min(1).max(4),

    narration: NarrationSchema,
    debrief: DebriefSchema,

    /** Records which provider tier produced this spec. Set by the server. */
    generatedBy: z.string().max(40).default('unknown'),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const ids = spec.mechanics.map((m) => m.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['mechanics'],
        message: 'Duplicate mechanic ids in mechanics[]',
      })
    }
  })

export type GameSpec = z.infer<typeof GameSpecSchema>
export type MechanicBinding = z.infer<typeof MechanicBindingSchema>
export type Vocabulary = z.infer<typeof VocabularySchema>
export type Debrief = z.infer<typeof DebriefSchema>
export type Theme = GameSpec['theme']

/**
 * Parse an LLM response, tolerating code fences and a stray wrapper object.
 * Returns null on any failure so callers can fall through to the next tier.
 */
export function parseGameSpecLoose(raw: unknown): GameSpec | null {
  const unwrapped = unwrap(raw)
  if (unwrapped === null) return null
  const res = GameSpecSchema.safeParse(unwrapped)
  return res.success ? res.data : null
}

/** Full error report for logging / repair prompts. */
export function explainGameSpecError(raw: unknown): string {
  const unwrapped = unwrap(raw)
  const res = GameSpecSchema.safeParse(unwrapped)
  if (res.success) return ''
  return res.error.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .slice(0, 12)
    .join('; ')
}

function unwrap(raw: unknown): unknown {
  let value = raw
  if (typeof value === 'string') {
    let text = value.trim()
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fence?.[1]) text = fence[1].trim()
    try {
      value = JSON.parse(text)
    } catch {
      return null
    }
  }
  // Tolerate models that wrap the payload in { spec: ... } or { game: ... }.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>
    if (rec.spec && typeof rec.spec === 'object') return rec.spec
    if (rec.game && typeof rec.game === 'object') return rec.game
    if (rec.gameSpec && typeof rec.gameSpec === 'object') return rec.gameSpec
  }
  return value
}
