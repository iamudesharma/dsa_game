/**
 * Accounts, resumes, targets, progress sync, and interview kits — tested
 * through the real HTTP surface with an in-memory database.
 *
 * The model transport is never touched: `INTERVIEW_TRANSPORT=0` forces the
 * deterministic template, which is the guarantee under test (the endpoint
 * always returns a grounded kit, with or without a key).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { createDecisionEngine } from '@dsa/decision-layer'
import { closeDb } from './db/index.js'
import { resetRateLimits } from './auth/rate-limit.js'
import { resetStore } from './store.js'
import { resetThreads } from './coach/threads.js'
import { resetCoachService } from './coach/service.js'

function app() {
  return createApp({ chain: [], decisions: createDecisionEngine({ enabled: false }), version: 'test' })
}

async function post(a: ReturnType<typeof app>, path: string, body: unknown, token?: string): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await a.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers }
}

async function put(a: ReturnType<typeof app>, path: string, body: unknown, token?: string): Promise<{ status: number; json: any }> {
  const res = await a.request(path, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function get(a: ReturnType<typeof app>, path: string, token?: string): Promise<{ status: number; json: any }> {
  const res = await a.request(path, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

beforeEach(() => {
  process.env.DSA_DB_PATH = ':memory:'
  process.env.INTERVIEW_TRANSPORT = '0'
  closeDb()
  resetRateLimits()
  resetStore()
  resetThreads()
  resetCoachService()
})

afterEach(() => {
  closeDb()
  delete process.env.DSA_DB_PATH
  delete process.env.INTERVIEW_TRANSPORT
  resetCoachService()
})

describe('auth', () => {
  it('signup → me → logout → login round-trips', async () => {
    const a = app()
    const s = await post(a, '/api/auth/signup', { email: 'Ada@Example.com', password: 'correct-horse-99' })
    expect(s.status).toBe(200)
    expect(s.json.user.email).toBe('ada@example.com')
    expect(typeof s.json.token).toBe('string')
    expect(s.headers.get('set-cookie')).toContain('dsa_session=')

    const me = await get(a, '/api/auth/me', s.json.token)
    expect(me.status).toBe(200)
    expect(me.json.user.email).toBe('ada@example.com')

    const out = await post(a, '/api/auth/logout', {}, s.json.token)
    expect(out.status).toBe(200)
    expect((await get(a, '/api/auth/me', s.json.token)).status).toBe(401)

    const back = await post(a, '/api/auth/login', { email: 'ada@example.com', password: 'correct-horse-99' })
    expect(back.status).toBe(200)
    expect((await get(a, '/api/auth/me', back.json.token)).status).toBe(200)
  })

  it('duplicate signup and wrong password are generic; no secret leaks', async () => {
    const a = app()
    await post(a, '/api/auth/signup', { email: 'bob@example.com', password: 'correct-horse-99' })
    const dup = await post(a, '/api/auth/signup', { email: 'BOB@example.com', password: 'another-pass-99' })
    expect(dup.status).toBe(409)
    expect(JSON.stringify(dup.json)).not.toContain('password')
    const wrong = await post(a, '/api/auth/login', { email: 'bob@example.com', password: 'wrong-password-1' })
    expect(wrong.status).toBe(401)
    expect(wrong.json.error.code).toBe('INVALID_CREDENTIALS')
    const missing = await post(a, '/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password-1' })
    expect(missing.status).toBe(401)
    expect(missing.json.error.message).toBe(wrong.json.error.message)
  })

  it('protected routes 401 without a session', async () => {
    const a = app()
    expect((await get(a, '/api/me/resume')).status).toBe(401)
    expect((await post(a, '/api/interview/generate', {})).status).toBe(401)
  })

  it('rate-limits repeated auth attempts', async () => {
    const a = app()
    let last = 0
    for (let i = 0; i < 35; i += 1) {
      const r = await post(a, '/api/auth/login', { email: 'rl@example.com', password: 'wrong-password-1' })
      last = r.status
      if (last === 429) break
    }
    expect(last).toBe(429)
  })
})

describe('resume + target + progress', () => {
  async function signedIn(email = 'dev@example.com'): Promise<{ a: ReturnType<typeof app>; token: string }> {
    const a = app()
    const s = await post(a, '/api/auth/signup', { email, password: 'correct-horse-99' })
    return { a, token: s.json.token as string }
  }

  it('resume CRUD round-trips', async () => {
    const { a, token } = await signedIn()
    const resume = {
      version: 1,
      summary: 'Backend engineer',
      contact: { name: 'Dev', email: 'dev@example.com', location: '' },
      experience: [{ id: 'exp:1', title: 'Engineer', company: 'Acme', start: '2021', end: 'Present', bullets: ['Shipped queues'] }],
      education: [],
      projects: [],
      skills: [{ id: 'skill:1', name: 'Python' }],
      links: [],
    }
    expect((await put(a, '/api/me/resume', resume, token)).status).toBe(200)
    const got = await get(a, '/api/me/resume', token)
    expect(got.json.resume.summary).toBe('Backend engineer')
    expect(got.json.resume.skills[0].name).toBe('Python')
  })

  it('paste → parse never invents facts and can save', async () => {
    const { a, token } = await signedIn('parse@example.com')
    const text = 'Experience\nSenior Engineer — Acme Corp, 2020 - Present\n- Shipped payments API\n\nSkills\nPython, SQL'
    const r = await post(a, '/api/me/parse-resume', { text, save: true }, token)
    expect(r.status).toBe(200)
    expect(r.json.resume.experience[0].company).toContain('Acme')
    expect(r.json.saved).toBe(true)
    // The route reports which extraction path won, so the UI can be honest
    // about whether a model or the deterministic parser produced the draft.
    expect(['model', 'deterministic']).toContain(r.json.source)
    expect(Array.isArray(r.json.rejected)).toBe(true)
    expect((await get(a, '/api/me/resume', token)).json.resume.experience).toHaveLength(1)
  })

  it('parses a real-world resume: contact, role, dates, education, skills', async () => {
    const { a, token } = await signedIn('messy@example.com')
    const text = [
      'Jane Doe',
      'jane@example.com · Berlin',
      'Summary',
      'Backend engineer focused on payments infrastructure.',
      'Experience',
      'Senior Engineer, Northwind Labs 2019 - Present',
      '- Led the migration of the ledger service to Postgres',
      'Education',
      'BSc Computer Science, TU Berlin, 2015 - 2019',
      'Skills',
      'Go, Postgres, Kubernetes, gRPC',
    ].join('\n')
    const r = await post(a, '/api/me/parse-resume', { text, save: true }, token)
    expect(r.status).toBe(200)
    const resume = r.json.resume
    expect(resume.experience).toHaveLength(1)
    expect(resume.experience[0].company).toBe('Northwind Labs')
    expect(resume.experience[0].title).toBe('Senior Engineer')
    expect(resume.experience[0].start).toBe('2019')
    expect(resume.experience[0].end).toBe('Present')
    expect(resume.experience[0].bullets).toHaveLength(1)
    expect(resume.skills.map((s: { name: string }) => s.name)).toEqual(
      expect.arrayContaining(['Go', 'Postgres', 'Kubernetes', 'gRPC']),
    )
    expect(resume.education).toHaveLength(1)
  })

  it('handles colon headings (SKILLS: …) without losing the line', async () => {
    const { a, token } = await signedIn('colon@example.com')
    const r = await post(a, '/api/me/parse-resume', { text: 'Summary: Backend engineer\nSKILLS: Go, Rust' }, token)
    expect(r.json.resume.summary).toContain('Backend engineer')
    expect(r.json.resume.skills.map((s: { name: string }) => s.name)).toEqual(['Go', 'Rust'])
  })

  it('target CRUD round-trips and companies list', async () => {
    const { a, token } = await signedIn('target@example.com')
    const target = { goal: 'Backend role at an AI lab', companyId: 'ai-lab', customCompany: '', seniority: 'mid', focusAreas: ['ml'] }
    expect((await put(a, '/api/me/target', target, token)).status).toBe(200)
    expect((await get(a, '/api/me/target', token)).json.target.companyId).toBe('ai-lab')
    const companies = await get(a, '/api/companies', token)
    expect(companies.json.companies.length).toBeGreaterThanOrEqual(6)
  })

  it('progress merges device-local completions', async () => {
    const { a, token } = await signedIn('prog@example.com')
    const first = await post(a, '/api/me/progress', { completed: { 'binary-search': '2026-01-01T00:00:00.000Z' } }, token)
    expect(first.json.completed['binary-search']).toBeDefined()
    const second = await post(a, '/api/me/progress', { completed: { 'two-sum': '2026-01-02T00:00:00.000Z' } }, token)
    expect(second.json.completed['binary-search']).toBeDefined()
    expect(second.json.completed['two-sum']).toBeDefined()
  })
})

describe('interview kits', () => {
  async function withProfile(): Promise<{ a: ReturnType<typeof app>; token: string }> {
    const a = app()
    const s = await post(a, '/api/auth/signup', { email: 'kit@example.com', password: 'correct-horse-99' })
    const token = s.json.token as string
    await put(
      a,
      '/api/me/resume',
      {
        version: 1,
        summary: 'Backend engineer',
        contact: { name: 'Kit', email: 'kit@example.com', location: '' },
        experience: [{ id: 'exp:1', title: 'Engineer', company: 'Acme', start: '2021', end: 'Present', bullets: ['Built queues'] }],
        education: [],
        projects: [],
        skills: [{ id: 'skill:1', name: 'Python' }],
        links: [],
      },
      token,
    )
    await put(
      a,
      '/api/me/target',
      { goal: 'Backend role', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
      token,
    )
    return { a, token }
  }

  it('generates a grounded kit without a model key', async () => {
    const { a, token } = await withProfile()
    const r = await post(a, '/api/interview/generate', {}, token)
    expect(r.status).toBe(200)
    expect(r.json.questions.length).toBeGreaterThanOrEqual(4)
    expect(r.json.usedTier).toBe('template')
    for (const q of r.json.questions) {
      expect(typeof q.prompt).toBe('string')
      expect(typeof q.listeningFor).toBe('string')
    }
  })

  it('requires a target first', async () => {
    const a = app()
    const s = await post(a, '/api/auth/signup', { email: 'notarget@example.com', password: 'correct-horse-99' })
    const r = await post(a, '/api/interview/generate', {}, s.json.token)
    expect(r.status).toBe(400)
  })

  it('lists and re-reads kits', async () => {
    const { a, token } = await withProfile()
    const gen = await post(a, '/api/interview/generate', {}, token)
    const list = await get(a, '/api/interview/kits', token)
    expect(list.json.kits).toHaveLength(1)
    const one = await get(a, `/api/interview/kits/${gen.json.kitId}`, token)
    expect(one.json.questions.length).toBe(gen.json.questions.length)
  })

  it('newAngle yields different questions', async () => {
    const { a, token } = await withProfile()
    const first = await post(a, '/api/interview/generate', { seed: 5 }, token)
    const second = await post(a, '/api/interview/generate', { seed: 5, newAngle: true }, token)
    expect(first.json.questions.map((q: any) => q.prompt).join('|')).not.toBe(
      second.json.questions.map((q: any) => q.prompt).join('|'),
    )
  })
})
