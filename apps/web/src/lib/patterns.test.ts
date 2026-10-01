import { describe, expect, it } from 'vitest'
import { PROBLEM_IDS } from '@dsa/game-schema'
import { DSA_PATTERNS, getPattern, patternsForProblem, playablePatterns } from './patterns'

const KNOWN = new Set(PROBLEM_IDS)

describe('the pattern library', () => {
  it('covers the 20 classic patterns', () => {
    expect(DSA_PATTERNS.length).toBe(20)
    expect(new Set(DSA_PATTERNS.map((p) => p.id)).size).toBe(20)
  })

  it('only maps to real catalogue problems', () => {
    for (const pattern of DSA_PATTERNS) {
      for (const id of pattern.playIds) {
        expect(KNOWN.has(id), `${pattern.id} maps to unknown problem ${id}`).toBe(true)
      }
    }
  })

  it('gives every pattern a use-case, a template, and practice references', () => {
    for (const pattern of DSA_PATTERNS) {
      expect(pattern.name.trim().length, pattern.id).toBeGreaterThan(0)
      expect(pattern.whenToUse.trim().length, pattern.id).toBeGreaterThan(0)
      expect(pattern.template.trim().length, pattern.id).toBeGreaterThan(0)
      expect(pattern.leetcode.length, pattern.id).toBeGreaterThan(0)
      for (const ref of pattern.leetcode) {
        expect(ref.n, pattern.id).toBeGreaterThan(0)
        expect(ref.name.trim().length, pattern.id).toBeGreaterThan(0)
      }
      expect(pattern.deepDive, pattern.id).toMatch(/^https:\/\//)
    }
  })

  it('leaves only the foundations, union-find, and Kruskal unmapped, deliberately', () => {
    // Every catalogue problem is either mapped from a pattern or absent
    // deliberately: the eight original drills are pre-pattern foundations,
    // two-sum is the hash-lookup counterpart the 20-pattern list never named,
    // and union-find and Kruskal have no pattern in that list (both are
    // reachable from the Blind 75 graphs track instead). Adding a game must
    // update this list.
    const mapped = new Set(DSA_PATTERNS.flatMap((p) => [...p.playIds]))
    const unmapped = [...PROBLEM_IDS].filter((id) => !mapped.has(id)).sort()
    expect(unmapped).toEqual(
      [
        'array-max-min',
        'bubble-sort',
        'kruskal-mst',
        'linked-list-traversal',
        'move-zeroes',
        'queue-operations',
        'selection-sort',
        'stack-push-pop',
        'two-sum',
        'union-find-connect',
        'valid-parentheses',
      ].sort(),
    )
  })

  it('resolves patterns for a problem id', () => {
    expect(patternsForProblem('two-sum').map((p) => p.id)).toEqual([])
    expect(patternsForProblem('two-pointers-pair').map((p) => p.id)).toEqual(['two-pointers'])
    expect(getPattern('nope')).toBeUndefined()
    expect(playablePatterns().every((p) => p.playIds.length > 0)).toBe(true)
  })
})
