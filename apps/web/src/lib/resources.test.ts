import { describe, expect, it } from 'vitest'
import { PROBLEM_IDS } from '@dsa/game-schema'
import { isKnownProblem, resourcesForProblem } from './resources'

describe('per-problem study resources', () => {
  it('resolves for every catalogue problem without throwing', () => {
    for (const id of PROBLEM_IDS) {
      const res = resourcesForProblem(id)
      expect(Array.isArray(res.patterns)).toBe(true)
      expect(Array.isArray(res.trackMentions)).toBe(true)
      expect(Array.isArray(res.deepDives)).toBe(true)
      expect(isKnownProblem(id)).toBe(true)
    }
    expect(isKnownProblem('not-a-problem')).toBe(false)
  })

  it('trains the two new games from their patterns', () => {
    const dijkstra = resourcesForProblem('network-delay-time')
    expect(dijkstra.patterns.map((p) => p.id)).toContain('shortest-path')
    expect(dijkstra.deepDives).toContain('https://algomaster.io/learn/dsa/dijkstras-algorithm')

    const coins = resourcesForProblem('coin-change')
    expect(coins.patterns.map((p) => p.id)).toContain('dynamic-programming')
    expect(coins.deepDives).toContain('https://algomaster.io/learn/dsa/dp-introduction')
  })

  it('trains the string-table games from the DP pattern and the 2D track', () => {
    const lcs = resourcesForProblem('lcs-length')
    expect(lcs.patterns.map((p) => p.id)).toContain('dynamic-programming')
    expect(lcs.trackMentions.map((m) => m.n)).toContain(1143)

    const edit = resourcesForProblem('edit-distance')
    expect(edit.patterns.map((p) => p.id)).toContain('dynamic-programming')
    expect(edit.trackMentions.map((m) => m.n)).toContain(72)
  })

  it('stamps the matching Interview Classics items', () => {
    const dijkstra = resourcesForProblem('network-delay-time')
    expect(dijkstra.trackMentions.map((m) => m.n)).toContain(743)

    const coins = resourcesForProblem('coin-change')
    expect(coins.trackMentions.map((m) => m.n)).toContain(322)

    // Foundations have no pattern but still stamp classics items.
    const twoSum = resourcesForProblem('two-sum')
    expect(twoSum.patterns).toEqual([])
    expect(twoSum.deepDives).toEqual([])
    expect(twoSum.trackMentions.map((m) => m.n)).toContain(1)
  })

  it('keeps every mention and deep-dive honest', () => {
    for (const id of PROBLEM_IDS) {
      const res = resourcesForProblem(id)
      for (const mention of res.trackMentions) {
        expect(mention.category.trim().length).toBeGreaterThan(0)
        expect(mention.n).toBeGreaterThan(0)
        expect(mention.name.trim().length).toBeGreaterThan(0)
      }
      for (const url of res.deepDives) {
        expect(url).toMatch(/^https:\/\//)
      }
      // Deep-dives are deduplicated: one per training pattern at most.
      expect(res.deepDives.length).toBeLessThanOrEqual(res.patterns.length)
    }
  })
})
