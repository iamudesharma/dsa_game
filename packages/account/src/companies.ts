/**
 * The company registry: deterministic hiring data the LLM may rephrase but
 * never invent.
 *
 * Every statement about a company's process lives here, as data. The
 * generation prompt may quote or reword these lines; the grounding validator
 * rejects any kit that asserts process facts (percentages, "always asks",
 * named proprietary rounds, interviewer names) not present in the profile.
 */

import { z } from 'zod'

export const HiringAxisSchema = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
    weight: z.number().min(0).max(1),
    categories: z.array(z.enum(['behavioral', 'coding', 'concepts', 'system-design', 'resume-deep-dive', 'ml'])),
  })
  .strict()
export type HiringAxis = z.infer<typeof HiringAxisSchema>

export const CompanyRoundSchema = z
  .object({
    name: z.string().min(1).max(120),
    focus: z.string().min(1).max(300),
  })
  .strict()
export type CompanyRound = z.infer<typeof CompanyRoundSchema>

export const CompanyProfileSchema = z
  .object({
    id: z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    aliases: z.array(z.string().min(1).max(80)).default([]),
    values: z.array(z.string().min(1).max(200)).max(8).default([]),
    hiringAxes: z.array(HiringAxisSchema).min(1).max(8),
    rounds: z.array(CompanyRoundSchema).max(8).default([]),
    techSignals: z.array(z.string().min(1).max(120)).max(16).default([]),
  })
  .strict()
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>

function profile(p: CompanyProfile): CompanyProfile {
  return CompanyProfileSchema.parse(p)
}

