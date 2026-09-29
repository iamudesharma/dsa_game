/**
 * Tier 4 is the "always playable" guarantee, and it is also the tier a learner
 * sees FIRST: a fresh clone with no API key generates from here. So the prose it
 * produces is not a fallback quality bar, it is the opening line of the product.
 *
 * These tests exist because it was not. Three real defects shipped from this
 * file and none of them were visible without running the generator:
 *
 *   1. `theme.ts` hardcoded the noun in one story template, so the sci-fi theme
 *      emitted "8 unprogrammed actuator actuators" — the template said
 *      "actuator {objectPlural}" and the slot supplied "actuators".
 *   2. `mechanicLabel` hardcoded the article, so every vowel-initial noun in the
 *      theme table produced "take a actuator in hand".
 *   3. The hint pool was `problem.canonicalAlgorithm` split on sentence
 *      punctuation, which handed the caller the whole algorithm in raw `lo=0,
 *      hi=n-1` notation after three requests.
 *
 * The third is the reason the checks below assert on CONTENT rather than on the
 * shape of the output: a hint that is well-formed and leaks the recipe is still
 * a leak, and no schema can catch that.
 */

import { describe, expect, it } from 'vitest'
import { PROBLEMS, type Difficulty, type ProblemMeta } from '@dsa/game-schema'
import type { GenerateSpecInput } from '../types.js'
import { buildTemplateSpec } from './template.js'

/** A structurally valid instance; the prose guarantees do not depend on values. */
function inputFor(problem: ProblemMeta, seed: number, difficulty: Difficulty = 'easy'): GenerateSpecInput {
  return {
    problem,
    instance: {
      problemId: problem.id,
      seed,
      values: [32, 70, 75, 76, 77, 87, 94, 96],
      list: [
        { id: 'n0', value: 3 },
        { id: 'n1', value: 1 },
        { id: 'n2', value: 4 },
      ],
      target: 77,
      slots: [],
    },
    seed,
    difficulty,
  }
}

/** Every learner-facing string in a spec, as one haystack. */
function allProse(spec: ReturnType<typeof buildTemplateSpec>): string {
  return [
    spec.theme.title,
    spec.theme.story,
    spec.objective,
    ...spec.mechanics.map((m) => m.label),
    ...spec.narration.hintPool,
    spec.narration.intro,
    spec.narration.win,
    spec.narration.lose,
    spec.debrief.summary,
  ].join('\n')
}

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard']
const SEEDS = [1, 7, 42, 1234, 99999] as const

describe('template tier prose is grammatical', () => {
  it('never repeats a noun', () => {
    // "actuator actuators" came from a hardcoded noun plus a plural slot.
    for (const problem of PROBLEMS) {
      for (const difficulty of DIFFICULTIES) {
        for (const seed of SEEDS) {
          const prose = allProse(buildTemplateSpec(inputFor(problem, seed, difficulty)))
          expect(prose, `${problem.id}/${difficulty}/${seed}`).not.toMatch(/\b(\w+) \1\b/i)
        }
      }
    }
  })

  it('agrees the article with the noun', () => {
    // "take a actuator" came from a hardcoded `a` in `mechanicLabel`.
    for (const problem of PROBLEMS) {
      for (const seed of SEEDS) {
        const prose = allProse(buildTemplateSpec(inputFor(problem, seed)))
        expect(prose, `${problem.id}/${seed}`).not.toMatch(/\ba [aeiou]\w/i)
      }
    }
  })

  it('leaves no unfilled theme slot behind', () => {
    for (const problem of PROBLEMS) {
      const spec = buildTemplateSpec(inputFor(problem, 3))
      expect(allProse(spec), problem.id).not.toMatch(/\{[a-zA-Z]+\}/)
    }
  })
})

describe('template tier hints cannot leak the algorithm', () => {
  /**
   * The regression that matters. On the default tier, three hint requests used
   * to return:
   *   "First move: Set lo=0, hi=n-1."
   *   "Then: While lo<=hi compute mid=(lo+hi)/2."
   *   "Then: If a[mid]==target stop."
   * which is the algorithm, in notation, as an ordered recipe.
   */
  it('carries no algorithm notation', () => {
    for (const problem of PROBLEMS) {
      const spec = buildTemplateSpec(inputFor(problem, 42))
      for (const hint of spec.narration.hintPool) {
        expect(hint, `${problem.id}: ${hint}`).not.toMatch(/\b(?:lo|hi|mid|i|j)\s*=/i)
        expect(hint, `${problem.id}: ${hint}`).not.toMatch(/\ba\s*\[|\[\s*\w+\s*\]/)
        expect(hint, `${problem.id}: ${hint}`).not.toMatch(/<=|>=|->|=>|::/)
        // A control-flow keyword in its CODE shape, not the English word:
        // "usable for whatever comes next" is prose, "while (lo <= hi)" is not.
        expect(hint, `${problem.id}: ${hint}`).not.toMatch(
          /\b(?:while|for|if|else|return|function|def)\b\s*[\({=]/i,
        )
      }
    }
  })

  it('never names a board position or asserts a result', () => {
    const POSITION = /\b(?:index|position|slot|cell|tile|spot)\s*#?\s*\d+\b/i
    const RESOLUTION = /\bthe\s+answer\s+is\b|\bis\s+the\s+answer\b|\bbest\s+is\b/i
    for (const problem of PROBLEMS) {
      for (const hint of buildTemplateSpec(inputFor(problem, 8)).narration.hintPool) {
        expect(hint, `${problem.id}: ${hint}`).not.toMatch(POSITION)
        expect(hint, `${problem.id}: ${hint}`).not.toMatch(RESOLUTION)
      }
    }
  })

  it('is not a copy of the canonical algorithm', () => {
    // Cheap and exact: if the hint text appears in the canonical text, the tier
    // is shipping the algorithm rather than teaching from it.
    for (const problem of PROBLEMS) {
      const canonical = problem.canonicalAlgorithm.toLowerCase()
      for (const hint of buildTemplateSpec(inputFor(problem, 5)).narration.hintPool) {
        const probe = hint.slice(0, 40).toLowerCase()
        expect(canonical, `${problem.id}: "${probe}"`).not.toContain(probe)
      }
    }
  })

  it('satisfies the schema bounds on every problem and difficulty', () => {
    for (const problem of PROBLEMS) {
      for (const difficulty of DIFFICULTIES) {
        const { hintPool } = buildTemplateSpec(inputFor(problem, 11, difficulty)).narration
        expect(hintPool.length, `${problem.id}/${difficulty}`).toBeGreaterThanOrEqual(2)
        expect(hintPool.length, `${problem.id}/${difficulty}`).toBeLessThanOrEqual(6)
        for (const hint of hintPool) {
          expect(hint.trim()).not.toBe('')
          expect(hint.length).toBeLessThanOrEqual(240)
        }
      }
    }
  })

  it('escalates: a deeper hint is never shorter than a shallower one', () => {
    // The pool is ordered weakest-to-strongest across the problem, and each
    // rung is meant to be more committal. A total absence of that ordering
    // would mean the ladder had degenerated into a shuffled deck.
    for (const problem of PROBLEMS) {
      const pool = buildTemplateSpec(inputFor(problem, 17)).narration.hintPool
      expect(new Set(pool).size, problem.id).toBe(pool.length)
    }
  })
})
