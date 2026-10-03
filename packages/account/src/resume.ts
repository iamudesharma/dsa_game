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
  // A heading can carry content on the SAME line ("Summary: Backend
  // engineer…", "SKILLS: Go, Postgres"). Splitting here is what stops that
  // content from being thrown away as an unrecognised heading.
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const cleaned = line.replace(/^[#*\s]+/, '')
    const colon = cleaned.indexOf(':')
    if (colon > 0) {
      const maybeHeading = normaliseHeading(cleaned.slice(0, colon))
      const tail = cleaned.slice(colon + 1).trim()
      if (maybeHeading !== null) {
        current = maybeHeading
        if (tail !== '') sections[current]!.push(tail)
        continue
      }
    }
    const heading = normaliseHeading(cleaned)
    if (heading !== null) {
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
  // Only the PUNCTUATION IMMEDIATELY SURROUNDING the removed date range is
  // cleaned. Stripping every comma in the segment deleted the title/company
  // separator too ("Senior Engineer, Northwind Labs 2019 - Present" lost its
  // comma), so the split that follows could never see it.
  const before = segment.slice(0, m.index).replace(/[\s,;|·•\-–—]+$/, '')
  const after = segment.slice(m.index + range.length).replace(/^[\s,;|·•\-–—]+/, '')
  const rest = `${before} ${after}`.replace(/\s+/g, ' ').trim().replace(/[,;:\s]+$/, '')
  return { rest, start: (parts[0] ?? '').trim(), end: (parts[1] ?? 'Present').trim() }
}

function splitTitleCompany(rest: string): { title: string; company: string } {
  // Prefer an explicit separator; otherwise "Title at Company".
  for (const sep of [' — ', ' – ', ' - ', ' | ', ' @ ', ' at ']) {
    const i = rest.indexOf(sep)
    if (i >= 0) {
      const a = rest.slice(0, i).trim().replace(/^[,\-–—|·•\s]+/, '')
      const b = rest.slice(i + sep.length).trim().replace(/^[,\-–—|·•\s]+/, '')
      if (a && b) return { title: a, company: b }
    }
  }
  // A comma split is only trustworthy when the SECOND half looks like an
  // employer. "Senior Engineer, Northwind Labs" is one; "Engineer, Payments
  // team" is not, and blindly splitting it invented an employer called
  // "Payments team" while losing the team from the title.
  const comma = rest.indexOf(',')
  if (comma >= 0) {
    const a = rest.slice(0, comma).trim()
    const b = rest.slice(comma + 1).trim()
    if (a && b && b.length <= 80) {
      if (looksLikeCompany(b)) return { title: a, company: b }
      // Neither half looks like an employer. If the FIRST half is a job title,
      // the whole line is the title (it may carry a team after the comma).
      if (TITLE_HINT.test(a)) return { title: rest.slice(0, 200), company: '' }
      // Otherwise this reads "Acme Corp, Payments team" — employer first.
      if (looksLikeCompany(a)) return { title: b, company: a }
      return { title: rest.slice(0, 200), company: '' }
    }
  }
  return { title: rest.slice(0, 200), company: '' }
}

/**
 * Tokens that mark a fragment as an organisation.
 *
 * Legal suffixes and the "Labs/Inc/Ltd" shapes carry most real resumes, but a
 * bare brand name ("Northwind", "Acme") has no marker at all — so this only
 * ever *adds* confidence, never removes it. When nothing matches, the comma
 * split is refused (see above) rather than guessed.
 */
const COMPANY_WORD_HINT =
  /\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|group|holdings|labs?|technologies|tech|solutions|software|systems|bank|health|studio|studios|agency|partners|ventures|capital|consulting|media|digital|networks|platforms|io|ai)\b/i
/** An all-caps or CamelCase token: an initialism ("IBM", "OpenAI") or acronym. */
const COMPANY_SHAPE_HINT = /(?:\b[A-Z]{2,}\b)|(?:[A-Z][a-z]+[A-Z][a-zA-Z]*)/

function looksLikeCompany(fragment: string): boolean {
  return COMPANY_WORD_HINT.test(fragment) || COMPANY_SHAPE_HINT.test(fragment)
}

/** Job-title words, used to keep a title that is mostly a noun phrase. */
const TITLE_HINT = /\b(engineer|developer|manager|director|designer|scientist|analyst|architect|consultant|lead|head|intern|researcher|programmer|administrator|specialist|officer|founder|coordinator|associate|principal|staff)\b/i

/**
 * Degree abbreviations, used to tell "BSc Computer Science" from "TU Berlin"
 * when deciding which half of a line is which.
 *
 * The bare `BS`/`BA` forms are deliberately NOT here: they collide with
 * ordinary words ("BS in Computer Science" is fine, but a school line can
 * contain them too). Matching the multi-letter forms is the safer test, and an
 * unmatched line simply keeps positional order.
 */
const DEGREE_HINT = /\b(bsc|msc|ma\b|ms\b|mba|phd|ph\.d|btech|mtech|b\.tech|m\.tech|be\b|me\b|beng|bs\b|ba\b|bsn|msn|associate|bachelor|master|doctor|diploma|certificat)\b/i

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
    // Only a line with no title, no company, AND no bullets is unusable; a
    // header with bullets but no parseable title is still real work.
    if (!open.title && !open.company && open.bullets.length === 0) {
      unparsed.push([open.title, open.company, open.start, open.end].filter(Boolean).join(' '))
    } else {
      // A blank title/company is LEFT BLANK. Writing "Company" here is the
      // same fabrication the grounding validator refuses to serve, and it is
      // indistinguishable on screen from a real employer — the whole point of
      // the empty string is that the user sees what is actually missing and
      // fills it in. The UI labels the field either way.
      base.experience.push({
        id: nid('exp'),
        title: open.title,
        company: open.company,
        start: open.start,
        end: open.end,
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
    // Real lines read both ways: "BSc Computer Science, TU Berlin" (degree
    // first, common in the UK/Europe) and "TU Berlin — BSc Computer Science"
    // (school first). Classifying by DEGREE MARKER is the reliable test, not
    // by position: guessing on position put "BSc Computer Science" in the
    // school field, which then disagreed with the model and produced two
    // education rows for one degree.
    const first = parts[0] ?? rest
    const second = parts[1] ?? ''
    const degreeFirst = DEGREE_HINT.test(first) && !DEGREE_HINT.test(second)
    const school = degreeFirst ? second : first
    const degree = degreeFirst ? first : second
    base.education.push({
      id: nid('edu'),
      school: school.slice(0, 200),
      degree: degree.slice(0, 200),
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
  if (!parsed.success) {
    return { resume: emptyResume(), unparsed: input.split('\n').map((l) => l.trim()).filter(Boolean) }
  }
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
