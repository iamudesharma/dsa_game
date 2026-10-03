/**
 * LLM-assisted resume extraction, grounded in the pasted text.
 *
 * The deterministic parser in `@dsa/account/resume.ts` is the FLOOR: it never
 * invents a fact, but it only handles clean headings. Real resumes are messy
 * (sidebars, tables, contact blocks, skill rows), so a model gets first
 * refusal — and every field it produces is screened by `groundedResume`
 * before it can be served.
 *
 * THE RULE: the model may only reorganise text that is PRESENT in the source.
 * A fabricated employer, date, or skill is rejected field by field, and any
 * rejection falls that field back to the deterministic parse. A prompt
 * instruction ("do not invent") is a request; `groundedResume` is the
 * guarantee, same principle as `coach/guardrails.ts`.
 */

import {
  ResumeSchema,
  parseResumeText,
  type Education,
  type Experience,
  type Project,
  type Resume,
  type Skill,
} from '@dsa/account'
import { defaultChatTransport } from '@dsa/provider-chain'
import type { ChatTransport } from '@dsa/provider-chain'

export interface ResumeExtractionResult {
  resume: Resume
  /** Which path produced the result. */
  source: 'model' | 'deterministic'
  notes: string[]
  /** Fields dropped as ungrounded, for the UI to report honestly. */
  rejected: string[]
}

const MAX_SOURCE_CHARS = 12000

/**
 * Tokens the model is allowed to add that are not user content: field
 * scaffolding and the placeholders we use for a blank date range.
 */
const ALLOWED_ADDITIONS = new Set([
  'present',
  'current',
  'now',
  'role',
  'company',
  'project',
  'general',
  'and',
  'with',
  'for',
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'from',
  'by',
  'as',
  'etc',
  'using',
  'used',
])

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9+#.'/ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text: string): Set<string> {
  return new Set(
    normalise(text)
      .split(' ')
      .map((t) => t.replace(/^[.'/-]+|[.'/-]+$/g, ''))
      .filter((t) => t.length > 1),
  )
}

/**
 * How much of `value` must be findable in `source`.
 *
 * Company names and skills are held to a strict bar: every meaningful word
 * must appear in the source. Bullets and summaries are prose and are judged
 * more loosely (60%), because a model legitimately trims and re-cases
 * phrasing — but it still cannot pull a NEW noun out of thin air.
 */
function supported(value: string, sourceTokens: Set<string>, threshold: number): boolean {
  const valueTokens = [...tokens(value)]
  if (valueTokens.length === 0) return true
  const found = valueTokens.filter((t) => sourceTokens.has(t) || ALLOWED_ADDITIONS.has(t))
  return found.length / valueTokens.length >= threshold
}

interface GroundingReport {
  ok: boolean
  rejected: string[]
}

function groundString(
  value: string,
  sourceTokens: Set<string>,
  threshold: number,
  label: string,
  rejected: string[],
): string {
  if (value.trim() === '') return ''
  if (supported(value, sourceTokens, threshold)) return value
  rejected.push(label)
  return ''
}

function groundExperience(e: Experience, sourceTokens: Set<string>, rejected: string[]): Experience | null {
  const title = groundString(e.title, sourceTokens, 1, `experience.title:${e.title}`, rejected)
  const company = groundString(e.company, sourceTokens, 1, `experience.company:${e.company}`, rejected)
  const bullets = e.bullets
    .map((b) => groundString(b, sourceTokens, 0.6, `experience.bullet:${b.slice(0, 40)}`, rejected))
    .filter((b) => b !== '')

  // A role survives only if something GROUNDED is left. Testing the GROUNDED
  // bullets rather than the raw ones matters: a wholly fabricated role (title
  // and company invented, bullets ungrounded too) would otherwise survive as an
  // empty husk and reach the user as a blank row.
  if (title === '' && company === '' && bullets.length === 0) return null

  // Ungrounded fields are left EMPTY rather than replaced with placeholders:
  // "Company" is not a fact, and writing it here would make the screen
  // indistinguishable from a real one. `mergeResumes` fills these from the
  // deterministic parse, which is where a placeholder legitimately belongs.
  return {
    ...e,
    title,
    company,
    start: groundString(e.start, sourceTokens, 1, `experience.start:${e.start}`, rejected),
    end: groundString(e.end, sourceTokens, 1, `experience.end:${e.end}`, rejected),
    bullets,
  }
}

