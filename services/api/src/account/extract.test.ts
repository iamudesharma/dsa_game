/**
 * LLM resume extraction: grounding is the guarantee, the prompt is a request.
 *
 * The interesting failures here are all "the model wrote something that is not
 * in the resume" — a hallucinated employer, an inflated date range, a skill
 * that reads well and was never claimed. So the tests drive a stub transport
 * that fabricates, and assert each fabrication is dropped rather than served.
 */

import { describe, expect, it } from 'vitest'
import type { ChatReply, ChatRequest, ChatTransport } from '@dsa/provider-chain'
import { extractResume, groundedResume, mergeResumes } from './extract.js'
import { emptyResume, parseResumeText } from '@dsa/account'

const SOURCE = [
  'Jane Doe',
  'jane@example.com · Berlin',
  '',
  'Summary',
  'Backend engineer focused on payments infrastructure.',
  '',
  'Experience',
  'Senior Engineer, Northwind Labs 2019 - Present',
  '- Led the migration of the ledger service to Postgres',
  '- Cut p99 latency from 800ms to 120ms',
  '',
  'Education',
  'BSc Computer Science, TU Berlin, 2015 - 2019',
  '',
  'Skills',
  'Go, Postgres, Kubernetes, gRPC',
].join('\n')

class StubTransport implements ChatTransport {
  readonly id = 'stub'
  readonly model = 'stub-model'
  constructor(private readonly reply: string) {}

  async isAvailable(): Promise<boolean> {
    return true
  }

  async chat(_request: ChatRequest): Promise<ChatReply> {
    return { text: this.reply, model: this.model, approxTokens: this.reply.length / 4 }
  }
}

describe('groundedResume', () => {
  it('keeps fields that are present in the source', () => {
    const result = groundedResume(
      {
        summary: 'Backend engineer focused on payments infrastructure.',
        contact: { name: 'Jane Doe', email: 'jane@example.com', location: 'Berlin' },
        experience: [
          {
            id: 'exp:1',
            title: 'Senior Engineer',
            company: 'Northwind Labs',
            start: '2019',
            end: 'Present',
            bullets: ['Led the migration of the ledger service to Postgres'],
          },
        ],
        education: [{ id: 'edu:1', school: 'TU Berlin', degree: 'BSc Computer Science', field: '', start: '2015', end: '2019' }],
        projects: [],
        skills: [{ id: 'skill:1', name: 'Go' }],
        links: [],
      },
      SOURCE,
    )
    expect(result.ok).toBe(true)
    expect(result.rejected).toEqual([])
    expect(result.resume.experience[0]!.company).toBe('Northwind Labs')
    expect(result.resume.skills[0]!.name).toBe('Go')
  })

  it('drops invented employers, dates, and skills', () => {
    const result = groundedResume(
      {
        experience: [
          {
            // A role the source does not contain at all: no title, no company,
            // no dates. It must be removed entirely, not kept as a stub.
            id: 'exp:1',
            title: 'Principal Engineer',
            company: 'Google',
            start: '2010',
            end: 'Present',
            bullets: ['Owned the global payments platform'],
          },
        ],
        skills: [{ id: 'skill:1', name: 'Rust' }, { id: 'skill:2', name: 'Kubernetes' }],
        education: [],
        projects: [],
        summary: '',
        contact: { name: '', email: '', location: '' },
        links: [],
      },
      SOURCE,
    )
    // The invented role is gone rather than half-populated with placeholders.
    expect(result.resume.experience).toEqual([])
    // The fabricated skill is dropped; the real one from the source survives.
    expect(result.resume.skills.map((s) => s.name)).toEqual(['Kubernetes'])
    expect(result.rejected.some((r) => r.includes('Google'))).toBe(true)
    expect(result.rejected.some((r) => r.startsWith('skill:Rust'))).toBe(true)
  })

  it('keeps a real role and strips only the invented fields from it', () => {
    const result = groundedResume(
      {
        experience: [
          {
            id: 'exp:1',
            title: 'Senior Engineer',
            // Invented: the source says Northwind Labs, never Acme.
            company: 'Acme',
            start: '2019',
            // Invented: the source has no end date.
            end: '2030',
            bullets: ['Cut p99 latency from 800ms to 120ms'],
          },
        ],
        education: [],
        projects: [],
        summary: '',
        contact: { name: '', email: '', location: '' },
        skills: [],
        links: [],
      },
      SOURCE,
    )
    const role = result.resume.experience[0]!
    expect(role.title).toBe('Senior Engineer')
    expect(role.start).toBe('2019')
    // Fabricated fields are emptied, not guessed at.
    expect(role.company).toBe('')
    expect(role.end).toBe('')
    expect(role.bullets).toEqual(['Cut p99 latency from 800ms to 120ms'])
  })

  it('treats a model that extracted nothing usable as a failure', () => {
    const result = groundedResume(
      {
        experience: [{ id: 'exp:1', title: 'Astronaut', company: 'NASA', start: '', end: '', bullets: [] }],
        education: [],
        projects: [],
        skills: [],
        summary: '',
        contact: { name: '', email: '', location: '' },
        links: [],
      },
      SOURCE,
    )
    expect(result.ok).toBe(false)
  })
})

