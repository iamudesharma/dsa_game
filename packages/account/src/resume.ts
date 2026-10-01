/**
 * Resume ingest: deterministic text parser + digest builder.
 *
 * The parser is the floor: it never invents an employer, date, or skill. It
 * splits pasted text on heading aliases, pulls bullets and date ranges with
 * small regexes, and returns everything it could not place as `unparsed` lines
 * for the user to fix by hand.
 */

import { ResumeSchema, emptyResume, type Resume } from './schema.js'

export interface ParsedResume {
  resume: Resume
  /** Lines the parser could not place. Shown to the user, never dropped. */
  unparsed: string[]
}

const HEADINGS: Record<string, string[]> = {
  summary: ['summary', 'objective', 'profile', 'about'],
  experience: ['experience', 'work experience', 'employment', 'work history', 'professional experience'],
  education: ['education', 'academic', 'university', 'college', 'degree'],
  skills: ['skills', 'technical skills', 'technologies', 'tech stack', 'stack'],
  projects: ['projects', 'side projects', 'personal projects', 'selected projects'],
}

function normaliseHeading(line: string): string | null {
  const t = line.trim().toLowerCase().replace(/[:#*\-\s]+$/g, '').replace(/^[:#*\-\s]+/g, '')
  if (t.length === 0 || t.length > 40) return null
  for (const [key, aliases] of Object.entries(HEADINGS)) {
    if (aliases.some((a) => t === a || t.startsWith(a + ' '))) return key
  }
  return null
}

function splitSections(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = { summary: [], experience: [], education: [], skills: [], projects: [] }
  let current: string | null = null
  const unclaimed: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const heading = normaliseHeading(line.replace(/^[#*]+\s*/, ''))
    if (heading) {
      current = heading
      continue
    }
    if (current && sections[current]) sections[current]!.push(line)
    else unclaimed.push(line)
  }
  // No headings at all: treat the whole paste as unclaimed so the caller can
  // surface it rather than silently producing an empty resume.
  if (current === null) {
    return { summary: [], experience: [], education: [], skills: [], projects: [], _unclaimed: unclaimed } as Record<string, string[]>
  }
  return { ...sections, _unclaimed: unclaimed }
}

const DATE_RANGE = /(\b(?:19|20)\d{2}\b\s*(?:[-–—]|to)\s*(?:\b(?:19|20)\d{2}\b|present|now|current))|(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:19|20)\d{2}\b)/i

function splitDates(segment: string): { rest: string; start: string; end: string } {
  const m = segment.match(DATE_RANGE)
  if (!m || m.index === undefined) return { rest: segment.trim(), start: '', end: '' }
  const range = m[0]
  const parts = range.split(/\s*(?:[-–—]|to)\s*/i)
  const rest = (segment.slice(0, m.index) + ' ' + segment.slice(m.index + range.length)).replace(/[(),|·•]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[,;:\s]+$/, '')
  return { rest, start: (parts[0] ?? '').trim(), end: (parts[1] ?? 'Present').trim() }
}

function splitTitleCompany(rest: string): { title: string; company: string } {
  // Prefer an explicit separator; otherwise "Title at Company".
  for (const sep of [' — ', ' – ', ' - ', ' | ', ' @ ', ' at ']) {
    const i = rest.toLowerCase().indexOf(sep.trim().toLowerCase() === 'at' ? ' at ' : sep)
    if (i >= 0) {
      const a = rest.slice(0, i).trim().replace(/^[,\-–—|·•\s]+/, '')
      const b = rest.slice(i + sep.length).trim().replace(/^[,\-–—|·•\s]+/, '')
      if (a && b) return sep === ' at ' ? { title: a, company: b } : { title: a, company: b }
    }
  }
  const comma = rest.indexOf(',')
  if (comma >= 0) {
    const a = rest.slice(0, comma).trim()
    const b = rest.slice(comma + 1).trim()
    if (a && b && b.length <= 80) return { title: a, company: b }
  }
  return { title: rest.slice(0, 120), company: '' }
}

function isBullet(line: string): boolean {
  return /^[-•*▪‣·]\s+/.test(line) || /^\d+[.)]\s+/.test(line)
}

function cleanBullet(line: string): string {
  return line.replace(/^[-•*▪‣·]\s+/, '').replace(/^\d+[.)]\s+/, '').trim()
}

let idCounter = 0
function nid(prefix: string): string {
  idCounter += 1
  return `${prefix}:${Date.now().toString(36)}:${idCounter.toString(36)}`
}

export function parseResumeText(text: string): ParsedResume {
  const base = emptyResume()
  const unparsed: string[] = []
  const input = text.trim()
  if (!input) return { resume: base, unparsed }

  const sections = splitSections(input)
  const unclaimed = sections._unclaimed ?? []

  // Summary: free prose under the heading.
  if (sections.summary && sections.summary.length > 0) {
    base.summary = sections.summary.join(' ').slice(0, 2000)
  }

  // Skills: split on commas/semicolons/bullets/pipes.
  const skillLines = sections.skills ?? []
  const skillNames: string[] = []
  for (const line of skillLines) {
    const parts = line.split(/[,;|/·•▪]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length <= 1 && !isBullet(line)) {
      // Single token line: one skill, unless it looks like a sentence.
      if (line.length <= 40 && line.split(/\s+/).length <= 4) skillNames.push(line.replace(/^[-*]\s*/, ''))
      else unparsed.push(line)
    } else {
      for (const p of parts) {
        const c = cleanBullet(p)
        if (c && c.length <= 60 && c.split(/\s+/).length <= 5) skillNames.push(c)
        else if (c) unparsed.push(p)
      }
    }
  }
  const seen = new Set<string>()
  for (const name of skillNames) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (base.skills.length >= 60) {
      unparsed.push(name)
      continue
    }
    base.skills.push({ id: nid('skill'), name: name.slice(0, 200) })
  }

  // Experience: header lines start entries; bullets attach to the open entry.
  let open: { title: string; company: string; start: string; end: string; bullets: string[] } | null = null
  const flush = () => {
    if (!open) return
    if (!open.title && open.bullets.length === 0) {
      unparsed.push([open.company, open.start, open.end].filter(Boolean).join(' '))
    } else {
      base.experience.push({
        id: nid('exp'),
        title: open.title || 'Role',
        company: open.company || 'Company',
        start: open.start,
        end: open.end || 'Present',
        bullets: open.bullets.slice(0, 12),
      })
    }
    open = null
  }
  for (const line of sections.experience ?? []) {
    if (isBullet(line)) {
      const b = cleanBullet(line)
      if (open) {
        if (open.bullets.length < 12 && b.length <= 400) open.bullets.push(b)
        else unparsed.push(line)
      } else unparsed.push(line)
      continue
    }
    // A header line: flush the previous entry, start a new one.
    flush()
    const { rest, start, end } = splitDates(line)
    const { title, company } = splitTitleCompany(rest)
    if (!title && !company) {
      unparsed.push(line)
      continue
    }
    open = { title, company, start, end, bullets: [] }
  }
  flush()

  // Education: one line per entry, same date logic.
  for (const line of sections.education ?? []) {
    if (isBullet(line)) {
      unparsed.push(line)
      continue
    }
    if (base.education.length >= 10) {
      unparsed.push(line)
      continue
    }
    const { rest, start, end } = splitDates(line)
    const parts = rest.split(/[,|–—\-·]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) {
      unparsed.push(line)
      continue
    }
    base.education.push({
      id: nid('edu'),
      school: (parts[0] ?? rest).slice(0, 200),
      degree: (parts[1] ?? '').slice(0, 200),
      field: (parts[2] ?? '').slice(0, 120),
      start,
      end,
    })
  }

  // Projects: "Name: description" or "Name — description".
  for (const line of sections.projects ?? []) {
    if (base.projects.length >= 20) {
      unparsed.push(line)
      continue
    }
    if (isBullet(line)) {
      const b = cleanBullet(line)
      const sep = b.search(/[:–—\-–|]/)
      if (sep > 0 && sep < 80) {
        base.projects.push({
          id: nid('proj'),
          name: b.slice(0, sep).trim().slice(0, 200),
          description: b.slice(sep + 1).trim().slice(0, 2000) || b.slice(0, 2000),
          tech: [],
          link: '',
        })
      } else {
        base.projects.push({ id: nid('proj'), name: b.slice(0, 80), description: b.slice(0, 2000), tech: [], link: '' })
      }
      continue
    }
    const sep = line.search(/[:–—\-–|]/)
    if (sep > 0 && sep < 80) {
      base.projects.push({
        id: nid('proj'),
        name: line.slice(0, sep).trim().slice(0, 200),
        description: line.slice(sep + 1).trim().slice(0, 2000) || line.slice(0, 2000),
        tech: [],
        link: '',
      })
    } else if (line.length <= 200) {
      base.projects.push({ id: nid('proj'), name: line.slice(0, 200), description: line.slice(0, 2000), tech: [], link: '' })
    } else {
      unparsed.push(line)
    }
  }

  for (const line of unclaimed) unparsed.push(line)

  const parsed = ResumeSchema.safeParse(base)
  if (!parsed.success) return { resume: emptyResume(), unparsed: input.split('\n').map((l) => l.trim()).filter(Boolean) }
  return { resume: parsed.data, unparsed }
}