function groundEducation(e: Education, sourceTokens: Set<string>, rejected: string[]): Education | null {
  const school = groundString(e.school, sourceTokens, 0.75, `education.school:${e.school}`, rejected)
  const degree = groundString(e.degree, sourceTokens, 0.75, `education.degree:${e.degree}`, rejected)
  if (school === '' && degree === '') return null
  return { ...e, school, degree }
}

function groundProject(p: Project, sourceTokens: Set<string>, rejected: string[]): Project | null {
  const name = groundString(p.name, sourceTokens, 0.75, `project.name:${p.name}`, rejected)
  const description = groundString(p.description, sourceTokens, 0.6, `project.description:${p.name}`, rejected)
  if (name === '' && description === '') return null
  return {
    ...p,
    name,
    description,
    tech: p.tech.filter((t) => supported(t, sourceTokens, 1)).slice(0, 20),
  }
}

function groundSkill(s: Skill, sourceTokens: Set<string>, rejected: string[]): Skill | null {
  const name = groundString(s.name, sourceTokens, 1, `skill:${s.name}`, rejected)
  return name === '' ? null : { ...s, name }
}

/**
 * Screen a model-produced resume against the source text. Rejected fields are
 * dropped (not guessed at), and the result is re-parsed through the strict
 * schema so nothing invalid reaches storage.
 */
export function groundedResume(raw: unknown, sourceText: string): GroundingReport & { resume: Resume } {
  const parsed = ResumeSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, rejected: ['schema'], resume: ResumeSchema.parse({}) }
  }
  const sourceTokens = tokens(sourceText)
  const rejected: string[] = []
  const r = parsed.data

  const experience = r.experience
    .map((e) => groundExperience(e, sourceTokens, rejected))
    .filter((e): e is Experience => e !== null)
  const education = r.education
    .map((e) => groundEducation(e, sourceTokens, rejected))
    .filter((e): e is Education => e !== null)
  const projects = r.projects.map((p) => groundProject(p, sourceTokens, rejected)).filter((p): p is Project => p !== null)

  const seen = new Set<string>()
  const skills: Skill[] = []
  for (const s of r.skills) {
    const grounded = groundSkill(s, sourceTokens, rejected)
    if (!grounded) continue
    const key = grounded.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    skills.push(grounded)
  }

  // Summary: 60% is loose enough for a reworded profile line.
  const summary = groundString(r.summary, sourceTokens, 0.6, 'summary', rejected)

  const resume = ResumeSchema.parse({
    ...r,
    summary,
    // Contact fields come from the user's own header block; hold them to the
    // strict bar since a wrong email is worse than a missing one.
    contact: {
      name: groundString(r.contact.name, sourceTokens, 1, 'contact.name', rejected),
      email: groundString(r.contact.email, sourceTokens, 1, 'contact.email', rejected),
      location: groundString(r.contact.location, sourceTokens, 1, 'contact.location', rejected),
    },
    experience: experience.slice(0, 20),
    education: education.slice(0, 10),
    projects: projects.slice(0, 20),
    skills: skills.slice(0, 60),
  })

  // A model that produced nothing usable is treated as a failure, so the
  // caller falls back to the deterministic parse.
  const produced =
    resume.experience.length + resume.skills.length + resume.projects.length + resume.education.length > 0
  return { ok: produced, rejected, resume }
}

