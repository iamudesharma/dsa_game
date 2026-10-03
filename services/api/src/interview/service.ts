/**
 * Interview-kit generation.
 *
 * Mirrors `chainGenerateSpec` in shape: try the model, validate strictly,
 * fall back to the deterministic template. The model fills wording; the
 * registry (`@dsa/account/companies`) owns process facts and the stored
 * resume owns candidate facts. `validateInterviewKit` enforces both.
 */

import { PROBLEMS } from '@dsa/game-schema'
import {
  resolveCompany,
  resumeSourceIds,
  resumeToText,
  templateInterviewKit,
  validateInterviewKit,
  InterviewKitSchema,
  type InterviewKit,
  type Resume,
  type Target,
} from '@dsa/account'
import { getOracle } from '@dsa/dsa-oracles'
import { defaultChatTransport } from '@dsa/provider-chain'
import type { ChatTransport } from '@dsa/provider-chain'

export interface InterviewGenerateResult {
  kit: InterviewKit
  usedTier: string
  notes: string[]
}

function playableIds(): Set<string> {
  return new Set(PROBLEMS.filter((p) => getOracle(p.id) !== undefined).map((p) => p.id))
}

function playableList(): string {
  return [...playableIds()].sort().join(', ')
}

function buildPrompt(resume: Resume, target: Target): { system: string; user: string } {
  const company = resolveCompany({ companyId: target.companyId, customCompany: target.customCompany })
  const validRefs = [...resumeSourceIds(resume)].sort().join(', ')
  const system = [
    'You write interview-prep questions as strict JSON. No prose outside the JSON object.',
    'RULES:',
    '- Every question.sourceRef MUST be one of the allowed ids listed by the user. Never invent an id.',
    '- Every question.practice.problemId, when present, MUST be one of the allowed catalogue ids. Never invent one.',
    '- Never assert facts about the company hiring process: no percentages, no "always asks", no named proprietary rounds, no interviewer names, no compensation figures, no guaranteed outcomes.',
    '- question.listeningFor must describe what an interviewer listens for in plain terms, grounded in the company values given.',
    '- question.difficulty MUST be exactly easy, medium, or hard.',
    '- question.type MUST be exactly behavioral, coding, concepts, system-design, resume-deep-dive, or ml.',
    '- question.practice, when present, is an object with only problemId.',
    '- Keep each prompt under 800 characters.',
  ].join('\n')
  const user = [
    `GOAL: ${target.goal}`,
    `COMPANY: ${company.label}`,
    `VALUES: ${company.values.join('; ') || 'none listed'}`,
    `HIRING AXES: ${company.hiringAxes.map((a) => `${a.label} (${a.categories.join('/')})`).join('; ')}`,
    `ROUNDS: ${company.rounds.map((r) => `${r.name}: ${r.focus}`).join('; ') || 'standard screen + onsite'}`,
    `SENIORITY: ${target.seniority}`,
    `FOCUS AREAS: ${target.focusAreas.join(', ') || 'general'}`,
    '',
    'CANDIDATE (only facts you may reference):',
    resumeToText(resume),
    '',
    `ALLOWED sourceRef ids: ${validRefs}`,
    `ALLOWED practice.problemId values: ${playableList()}`,
    '',
    'Return a JSON object with exactly this shape:',
    '{ "version": 1, "target": {goal, companyId, customCompany, seniority, focusAreas}, "questions": [{id, type, prompt, whyItFits, sourceRef, difficulty, followUps, listeningFor, practice?}], "generatedBy": "model" }',
    `The target object must equal: ${JSON.stringify({ goal: target.goal, companyId: target.companyId, customCompany: target.customCompany, seniority: target.seniority, focusAreas: target.focusAreas })}`,
    'Write 8 questions covering: 2 resume-deep-dive, 3 coding (each with a practice.problemId), 1 behavioral, and 2 from concepts/system-design/ml matching the hiring axes.',
  ].join('\n')
  return { system, user }
}

function extractJson(text: string): unknown | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = (fence?.[1] ?? text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function generateInterviewKit(args: {
  resume: Resume
  target: Target
  newAngle?: boolean
  seed?: number
  transport?: ChatTransport | null
  env?: NodeJS.ProcessEnv
}): Promise<InterviewGenerateResult> {
  const notes: string[] = []
  const playable = playableIds()
  const fallback = (): InterviewGenerateResult => ({
    kit: templateInterviewKit({ resume: args.resume, target: args.target, newAngle: args.newAngle, seed: args.seed ?? Date.now() % 2 ** 31 }),
    usedTier: 'template',
    notes,
  })

  // Disabled transport (tests / offline): deterministic path.
  if (args.transport === null || args.env?.INTERVIEW_TRANSPORT === '0') {
    notes.push('model transport disabled; used deterministic template')
    return fallback()
  }

  const { system, user } = buildPrompt(args.resume, args.target)
  try {
    const transport = args.transport === undefined ? await defaultChatTransport(args.env ?? process.env) : args.transport
    if (!transport) {
      notes.push('no model transport configured; used deterministic template')
      return fallback()
    }
    if (!(await transport.isAvailable())) {
      notes.push(`transport '${transport.id}' not configured; used deterministic template`)
      return fallback()
    }
    const reply = await transport.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 4000,
      temperature: 0.7,
    })
    const raw = extractJson(reply.text)
    if (!raw) {
      notes.push(`transport '${transport.id}' returned non-JSON; used deterministic template`)
      return fallback()
    }
    const checked = validateInterviewKit(raw, args.resume, playable)
    if (!checked.ok || !checked.kit) {
      notes.push(`model kit rejected (${checked.issues.slice(0, 3).join('; ')}); used deterministic template`)
      return fallback()
    }
    // Stamp the tier that produced it and re-parse strictly.
    const kit = InterviewKitSchema.parse({ ...checked.kit, generatedBy: transport.id })
    return { kit, usedTier: transport.id, notes }
  } catch (err) {
    notes.push(`model call failed (${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}); used deterministic template`)
    return fallback()
  }
}
