/**
 * The deterministic interview-kit fallback: the guarantee that generation
 * always returns questions.
 *
 * Built only from the company profile (deterministic process facts) and the
 * stored resume (user-authored truth). No model, no invention: every
 * `sourceRef` points at a real resume item id, every `practice.problemId`
 * points at a real catalogue problem, and every `listeningFor` line is
 * template text from the profile — never model-authored.
 */

import { PROBLEMS } from '@dsa/game-schema'
import { resolveCompany } from './companies.js'
import { practiceForSkill } from './practice.js'
import { InterviewKitSchema, type InterviewKit, type InterviewQuestion, type QuestionType, type Target } from './schema.js'
import type { Resume } from './schema.js'

export interface TemplateKitInput {
  resume: Resume
  target: Target
  /** When true, rotate which skills seed the coding questions. */
  newAngle?: boolean
  seed?: number
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickN<T>(rand: () => number, items: readonly T[], n: number): T[] {
  const pool = [...items]
  const out: T[] = []
  while (pool.length > 0 && out.length < n) {
    const i = Math.floor(rand() * pool.length)
    out.push(pool.splice(i, 1)[0] as T)
  }
  return out
}

export const CODING_BY_AXIS: Record<string, { problemId: string; prompt: string; why: string }[]> = {
  dsa: [
    { problemId: 'two-sum', prompt: 'Given an array and a target, find two indices whose values sum to the target. Talk through the trade-off between the brute force and the hash-map pass.', why: 'Classic hash-map reasoning under time pressure.' },
    { problemId: 'binary-search', prompt: 'Search for a target in a sorted array. Explain why each comparison lets you discard half of what remains.', why: 'Tests the halve-and-discard invariant, not just the code.' },
    { problemId: 'valid-parentheses', prompt: 'Decide whether a string of brackets is valid. What does the stack give you that a counter does not?', why: 'Stack discipline plus a follow-up about generalisation.' },
  ],
  coding: [
    { problemId: 'two-sum', prompt: 'Given an array and a target, find two indices whose values sum to the target. Talk through the trade-off between the brute force and the hash-map pass.', why: 'Classic hash-map reasoning under time pressure.' },
    { problemId: 'sliding-window-max-sum', prompt: 'Find the maximum sum of any window of size k. Why does reusing the previous window sum beat recomputing?', why: 'Sliding-window reuse is the whole insight.' },
    { problemId: 'merge-intervals', prompt: 'Merge overlapping intervals. What does sorting buy you before the scan starts?', why: 'Sort-then-scan is a transferable pattern.' },
  ],
  ml: [
    { problemId: 'kadane-max-subarray', prompt: 'Find the maximum subarray sum. Relate the extend-or-restart decision to an optimisation step you have run in training.', why: 'Connects DP recurrence thinking to optimisation.' },
  ],
  math: [
    { problemId: 'climbing-stairs', prompt: 'Count the ways to climb n stairs taking 1 or 2 steps. Derive the recurrence before writing code.', why: 'Recurrence-first reasoning.' },
  ],
  build: [
    { problemId: 'move-zeroes', prompt: 'Move all zeroes to the end in place. How do you keep the relative order of everything else?', why: 'In-place two-pointer discipline.' },
  ],
  system: [
    { problemId: 'union-find-connect', prompt: 'Count connected components as edges arrive. Why does union-find beat re-running BFS after each edge?', why: 'Incremental connectivity reasoning.' },
  ],
}

export const CONCEPT_QUESTIONS: { prompt: string; why: string; listeningFor: string }[] = [
  { prompt: 'Explain Big-O to a teammate who has never seen it. When does a linear scan beat a logarithmic search in practice?', why: 'Checks calibrated complexity intuition, not recited definitions.', listeningFor: 'Growth with input size, constants, and when the theoretically faster approach loses.' },
  { prompt: 'Hash table vs balanced tree: when do you pick which, and what breaks if you pick wrong?', why: 'Trade-off reasoning over API recall.', listeningFor: 'Ordering needs, worst-case behaviour, and hash quality.' },
  { prompt: 'What is the difference between a process, a thread, and an async task in the stack you use most?', why: 'Concurrency fundamentals behind everyday bugs.', listeningFor: 'Shared memory, scheduling, and where blocking actually happens.' },
]

export const ML_QUESTIONS: { prompt: string; why: string; listeningFor: string }[] = [
  { prompt: 'Explain overfitting and three distinct ways you have actually fought it.', why: 'Grounds regularisation talk in lived experience.', listeningFor: 'A concrete story per technique, plus how they knew it worked.' },
  { prompt: 'How do you evaluate a model when the metric the business cares about is not differentiable?', why: 'Proxy metrics and offline/online gaps.', listeningFor: 'Surrogate metrics, validation design, and shipping criteria.' },
]

export const SYSTEM_QUESTIONS: { prompt: string; why: string; listeningFor: string }[] = [
  { prompt: 'Design a URL shortener for 100M URLs a day. Where does it break first as traffic grows 10x?', why: 'Standard scale-out walkthrough.', listeningFor: 'Bottleneck-first thinking: storage, cache, and ID generation.' },
  { prompt: 'Design a rate limiter for a public API. How do your choices change between per-user and global limits?', why: 'State, clocks, and distributed trade-offs.', listeningFor: 'Token bucket vs fixed window, and where the state lives.' },
]

export function templateInterviewKit(input: TemplateKitInput): InterviewKit {
  const { resume, target } = input
  const company = resolveCompany({ companyId: target.companyId, customCompany: target.customCompany })
  const rand = mulberry((input.seed ?? 7) + (input.newAngle ? 1013904223 : 0))
  const questions: InterviewQuestion[] = []
  let n = 0
  const id = (prefix: string): string => `${prefix}-${(n += 1)}`

  // 1. Resume deep-dives: the strongest, most recent experience first.
  const exps = resume.experience.slice(0, 3)
  for (const e of exps) {
    if (questions.length >= 12) break
    const bullet = e.bullets[0]
    questions.push({
      id: id('q'),
      type: 'resume-deep-dive',
      prompt: `Walk through your work as ${e.title} at ${e.company}.${bullet ? ` Start with: "${bullet.slice(0, 140)}".` : ''} What was the hardest technical decision, and what did you rule out?`,
      whyItFits: `Anchored in your ${e.title} role so the answer is a story you actually lived.`,
      sourceRef: e.id,
      difficulty: 'medium',
      followUps: ['What would you do differently with twice the time?', 'How did you know it worked?'],
      listeningFor: 'A specific decision, the alternatives considered, and how the outcome was verified.',
    })
  }

  // 2. Coding questions from the company's top coding axis, rotated by seed.
  const codingAxis = company.hiringAxes.find((a) => a.categories.includes('coding')) ?? company.hiringAxes[0]!
  const pool = CODING_BY_AXIS[codingAxis.id] ?? CODING_BY_AXIS.coding!
  const skills = resume.skills.length > 0 ? resume.skills : [{ id: 'general', name: 'general' }]
  for (const item of pickN(rand, pool, 3)) {
    if (questions.length >= 12) break
    const problem = PROBLEMS.find((p) => p.id === item.problemId)
    if (!problem) continue
    const skill = skills[Math.floor(rand() * skills.length)]!
    const practice = practiceForSkill(skill.name)
    questions.push({
      id: id('q'),
      type: 'coding',
      prompt: item.prompt,
      whyItFits: `${item.why} Fits the ${codingAxis.label} axis at ${company.label}.`,
      sourceRef: skill.id,
      difficulty: 'medium',
      followUps: ['What is the time and space cost, and why?', 'What breaks first on adversarial input?'],
      listeningFor: `A working approach for ${problem.title.toLowerCase()}, stated complexity, and one edge case.`,
      practice: { problemId: problem.id },
    })
    void practice
  }

  // 3. Behavioral from company values.
  const value = company.values[0] ?? 'Ownership'
  questions.push({
    id: id('q'),
    type: 'behavioral',
    prompt: `Tell me about a time you demonstrated ${value.toLowerCase()}. What was the situation, what did you personally do, and what changed because of it?`,
    whyItFits: `Directly probes the ${company.label} value: ${value}.`,
    sourceRef: exps[0]?.id ?? 'general',
    difficulty: 'easy',
    followUps: ['What feedback did you get afterwards?'],
    listeningFor: 'A specific situation, personal actions (not "we"), and a measurable outcome.',
  })

  // 4. Concepts / system / ML per remaining axes.
  const needsSystem = company.hiringAxes.some((a) => a.categories.includes('system-design'))
  const needsMl = company.hiringAxes.some((a) => a.categories.includes('ml'))
  if (needsSystem) {
    const q = pickN(rand, SYSTEM_QUESTIONS, 1)[0]!
    questions.push({ id: id('q'), type: 'system-design', prompt: q.prompt, whyItFits: `Covers the system-design axis at ${company.label}.`, sourceRef: 'general', difficulty: 'hard', followUps: ['How do you monitor it in production?'], listeningFor: q.listeningFor })
  } else if (needsMl) {
    const q = pickN(rand, ML_QUESTIONS, 1)[0]!
    questions.push({ id: id('q'), type: 'ml', prompt: q.prompt, whyItFits: `Covers the ML axis at ${company.label}.`, sourceRef: resume.skills[0]?.id ?? 'general', difficulty: 'medium', followUps: ['What did the error analysis show?'], listeningFor: q.listeningFor })
  } else {
    const q = pickN(rand, CONCEPT_QUESTIONS, 1)[0]!
    questions.push({ id: id('q'), type: 'concepts', prompt: q.prompt, whyItFits: 'Probes transferable fundamentals behind the coding rounds.', sourceRef: 'general', difficulty: 'medium', followUps: ['Give a concrete example from your own work.'], listeningFor: q.listeningFor })
  }

  // 5. Project question when a project exists.
  const proj = resume.projects[0]
  if (proj && questions.length < 12) {
    questions.push({
      id: id('q'),
      type: 'resume-deep-dive',
      prompt: `Walk through ${proj.name}. What was the hardest part to get right, and how is it architected?`,
      whyItFits: 'Projects reveal taste and follow-through beyond day-job roles.',
      sourceRef: proj.id,
      difficulty: 'medium',
      followUps: ['What would you rebuild first?'],
      listeningFor: 'Architecture overview, one genuinely hard part, and honest limitations.',
    })
  }

  // Guarantee the 4..12 contract even for an empty resume.
  while (questions.length < 4) {
    const q = CONCEPT_QUESTIONS[questions.length % CONCEPT_QUESTIONS.length]!
    questions.push({ id: id('q'), type: 'concepts', prompt: q.prompt, whyItFits: 'Fundamentals every onsite probes.', sourceRef: 'general', difficulty: 'easy', followUps: [], listeningFor: q.listeningFor })
  }

  return InterviewKitSchema.parse({
    version: 1,
    target,
    questions: questions.slice(0, 12),
    generatedBy: 'template',
  })
}

export type { QuestionType }