function buildPrompt(source: string): { system: string; user: string } {
  const system = [
    'You extract structured resume data from raw text. Return ONLY a JSON object.',
    'ABSOLUTE RULE: copy content from the source text. Never invent, infer, embellish,',
    'or add an employer, role, date, degree, project, or skill that is not written there.',
    'If a field is absent in the source, use an empty string or an empty array.',
    'Return exactly this shape:',
    '{ "summary": string, "contact": {"name": string, "email": string, "location": string},',
    '  "experience": [{"id": string, "title": string, "company": string, "start": string, "end": string, "bullets": [string]}],',
    '  "education": [{"id": string, "school": string, "degree": string, "field": string, "start": string, "end": string}],',
    '  "projects": [{"id": string, "name": string, "description": string, "tech": [string], "link": string}],',
    '  "skills": [{"id": string, "name": string}] }',
    'Every "id" must be unique, in the form exp:1, edu:1, proj:1, skill:1.',
    'Keep bullet text close to the source wording. Do not add commentary.',
  ].join('\n')
  const user = `SOURCE RESUME TEXT:\n"""\n${source}\n"""`
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

export async function extractResume(args: {
  text: string
  transport?: ChatTransport | null
  env?: NodeJS.ProcessEnv
}): Promise<ResumeExtractionResult> {
  const notes: string[] = []
  const source = args.text.trim().slice(0, MAX_SOURCE_CHARS)
  // The deterministic parse is always computed: it is the floor, and its
  // result is merged under anything the model did not ground.
  const floor = parseResumeText(source)
  const deterministic: ResumeExtractionResult = {
    resume: floor.resume,
    source: 'deterministic',
    notes: [],
    rejected: [],
  }

  if (args.transport === null || args.env?.RESUME_TRANSPORT === '0') {
    return { ...deterministic, notes: ['model extraction disabled; used deterministic parse'] }
  }

  try {
    const transport = args.transport ?? (await defaultChatTransport(args.env ?? process.env))
    if (!transport) {
      return { ...deterministic, notes: ['no model transport configured; used deterministic parse'] }
    }
    if (!(await transport.isAvailable())) {
      return { ...deterministic, notes: [`transport '${transport.id}' not configured; used deterministic parse`] }
    }
    const { system, user } = buildPrompt(source)
    const reply = await transport.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 4000,
      // Low: this is extraction, not composition. Creativity here is a way to
      // write something that is not in the resume.
      temperature: 0.1,
    })
    const raw = extractJson(reply.text)
    if (!raw) {
      return { ...deterministic, notes: [`transport '${transport.id}' returned non-JSON; used deterministic parse`] }
    }
    const grounded = groundedResume(raw, source)
    if (!grounded.ok) {
      return { ...deterministic, notes: ['model extraction produced nothing grounded; used deterministic parse'] }
    }
    // Merge: the model's grounded fields win, the deterministic parse fills
    // the gaps it left (typically contact lines and stray skill rows).
    const merged = mergeResumes(grounded.resume, floor.resume)
    notes.push(`extracted by ${transport.id}`)
    if (grounded.rejected.length > 0) {
      notes.push(`${grounded.rejected.length} ungrounded field(s) replaced from the deterministic parse`)
    }
    return { resume: merged, source: 'model', notes, rejected: grounded.rejected }
  } catch (err) {
    notes.push(`model extraction failed (${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}); used deterministic parse`)
    return { ...deterministic, notes }
  }
}

/**
 * Union the model result with the deterministic parse.
 *
 * Precedence is per-FIELD, not per-object: a model entry that grounded
 * contributes its grounded fields, and a deterministic entry fills only what
 * is still empty. Ids are the key, and the deterministic side is renumbered
 * onto the model's ids where both describe the same thing, so a `sourceRef`
 * in a generated kit never dangles.
 */
