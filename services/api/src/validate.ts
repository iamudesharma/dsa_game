/**
 * Request validation. Mirrors the wire types in `@dsa/game-schema/api-types`
 * so a malformed client request fails with a clear 400 instead of reaching an
 * oracle. Responses are validated by the shared Zod schemas in game-schema.
 */

import { z } from 'zod'
import { ACTION_TYPES, DIFFICULTIES, LEARNER_BANDS } from '@dsa/game-schema'
import type { Difficulty, LearnerBand } from '@dsa/game-schema'
import { ResumeSchema, TargetSchema } from '@dsa/account'

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('selectObject'), objectId: z.string().min(1), actionId: z.string().optional() }),
  z.object({
    type: z.literal('moveObject'),
    objectId: z.string().min(1),
    toSlotId: z.string().min(1),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('comparePair'),
    aId: z.string().min(1),
    bId: z.string().min(1),
    relation: z.enum(['lt', 'eq', 'gt']),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('swapPair'),
    aId: z.string().min(1),
    bId: z.string().min(1),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('pushPop'),
    containerId: z.string().min(1),
    op: z.enum(['push', 'pop']),
    objectId: z.string().min(1).optional(),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('choosePath'),
    fromId: z.string().min(1),
    pathId: z.string().min(1),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('traverseNode'),
    fromNodeId: z.string().min(1),
    toNodeId: z.string().min(1),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('connectNodes'),
    fromNodeId: z.string().min(1),
    toNodeId: z.string().min(1),
    linkKind: z.enum(['next', 'prev']),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('assignValue'),
    targetId: z.string().min(1),
    value: z.string(),
    actionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('submitAnswer'),
    targetId: z.string().min(1),
    value: z.string(),
    actionId: z.string().optional(),
  }),
])

export const GenerateBodySchema = z.object({
  problemId: z.string().min(1),
  seed: z.number().int().nonnegative().optional(),
  difficulty: z.enum(DIFFICULTIES as unknown as [Difficulty, ...Difficulty[]]).optional(),
  freeText: z.string().max(500).optional(),
  forceTemplate: z.boolean().optional(),
})

export const ActionBodySchema = z.object({
  gameId: z.string().min(1),
  action: ActionSchema,
})

export const HintBodySchema = z.object({
  gameId: z.string().min(1),
})

export const UndoBodySchema = z.object({
  gameId: z.string().min(1),
})

export const DecideBodySchema = z.object({
  kind: z.enum(['route-problem', 'pick-theme', 'pick-hint', 'tag-misconception', 'difficulty']),
  stateText: z.string().min(1).max(4000),
  options: z.record(z.string().max(60), z.string().max(200)),
  instructions: z.string().min(1).max(600),
})

/**
 * `POST /api/coach/ask`.
 *
 * `message` is bounded at the schema rather than only in the service. A coach
 * question is a sentence a child typed; anything past 1000 characters is a paste,
 * and an unbounded field would let one request put an arbitrary number of tokens
 * into a conversation that is then billed for. `threadId` is optional because the
 * first question creates the thread, and `title` is a UI nicety for the switcher.
 */
export const CoachAskBodySchema = z.object({
  gameId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  message: z.string().min(1).max(1000),
  band: z.enum(LEARNER_BANDS as unknown as [LearnerBand, ...LearnerBand[]]).optional(),
  title: z.string().max(60).optional(),
})

/**
 * `GET /api/coach/threads?gameId=...`.
 *
 * Validated with the same schema as the body rather than by reading
 * `c.req.query()` directly, so a missing or repeated `gameId` fails as a 400 with a
 * machine-readable code instead of turning into an empty list that looks like
 * "this game has no conversations".
 */
export const CoachThreadsQuerySchema = z.object({
  gameId: z.string().min(1),
})

export type GenerateBody = z.infer<typeof GenerateBodySchema>
export type ActionBody = z.infer<typeof ActionBodySchema>
export type DecideBody = z.infer<typeof DecideBodySchema>
export type CoachAskBody = z.infer<typeof CoachAskBodySchema>

/**
 * `POST /api/auth/signup` and `/api/auth/login`. Bounds match the service:
 * email is normalised + regex-checked there; the schema keeps the wire honest.
 */
export const AuthBodySchema = z
  .object({
    email: z.string().min(3).max(160),
    password: z.string().min(8).max(200),
  })
  .strict()

/** `PUT /api/me/resume`. The full object; the client edits, the server validates. */
export const ResumeBodySchema = ResumeSchema

/** `PUT /api/me/target`. */
export const TargetBodySchema = TargetSchema

/** `POST /api/me/parse-resume`. Pasted text, parsed deterministically. */
export const ParseResumeBodySchema = z
  .object({
    text: z.string().min(1).max(20000),
    save: z.boolean().optional(),
  })
  .strict()

/** `POST /api/interview/generate`. Target comes from the stored profile unless overridden. */
export const InterviewGenerateBodySchema = z
  .object({
    target: TargetSchema.optional(),
    newAngle: z.boolean().optional(),
    seed: z.number().int().nonnegative().optional(),
  })
  .strict()

/** `POST /api/me/progress`. Device-local completion map merged server-side. */
export const ProgressBodySchema = z
  .object({
    completed: z.record(z.string().min(1).max(80), z.string().min(1).max(40)),
  })
  .strict()

export { ActionSchema, ACTION_TYPES }
