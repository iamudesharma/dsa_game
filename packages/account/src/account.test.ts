import { describe, expect, it } from 'vitest'
import {
  emptyResume,
  parseResumeText,
  resetResumeIds,
  resumeSourceIds,
  resumeToText,
  templateInterviewKit,
  validateInterviewKit,
  practiceForSkill,
  getCompany,
  resolveCompany,
  findFabrication,
  ResumeSchema,
} from '@dsa/account'

describe('resume parser', () => {
  it('parses a headed resume into structured entries', () => {
    resetResumeIds()
    const text = [
      'Summary',
      'Backend engineer with 5 years of experience.',
      '',
      'Experience',
      'Senior Engineer — Acme Corp, 2020 - Present',
      '- Shipped payments API',
      '- Cut latency by half',
      '',
      'Skills',
      'Python, TypeScript, SQL',
      '',
      'Projects',
      'Cache layer: an LRU cache for API responses',
    ].join('\n')
    const { resume, unparsed } = parseResumeText(text)
    expect(resume.experience).toHaveLength(1)
    expect(resume.experience[0]!.title).toContain('Senior Engineer')
    expect(resume.experience[0]!.company).toContain('Acme')
    expect(resume.experience[0]!.bullets).toHaveLength(2)
    expect(resume.skills.map((s) => s.name)).toEqual(['Python', 'TypeScript', 'SQL'])
    expect(resume.projects).toHaveLength(1)
    expect(unparsed).toEqual([])
  })

  it('never invents employers; unheaded text lands in unparsed', () => {
    const { resume, unparsed } = parseResumeText('just some random line\nanother line')
    expect(resume.experience).toEqual([])
    expect(resume.skills).toEqual([])
    expect(unparsed.length).toBeGreaterThan(0)
  })

  it('round-trips through the schema', () => {
    const r = emptyResume()
    expect(() => ResumeSchema.parse(r)).not.toThrow()
  })
})

describe('resume digest', () => {
  it('contains only stored facts', () => {
    resetResumeIds()
    const { resume } = parseResumeText('Experience\nEngineer — Acme, 2021 - Present\n- Did things\n\nSkills\nGo')
    const digest = resumeToText(resume)
    expect(digest).toContain('Acme')
    expect(digest).toContain('Go')
    expect(resumeSourceIds(resume).has(resume.experience[0]!.id)).toBe(true)
  })
})

describe('template kit', () => {
  it('always returns 4..12 grounded questions', () => {
    resetResumeIds()
    const { resume } = parseResumeText(
      'Experience\nEngineer — Acme, 2021 - Present\n- Built queues\n\nSkills\nPython, Algorithms\n\nProjects\nCache: fast cache',
    )
    const kit = templateInterviewKit({
      resume,
      target: { goal: 'Backend role', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
      seed: 42,
    })
    expect(kit.questions.length).toBeGreaterThanOrEqual(4)
    expect(kit.questions.length).toBeLessThanOrEqual(12)
    const ids = resumeSourceIds(resume)
    for (const q of kit.questions) {
      expect(ids.has(q.sourceRef)).toBe(true)
    }
  })

  it('works for an empty resume', () => {
    const kit = templateInterviewKit({
      resume: emptyResume(),
      target: { goal: 'Get a job', companyId: 'custom', customCompany: 'Acme', seniority: 'junior', focusAreas: [] },
    })
    expect(kit.questions.length).toBeGreaterThanOrEqual(4)
  })

  it('newAngle rotates coding questions', () => {
    resetResumeIds()
    const { resume } = parseResumeText('Skills\nPython\nExperience\nEngineer — Acme, 2021 - Present')
    const a = templateInterviewKit({
      resume,
      target: { goal: 'g', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
      seed: 1,
    })
    const b = templateInterviewKit({
      resume,
      target: { goal: 'g', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
      seed: 1,
      newAngle: true,
    })
    expect(a.questions.map((q) => q.prompt).join('|')).not.toBe(b.questions.map((q) => q.prompt).join('|'))
  })
})

describe('grounding validator', () => {
  it('rejects unknown sourceRef and unknown problemId', () => {
    resetResumeIds()
    const { resume } = parseResumeText('Skills\nPython')
    const kit = templateInterviewKit({
      resume,
      target: { goal: 'g', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
    })
    const bad = { ...kit, questions: [{ ...kit.questions[0]!, sourceRef: 'exp:nope' }] }
    const res = validateInterviewKit(bad, resume)
    expect(res.ok).toBe(false)
    const bad2 = { ...kit, questions: [{ ...kit.questions[0]!, practice: { problemId: 'not-a-problem' } }] }
    expect(validateInterviewKit(bad2, resume).ok).toBe(false)
  })

  it('rejects fabricated process claims', () => {
    resetResumeIds()
    const { resume } = parseResumeText('Skills\nPython')
    const kit = templateInterviewKit({
      resume,
      target: { goal: 'g', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
    })
    const bad = {
      ...kit,
      questions: [{ ...kit.questions[0]!, whyItFits: 'They always ask this, 90% of candidates see it.' }],
    }
    expect(validateInterviewKit(bad, resume).ok).toBe(false)
    expect(findFabrication('They always ask this')).toBe('always-asks')
    expect(findFabrication('Plain text about arrays.')).toBe(null)
  })

  it('accepts the template kit', () => {
    resetResumeIds()
    const { resume } = parseResumeText('Skills\nPython\nExperience\nEngineer — Acme, 2021 - Present')
    const kit = templateInterviewKit({
      resume,
      target: { goal: 'g', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
    })
    expect(validateInterviewKit(kit, resume).ok).toBe(true)
  })
})

describe('companies + practice', () => {
  it('resolves known and custom companies', () => {
    expect(getCompany('faang-general')?.label).toContain('Big Tech')
    expect(resolveCompany({ companyId: 'nope', customCompany: 'Acme' }).label).toBe('Acme')
    expect(resolveCompany({ companyId: 'ai-lab' }).hiringAxes.length).toBeGreaterThan(0)
  })

  it('maps skills to catalogue problems', () => {
    expect(practiceForSkill('Python')?.problemId).toBe('two-sum')
    expect(practiceForSkill('  ADVANCED python  ')?.problemId).toBe('two-sum')
    expect(practiceForSkill('underwater basket weaving')).toBe(null)
  })
})
