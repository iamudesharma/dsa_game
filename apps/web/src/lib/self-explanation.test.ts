import { describe, expect, it } from 'vitest'
import { PROBLEM_IDS } from '@dsa/game-schema'
import {
  echoBridge,
  emptyReflections,
  readReflections,
  reflectionsAnswered,
  saveReflections,
  selfExplanationCoverage,
  selfExplanationPrompts,
} from './self-explanation'

function storage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
  }
}

describe('self-explanation prompts', () => {
  it('covers every catalogue problem with a retention and an integration prompt', () => {
    const { covered, missing } = selfExplanationCoverage()
    expect(missing).toEqual([])
    expect(covered).toEqual([...PROBLEM_IDS])
    for (const id of PROBLEM_IDS) {
      const prompts = selfExplanationPrompts(id)
      expect(prompts.retention.trim().length).toBeGreaterThan(0)
      expect(prompts.integration.trim().length).toBeGreaterThan(0)
      // Retention asks for a reason, integration asks for an invariant.
      expect(prompts.retention).toMatch(/why/i)
      expect(prompts.integration).toMatch(/stayed true/i)
    }
  })

  it('falls back to a generic pair for an unknown problem id', () => {
    const prompts = selfExplanationPrompts('not-a-problem')
    expect(prompts.retention).toMatch(/why/i)
    expect(prompts.integration).toMatch(/stayed true/i)
  })

  it('counts any produced words as answered — never judges correctness', () => {
    expect(reflectionsAnswered(emptyReflections())).toBe(false)
    expect(reflectionsAnswered({ retention: 'wrong but mine', integration: 'also wrong', skipped: false })).toBe(true)
    expect(reflectionsAnswered({ retention: 'something', integration: '   ', skipped: false })).toBe(false)
  })

  it('grounds the echo bridge in the catalogue learning objective', () => {
    expect(echoBridge('binary-search')).toContain('halves the search space')
    expect(echoBridge('not-a-problem')).toMatch(/built to teach/i)
  })

  it('round-trips reflections through storage and recovers corrupt data', () => {
    const disk = storage()
    expect(readReflections(disk, 'g1')).toBeNull()
    expect(saveReflections(disk, 'g1', { retention: 'r', integration: 'i', skipped: false })).toBe(true)
    expect(readReflections(disk, 'g1')).toEqual({ retention: 'r', integration: 'i', skipped: false })
    // One game per key: a second game starts blank.
    expect(readReflections(disk, 'g2')).toBeNull()
    const corrupt = storage({ 'play-the-algorithms:self-explanation:v1:g1': '{bad' })
    expect(readReflections(corrupt, 'g1')).toBeNull()
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readReflections(blocked, 'g1')).toBeNull()
    expect(saveReflections(blocked, 'g1', emptyReflections())).toBe(false)
  })
})