/** Reset the module id counter (tests). */
export function resetResumeIds(): void {
  idCounter = 0
}

// ------------------------------------------------------------ digest

/**
 * The grounded digest the generation prompt is built from. It contains only
 * facts present in the stored resume: names, titles, and skill strings. The
 * model prompt is assembled from this, so anything the model "knows" about
 * the candidate came from here.
 */
export function resumeToText(resume: Resume, maxChars = 4000): string {
  const lines: string[] = []
  if (resume.summary) lines.push(`Summary: ${resume.summary}`)
  for (const e of resume.experience) {
    lines.push(`Experience: ${e.title} at ${e.company} (${e.start} - ${e.end})`)
    for (const b of e.bullets.slice(0, 6)) lines.push(`- ${b}`)
  }
  for (const p of resume.projects) {
    lines.push(`Project: ${p.name}: ${p.description.slice(0, 300)}${p.tech.length ? ` [${p.tech.join(', ')}]` : ''}`)
  }
  for (const e of resume.education) {
    lines.push(`Education: ${e.degree} ${e.field} at ${e.school}`.trim())
  }
  if (resume.skills.length > 0) lines.push(`Skills: ${resume.skills.map((s) => s.name).join(', ')}`)
  const out = lines.join('\n')
  return out.length > maxChars ? out.slice(0, maxChars) : out
}

/** Every valid sourceRef for a resume, plus `general`. */
export function resumeSourceIds(resume: Resume): Set<string> {
  const ids = new Set<string>(['general'])
  for (const e of resume.experience) ids.add(e.id)
  for (const s of resume.skills) ids.add(s.id)
  for (const p of resume.projects) ids.add(p.id)
  for (const e of resume.education) ids.add(e.id)
  return ids
}
