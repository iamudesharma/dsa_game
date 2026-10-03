/**
 * `@dsa/account` — the deterministic half of accounts, resumes, targets and
 * interview kits.
 *
 * No I/O here. The API service owns SQLite; the web client owns forms. This
 * package owns the shapes, the company registry, the resume text parser, the
 * deterministic question fallback, and the grounding validator.
 *
 * Design rule (same as the game): the LLM fills wording slots, never facts.
 * Company process facts live in `companies.ts`. Resume facts live in the
 * user's own `Resume` object. The validator in `validate.ts` enforces that a
 * generated kit only references facts that exist.
 */

import { z } from 'zod'

// ------------------------------------------------------------------ resume

const Short = z.string().min(1).max(200)
const Line = z.string().min(1).max(400)
const Para = z.string().min(1).max(2000)

export const SkillLevelSchema = z.enum(['beginner', 'intermediate', 'advanced', 'expert'])
export type SkillLevel = z.infer<typeof SkillLevelSchema>

export const SkillSchema = z
  .object({
    id: z.string().min(1).max(60),
    name: Short,
    level: SkillLevelSchema.optional(),
    years: z.number().min(0).max(50).optional(),
  })
  .strict()
export type Skill = z.infer<typeof SkillSchema>

export const ExperienceSchema = z
  .object({
    id: z.string().min(1).max(60),
    // Same reasoning as `EducationSchema.school`: the grounding validator
    // EMPTIES a date range it could not find in the source text, and a
    // `min(1)` here turned "we dropped the invented date" into a schema
    // violation that rejected the whole resume.
    title: z.string().max(200).default(''),
    company: z.string().max(200).default(''),
    start: z.string().max(30).default(''),
    end: z.string().max(30).default(''),
    bullets: z.array(Line).max(12).default([]),
  })
  .strict()
export type Experience = z.infer<typeof ExperienceSchema>

export const EducationSchema = z
  .object({
    id: z.string().min(1).max(60),
    // `school` and `degree` are `.max()` rather than `Short`: a parser that
    // cannot split a real line (e.g. "BSc Computer Science, TU Berlin" with no
    // explicit school/degree boundary) yields one of them EMPTY, and a
    // `min(1)` there rejected the ENTIRE resume — a hard failure for what is a
    // cosmetic gap. The UI already renders blanks as "School" / "Degree".
    school: z.string().max(200).default(''),
    degree: z.string().max(200).default(''),
    field: z.string().max(120).default(''),
    start: z.string().max(30).default(''),
    end: z.string().max(30).default(''),
  })
  .strict()
export type Education = z.infer<typeof EducationSchema>

export const ProjectSchema = z
  .object({
    id: z.string().min(1).max(60),
    name: Short,
    description: Para,
    tech: z.array(z.string().min(1).max(60)).max(20).default([]),
    link: z.string().max(300).default(''),
  })
  .strict()
export type Project = z.infer<typeof ProjectSchema>

export const ResumeSchema = z
  .object({
    version: z.literal(1).default(1),
    summary: z.string().max(2000).default(''),
    contact: z
      .object({
        name: z.string().max(120).default(''),
        email: z.string().max(160).default(''),
        location: z.string().max(120).default(''),
      })
      .strict()
      .default({ name: '', email: '', location: '' }),
    experience: z.array(ExperienceSchema).max(20).default([]),
    education: z.array(EducationSchema).max(10).default([]),
    projects: z.array(ProjectSchema).max(20).default([]),
    skills: z.array(SkillSchema).max(60).default([]),
    links: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict()
export type Resume = z.infer<typeof ResumeSchema>

export function emptyResume(): Resume {
  return ResumeSchema.parse({})
}

// ------------------------------------------------------------------ target

export const SenioritySchema = z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'principal'])
export type Seniority = z.infer<typeof SenioritySchema>

export const TargetSchema = z
  .object({
    goal: z.string().min(1).max(400),
    companyId: z.string().min(1).max(60),
    customCompany: z.string().max(120).default(''),
    seniority: SenioritySchema.default('mid'),
    focusAreas: z.array(z.string().min(1).max(60)).max(12).default([]),
  })
  .strict()
export type Target = z.infer<typeof TargetSchema>

// ------------------------------------------------------------- interview kit

export const QuestionTypeSchema = z.enum([
  'behavioral',
  'coding',
  'concepts',
  'system-design',
  'resume-deep-dive',
  'ml',
])
export type QuestionType = z.infer<typeof QuestionTypeSchema>

export const InterviewQuestionSchema = z
  .object({
    id: z.string().min(1).max(60),
    type: QuestionTypeSchema,
    prompt: z.string().min(1).max(800),
    whyItFits: z.string().min(1).max(500),
    /** Points at a resume item id (`exp:…`, `skill:…`, `proj:…`) or `general`. */
    sourceRef: z.string().min(1).max(80),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    followUps: z.array(z.string().min(1).max(400)).max(4).default([]),
    listeningFor: z.string().min(1).max(500),
    practice: z.object({ problemId: z.string().min(1).max(60) }).strict().optional(),
  })
  .strict()
export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>

export const InterviewKitSchema = z
  .object({
    version: z.literal(1),
    target: TargetSchema,
    questions: z.array(InterviewQuestionSchema).min(4).max(12),
    generatedBy: z.string().max(40).default('unknown'),
  })
  .strict()
export type InterviewKit = z.infer<typeof InterviewKitSchema>

// -------------------------------------------------------------------- auth

export const SignupBodySchema = z
  .object({
    email: z.string().min(3).max(160),
    password: z.string().min(8).max(200),
  })
  .strict()
export type SignupBody = z.infer<typeof SignupBodySchema>

export const LoginBodySchema = SignupBodySchema
export type LoginBody = SignupBody

export const AuthUserSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
    createdAt: z.number(),
  })
  .strict()
export type AuthUser = z.infer<typeof AuthUserSchema>