export const COMPANY_PROFILES: readonly CompanyProfile[] = [
  profile({
    id: 'faang-general',
    label: 'Big Tech (general)',
    aliases: ['faang', 'big tech', 'meta', 'google', 'amazon', 'apple', 'microsoft', 'netflix'],
    values: ['Customer focus', 'Ownership', 'Bias for action', 'Insist on highest standards'],
    hiringAxes: [
      { id: 'dsa', label: 'Data structures & algorithms', weight: 0.4, categories: ['coding', 'concepts'] },
      { id: 'behavioral', label: 'Leadership & behavioral', weight: 0.25, categories: ['behavioral'] },
      { id: 'system', label: 'System design (senior+)', weight: 0.2, categories: ['system-design'] },
      { id: 'resume', label: 'Past work depth', weight: 0.15, categories: ['resume-deep-dive'] },
    ],
    rounds: [
      { name: 'Phone screen', focus: 'One or two coding problems with discussion' },
      { name: 'Onsite coding', focus: 'Data structures, algorithms, and trade-offs' },
      { name: 'Behavioral', focus: 'Past ownership, conflict, and delivery stories' },
      { name: 'System design (senior+)', focus: 'Scale a familiar system and defend choices' },
    ],
    techSignals: ['arrays', 'hash tables', 'trees', 'graphs', 'dynamic programming'],
  }),
  profile({
    id: 'ai-lab',
    label: 'AI lab',
    aliases: ['openai', 'anthropic', 'deepmind', 'ai research', 'llm'],
    values: ['Research taste', 'Empirical rigor', 'Mission alignment', 'Fast iteration'],
    hiringAxes: [
      { id: 'ml', label: 'ML fundamentals & reasoning', weight: 0.35, categories: ['ml', 'concepts'] },
      { id: 'coding', label: 'Coding & algorithms', weight: 0.3, categories: ['coding'] },
      { id: 'research', label: 'Research depth', weight: 0.2, categories: ['resume-deep-dive'] },
      { id: 'behavioral', label: 'Mission & collaboration', weight: 0.15, categories: ['behavioral'] },
    ],
    rounds: [
      { name: 'Research discussion', focus: 'Walk through a past project and its trade-offs' },
      { name: 'ML coding', focus: 'Implement and reason about models or algorithms' },
      { name: 'ML concepts', focus: 'Probability, optimisation, and evaluation' },
    ],
    techSignals: ['python', 'pytorch', 'transformers', 'evaluation', 'distributed training'],
  }),
  profile({
    id: 'big-tech-cloud',
    label: 'Cloud / infra',
    aliases: ['aws', 'azure', 'gcp', 'cloud', 'infrastructure', 'platform'],
    values: ['Operational excellence', 'Ownership', 'Customer obsession'],
    hiringAxes: [
      { id: 'coding', label: 'Coding & algorithms', weight: 0.35, categories: ['coding', 'concepts'] },
      { id: 'system', label: 'Distributed systems', weight: 0.35, categories: ['system-design'] },
      { id: 'behavioral', label: 'Ownership stories', weight: 0.2, categories: ['behavioral'] },
      { id: 'resume', label: 'Systems you shipped', weight: 0.1, categories: ['resume-deep-dive'] },
    ],
    rounds: [
      { name: 'Coding', focus: 'Algorithms with an eye on scale' },
      { name: 'System design', focus: 'Design a distributed component' },
      { name: 'Behavioral', focus: 'On-call, incidents, and ownership' },
    ],
    techSignals: ['concurrency', 'networking', 'storage', 'caching', 'queues'],
  }),
  profile({
    id: 'fintech',
    label: 'Fintech',
    aliases: ['stripe', 'fintech', 'payments', 'banking', 'trading app'],
    values: ['Correctness', 'Risk awareness', 'Customer trust'],
    hiringAxes: [
      { id: 'coding', label: 'Coding & edge cases', weight: 0.4, categories: ['coding', 'concepts'] },
      { id: 'system', label: 'Reliable systems', weight: 0.25, categories: ['system-design'] },
      { id: 'behavioral', label: 'Judgment under risk', weight: 0.2, categories: ['behavioral'] },
      { id: 'resume', label: 'Domain experience', weight: 0.15, categories: ['resume-deep-dive'] },
    ],
    rounds: [
      { name: 'Coding', focus: 'Correctness-first implementation' },
      { name: 'System design', focus: 'Reliable money movement' },
      { name: 'Behavioral', focus: 'Handling ambiguity and risk' },
    ],
    techSignals: ['idempotency', 'ledgers', 'consistency', 'api design'],
  }),
  profile({
    id: 'quant',
    label: 'Quant / trading',
    aliases: ['quant', 'hedge fund', 'trading', 'jane street', 'citadel'],
    values: ['Probabilistic thinking', 'Precision under time pressure', 'Intellectual honesty'],
    hiringAxes: [
      { id: 'coding', label: 'Algorithms & probability', weight: 0.45, categories: ['coding', 'concepts'] },
      { id: 'math', label: 'Probability & games', weight: 0.3, categories: ['concepts'] },
      { id: 'behavioral', label: 'Thinking aloud', weight: 0.15, categories: ['behavioral'] },
      { id: 'resume', label: 'Quantitative work', weight: 0.1, categories: ['resume-deep-dive'] },
    ],
    rounds: [
      { name: 'Coding + probability', focus: 'Fast, exact reasoning with code' },
      { name: 'Games & estimation', focus: 'Expected value and structured guessing' },
    ],
    techSignals: ['probability', 'expected value', 'combinatorics', 'low-latency'],
  }),
  profile({
    id: 'startup',
    label: 'Startup (generalist)',
    aliases: ['startup', 'early stage', 'seed', 'series a'],
    values: ['Versatility', 'Speed', 'Product sense'],
    hiringAxes: [
      { id: 'build', label: 'Build & ship', weight: 0.35, categories: ['coding', 'resume-deep-dive'] },
      { id: 'product', label: 'Product thinking', weight: 0.25, categories: ['behavioral', 'system-design'] },
      { id: 'coding', label: 'Practical coding', weight: 0.25, categories: ['coding', 'concepts'] },
      { id: 'behavioral', label: 'Autonomy', weight: 0.15, categories: ['behavioral'] },
    ],
    rounds: [
      { name: 'Build interview', focus: 'Ship a small feature end to end' },
      { name: 'Founder chat', focus: 'Autonomy, motivation, and product sense' },
    ],
    techSignals: ['full-stack', 'shipping', 'product trade-offs'],
  }),
]

export const CUSTOM_COMPANY_ID = 'custom'

export function getCompany(id: string): CompanyProfile | undefined {
  return COMPANY_PROFILES.find((p) => p.id === id)
}

export function resolveCompany(input: { companyId: string; customCompany?: string }): CompanyProfile {
  const found = getCompany(input.companyId)
  if (found) return found
  const label = input.customCompany?.trim() || 'Custom company'
  return {
    id: CUSTOM_COMPANY_ID,
    label,
    aliases: [],
    values: ['Ownership', 'Clear communication'],
    hiringAxes: [
      { id: 'coding', label: 'Coding & algorithms', weight: 0.4, categories: ['coding', 'concepts'] },
      { id: 'behavioral', label: 'Behavioral', weight: 0.3, categories: ['behavioral'] },
      { id: 'resume', label: 'Past work depth', weight: 0.3, categories: ['resume-deep-dive'] },
    ],
    rounds: [
      { name: 'Screen', focus: 'Background and one technical exercise' },
      { name: 'Onsite', focus: 'Technical depth plus behavioral' },
    ],
    techSignals: [],
  }
}

export function matchCompanyId(freeText: string): string | null {
  const t = freeText.toLowerCase()
  for (const p of COMPANY_PROFILES) {
    if (t.includes(p.id)) return p.id
    for (const a of p.aliases) {
      if (a.length >= 3 && t.includes(a.toLowerCase())) return p.id
    }
  }
  return null
}
