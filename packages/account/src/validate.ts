/**
 * Grounding validator: the guarantee that a kit only references facts that
 * exist.
 *
 * Three checks, in order:
 *   1. schema — strict Zod parse, unknown keys rejected;
 *   2. references — every `sourceRef` must be a resume item id (or `general`),
 *      every `practice.problemId` must be a known, playable catalogue problem;
 *   3. fabrication — the kit must not assert company process facts (percentages,
 *      "always asks", named proprietary rounds, interviewer names).
 *
 * A validator, not a prompt rule — same principle as `coach/guardrails.ts`.
 */

import { PROBLEMS } from '@dsa/game-schema'
import { InterviewKitSchema, type InterviewKit, type Resume } from './schema.js'
import { resumeSourceIds } from './resume.js'

export interface GroundingResult {
  ok: boolean
  kit: InterviewKit | null
  issues: string[]
}

export const FABRICATION_PATTERNS: { id: string; re: RegExp; reason: string }[] = [
  { id: 'percentage', re: /\b\d{1,3}\s*%/, reason: 'Asserts a specific percentage about the process' },
  { id: 'always-asks', re: /\b(always|never)\s+(asks?|tests?|requires?)\b/i, reason: 'Asserts an absolute about what the company asks' },
  { id: 'proprietary-round', re: /\b(superday|onsite\s+loop\s+[A-Z]|round\s+[47]\b|secret\s+round)\b/i, reason: 'Names a specific proprietary round' },
  { id: 'interviewer-name', re: /\b(interviewer|hiring manager)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/, reason: 'Names a specific person' },
  { id: 'guarantee', re: /\b(guaranteed|100%\s+(chance|pass)|will\s+definitely\s+ask)\b/i, reason: 'Guarantees an outcome' },
  { id: 'salary-claim', re: /\$\s?\d[\d,]*(k\b)?|\b\d{2,3}k\s+(salary|comp|offer)\b/i, reason: 'Asserts compensation figures' },
]

function kitText(kit: InterviewKit): string {
  return kit.questions.map((q) => `${q.prompt}\n${q.whyItFits}\n${q.listeningFor}\n${q.followUps.join('\n')}`).join('\n')
}

/**
 * Validate an LLM-produced kit against the stored resume and the catalogue.
 * Returns the parsed kit when every check passes, else the list of issues.
 *
 * `playableIds` is the set of problem ids with a registered oracle, supplied
 * by the API service (which owns the oracle registry). Passing it in keeps
 * this package free of the oracle dependency.
 */
export function validateInterviewKit(
  raw: unknown,
  resume: Resume,
  playableIds?: Set<string>,
): GroundingResult {
  const parsed = InterviewKitSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      kit: null,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).slice(0, 12),
    }
  }
  const kit = parsed.data
  const issues: string[] = []
  const validRefs = resumeSourceIds(resume)

  for (const q of kit.questions) {
    if (!validRefs.has(q.sourceRef)) {
      issues.push(`question ${q.id}: sourceRef '${q.sourceRef}' is not in the resume`)
    }
    if (q.practice) {
      const problem = PROBLEMS.find((p) => p.id === q.practice!.problemId)
      if (!problem) {
        issues.push(`question ${q.id}: practice.problemId '${q.practice.problemId}' is not in the catalogue`)
      } else if (playableIds && !playableIds.has(problem.id)) {
        issues.push(`question ${q.id}: practice.problemId '${q.practice.problemId}' has no oracle yet`)
      }
    }
  }

  const text = kitText(kit)
  for (const pat of FABRICATION_PATTERNS) {
    if (pat.re.test(text)) issues.push(`fabrication:${pat.id}: ${pat.reason}`)
  }

  if (issues.length > 0) return { ok: false, kit: null, issues }
  return { ok: true, kit, issues: [] }
}

/** Screen a single hint-style string for fabrication (unit-test helper). */
export function findFabrication(text: string): string | null {
  for (const pat of FABRICATION_PATTERNS) {
    if (pat.re.test(text)) return pat.id
  }
  return null
}
