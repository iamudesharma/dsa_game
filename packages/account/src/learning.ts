import { z } from 'zod'

export const ChatReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('problem'), problemId: z.string().min(1).max(80) }).strict(),
  z.object({ type: z.literal('run'), gameId: z.string().min(1).max(100), step: z.number().int().nonnegative().optional() }).strict(),
  z.object({ type: z.literal('interview'), kitId: z.string().min(1).max(100), questionId: z.string().min(1).max(100) }).strict(),
])
export type ChatReference = z.infer<typeof ChatReferenceSchema>
export const HistoryFilterSchema = z.object({
  topic: z.string().max(80).optional(),
  from: z.number().nonnegative().optional(),
  to: z.number().nonnegative().optional(),
}).strict()
export const ChatContextSchema = z
  .object({
    history: z.boolean().default(true),
    resume: z.boolean().default(false),
    target: z.boolean().default(false),
    reference: ChatReferenceSchema.optional(),
    historyFilter: HistoryFilterSchema.optional(),
  })
  .strict()
export type ChatContext = z.infer<typeof ChatContextSchema>
export const ChatActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('game'),
      problemId: z.string().min(1).max(80),
      difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    })
    .strict(),
  z.object({ type: z.literal('interview') }).strict(),
  z
    .object({
      type: z.literal('plan'),
      title: z.string().min(1).max(160),
      content: z.string().min(1).max(16000),
    })
    .strict(),
])
export type ChatAction = z.infer<typeof ChatActionSchema>
export const ChatSendSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    text: z.string().trim().min(1).max(8000),
    context: ChatContextSchema,
    regenerate: z.boolean().default(false),
  })
  .strict()
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  status: z.enum(['complete', 'streaming', 'interrupted', 'failed']),
  createdAt: z.number(),
  requestId: z.string(),
  actions: z.array(ChatActionSchema).default([]),
  context: ChatContextSchema.optional(),
  sources: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
})
export type LearningMessage = z.infer<typeof ChatMessageSchema>
export const LearningThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
})
export type LearningThread = z.infer<typeof LearningThreadSchema>
export const StudyPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(16000),
  createdAt: z.number().nonnegative(),
})
export type StudyPlan = z.infer<typeof StudyPlanSchema>
export const ReflectionSchema = z
  .object({ retention: z.string().max(8000), integration: z.string().max(8000), skipped: z.boolean() })
  .strict()
export const PracticeRecordSchema = z.object({
  gameId: z.string(),
  problemId: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  seed: z.number(),
  startedAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
  outcome: z.string(),
  steps: z.number().int().nonnegative(),
  mistakes: z.number().int().nonnegative(),
  hints: z.number().int().nonnegative(),
  mistakesByMechanic: z.record(z.string(), z.number().int().nonnegative()),
})
export type PracticeRecord = z.infer<typeof PracticeRecordSchema>
export type ChatEvent =
  | { type: 'status'; message: string }
  | { type: 'text'; text: string }
  | { type: 'actions'; actions: ChatAction[] }
  | { type: 'complete'; message: LearningMessage }
  | { type: 'error'; message: string }
export interface ReviewItem {
  problemId: string
  dueAt: number
  stage: number
}
export interface LearningDashboard {
  records: PracticeRecord[]
  completed: Record<string, string>
  reviews: ReviewItem[]
  topics: {
    topic: string
    completed: number
    total: number
    attempts: number
    mistakes: number
    hints: number
  }[]
  recommendation: { problemId: string; reason: string; action?: 'resume' | 'start'; gameId?: string } | null
}