describe('extractResume', () => {
  it('uses the model when it returns grounded data', async () => {
    const result = await extractResume({
      text: SOURCE,
      transport: new StubTransport(
        JSON.stringify({
          summary: 'Backend engineer focused on payments infrastructure.',
          contact: { name: 'Jane Doe', email: 'jane@example.com', location: 'Berlin' },
          experience: [
            {
              id: 'exp:1',
              title: 'Senior Engineer',
              company: 'Northwind Labs',
              start: '2019',
              end: 'Present',
              bullets: ['Led the migration of the ledger service to Postgres'],
            },
          ],
          education: [],
          projects: [],
          skills: [{ id: 'skill:1', name: 'Go' }, { id: 'skill:2', name: 'Postgres' }],
          links: [],
        }),
      ),
    })
    expect(result.source).toBe('model')
    expect(result.resume.experience[0]!.company).toBe('Northwind Labs')
    expect(result.resume.skills.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to the deterministic parse when the model fabricates', async () => {
    const result = await extractResume({
      text: SOURCE,
      transport: new StubTransport(
        JSON.stringify({
          summary: '',
          contact: { name: '', email: '', location: '' },
          experience: [
            { id: 'exp:1', title: 'Astronaut', company: 'NASA', start: '', end: '', bullets: ['Lunar rovers'] },
          ],
          education: [],
          projects: [],
          skills: [{ id: 'skill:1', name: 'Rocketry' }],
          links: [],
        }),
      ),
    })
    expect(result.source).toBe('deterministic')
    // The deterministic parse of the same text still finds real content.
    expect(result.resume.skills.map((s) => s.name)).toContain('Go')
    expect(result.resume.experience[0]!.company).toContain('Northwind')
  })

  it('falls back on non-JSON without throwing', async () => {
    const result = await extractResume({ text: SOURCE, transport: new StubTransport('I could not read that.') })
    expect(result.source).toBe('deterministic')
    expect(result.resume.skills.length).toBeGreaterThan(0)
  })

  it('falls back on a transport failure without throwing', async () => {
    const boom: ChatTransport = {
      id: 'boom',
      model: 'boom',
      isAvailable: async () => true,
      chat: async () => {
        throw new Error('503 overloaded')
      },
    }
    const result = await extractResume({ text: SOURCE, transport: boom })
    expect(result.source).toBe('deterministic')
    expect(result.notes[0]).toContain('503')
  })

  it('honours RESUME_TRANSPORT=0 as a supported mode', async () => {
    const result = await extractResume({ text: SOURCE, env: { RESUME_TRANSPORT: '0' } as NodeJS.ProcessEnv })
    expect(result.source).toBe('deterministic')
    expect(result.notes[0]).toContain('disabled')
  })
})

describe('mergeResumes', () => {
  it('keeps the model ids so a sourceRef never dangles', () => {
    const model = {
      ...emptyResume(),
      experience: [{ id: 'exp:model', title: 'Senior Engineer', company: 'Northwind Labs', start: '2019', end: 'Present', bullets: [] }],
    }
    const fallback = {
      ...emptyResume(),
      experience: [{ id: 'exp:det', title: 'Senior Engineer', company: 'Northwind Labs', start: '2019', end: 'Present', bullets: ['Cut p99 latency'] }],
    }
    const merged = mergeResumes(model, fallback)
    expect(merged.experience).toHaveLength(1)
    expect(merged.experience[0]!.id).toBe('exp:model')
    // The deterministic bullet survives because the model had none.
    expect(merged.experience[0]!.bullets).toEqual(['Cut p99 latency'])
  })

  it('collapses one education entry the two parsers read in opposite order', () => {
    // The model read "BSc Computer Science, TU Berlin" as degree-first; the
    // deterministic parser read it the other way. Keying on school alone made
    // those two rows, so the user saw one degree listed twice.
    const merged = mergeResumes(
      { ...emptyResume(), education: [{ id: 'edu:1', school: 'TU Berlin', degree: 'BSc Computer Science', field: '', start: '', end: '' }] },
      { ...emptyResume(), education: [{ id: 'edu:2', school: 'BSc Computer Science', degree: 'TU Berlin', field: '', start: '', end: '' }] },
    )
    expect(merged.education).toHaveLength(1)
    expect(merged.education[0]!.id).toBe('edu:1')
  })

  it('keeps two genuinely different degrees apart', () => {
    const merged = mergeResumes(
      { ...emptyResume(), education: [{ id: 'edu:1', school: 'TU Berlin', degree: 'BSc CS', field: '', start: '', end: '' }] },
      { ...emptyResume(), education: [{ id: 'edu:2', school: 'Oxford', degree: 'MSc CS', field: '', start: '', end: '' }] },
    )
    expect(merged.education).toHaveLength(2)
  })

  it('unions skills without duplicates', () => {
    const merged = mergeResumes(
      { ...emptyResume(), skills: [{ id: 'skill:1', name: 'Go' }] },
      { ...emptyResume(), skills: [{ id: 'skill:9', name: 'go' }, { id: 'skill:2', name: 'Postgres' }] },
    )
    expect(merged.skills.map((s) => s.name)).toEqual(['Go', 'Postgres'])
  })
})

describe('the deterministic floor is unchanged', () => {
  it('still parses the same source without a model', () => {
    const { resume } = parseResumeText(SOURCE)
    expect(resume.experience).toHaveLength(1)
    expect(resume.skills.map((s) => s.name)).toContain('Kubernetes')
  })
})