export function mergeResumes(model: Resume, fallback: Resume): Resume {
  const experience: Experience[] = []
  const modelExpByText = new Map<string, Experience>()
  for (const e of model.experience) modelExpByText.set(`${e.title.toLowerCase()}|${e.company.toLowerCase()}`, e)

  const used = new Set<string>()
  for (const f of fallback.experience) {
    const key = `${f.title.toLowerCase()}|${f.company.toLowerCase()}`
    const m = modelExpByText.get(key)
    if (m) {
      used.add(key)
      experience.push({
        id: m.id,
        // Grounding may have emptied a field the model got wrong; the
        // deterministic parse of the SAME text is the authority for it, and
        // the placeholders are the last resort when neither has a value.
        title: m.title || f.title || 'Role',
        company: m.company || f.company || 'Company',
        start: m.start || f.start,
        end: m.end || f.end || 'Present',
        bullets: m.bullets.length > 0 ? m.bullets : f.bullets,
      })
    } else {
      experience.push(f)
    }
  }
  for (const m of model.experience) {
    const key = `${m.title.toLowerCase()}|${m.company.toLowerCase()}`
    if (!used.has(key)) experience.push(m)
  }

  const skills: Skill[] = []
  const seenSkill = new Set<string>()
  for (const s of [...model.skills, ...fallback.skills]) {
    const key = s.name.toLowerCase()
    if (seenSkill.has(key)) continue
    seenSkill.add(key)
    skills.push(s)
  }

  const projectText = new Set(model.projects.map((p) => `${p.name.toLowerCase()}|${p.description.slice(0, 40).toLowerCase()}`))
  const projects = [
    ...model.projects,
    ...fallback.projects.filter((p) => !projectText.has(`${p.name.toLowerCase()}|${p.description.slice(0, 40).toLowerCase()}`)),
  ]

  return ResumeSchema.parse({
    version: 1,
    summary: model.summary || fallback.summary,
    contact: {
      name: model.contact.name || fallback.contact.name,
      email: model.contact.email || fallback.contact.email,
      location: model.contact.location || fallback.contact.location,
    },
    experience: experience.slice(0, 20),
    // Education is keyed on SCHOOL *AND* DEGREE, not school alone. The two
    // parsers can disagree about which half of a line is which ("BSc Computer
    // Science, TU Berlin"), and a school-only key then paired the model's
    // "BSc/TU Berlin" with the fallback's "TU Berlin/BSc" as two separate
    // degrees — one degree, two rows. Normalising on both halves makes the
    // key order-independent, so the two views of the same degree collapse.
    education: mergeByKey(model.education, fallback.education, (e) => eduKey(e), (m, f) => ({
      ...m,
      school: m.school || f.school || 'School',
      degree: m.degree || f.degree || 'Degree',
      field: m.field || f.field,
      start: m.start || f.start,
      end: m.end || f.end,
    })).slice(0, 10),
    projects: projects
      .map((p) => (p.name === '' ? { ...p, name: 'Project' } : p))
      .slice(0, 20),
    skills: skills.slice(0, 60),
    links: model.links.length > 0 ? model.links : fallback.links,
  })
}

/**
 * Order-independent identity for one education entry.
 *
 * Both parsers can read the same line as "degree, school" or "school,
 * degree", so the two halves are SORTED before hashing. That makes the key
 * stable across either reading, which is what stops one degree from merging
 * into two rows.
 */
function eduKey(e: Education): string {
  return [e.school, e.degree]
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s !== '')
    .sort()
    .join('|')
}

function mergeByKey<T extends { id: string }>(primary: T[], secondary: T[], keyOf: (item: T) => string, combine: (m: T, f: T) => T): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  const index = new Map<string, T>()
  for (const item of primary) {
    const key = keyOf(item)
    index.set(key, item)
    seen.add(key)
    out.push(item)
  }
  for (const item of secondary) {
    const key = keyOf(item)
    if (seen.has(key)) {
      const existing = index.get(key)!
      const merged = combine(existing, item)
      out[out.indexOf(existing)] = merged
    } else {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}
