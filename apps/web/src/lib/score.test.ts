/**
 * The score, and the step count it agrees with.
 *
 * The regression: a flawless binary-search run — 10 frames, every one
 * `correct: true`, `mistakes: 0` — scored 98/100 and the debrief reported "Very
 * close to optimal. You took 10 steps; the reference line needs 9." The
 * reference trace is 9 frames because the oracle's canonical line stops at the
 * search, while the player's run ends with a `submitAnswer` the game requires.
 * The engine forced an extra click and then charged for it.
 *
 * A learner told they wasted a step on a run with no mistakes learns either
 * that the game is unfair or that they are bad at the algorithm. Both are
 * wrong, and the second one is the expensive one.
 */

import { describe, expect, it } from 'vitest'
import type { DebriefResponse, TraceFrame } from '@dsa/game-schema'

import { algorithmSteps, computeScore } from './score.js'

function frame(type: string, index: number, correct = true, dsaOp = 'read'): TraceFrame {
  return {
    index,
    action: { type },
    correct,
    dsaOp,
    note: `note ${index}`,
    codeLine: index + 1,
  } as unknown as TraceFrame
}

/** The real shape of a won binary-search run: 3 reads, 3 compares, 3 paths, 1 commit. */
const PERFECT: TraceFrame[] = [
  ...[0, 1, 2].flatMap((i) => [frame('selectObject', i * 3), frame('comparePair', i * 3 + 1, true, 'compare'), frame('choosePath', i * 3 + 2, true, 'choose-path')]),
  frame('submitAnswer', 9, true, 'terminate'),
]

/** The oracle's reference line: the same nine moves, with no commit. */
const CANONICAL: TraceFrame[] = PERFECT.slice(0, 9)

function debrief(overrides: Partial<DebriefResponse> = {}): DebriefResponse {
  return {
    problemId: 'binary-search',
    phase: 'won',
    playedTrace: PERFECT,
    canonicalTrace: CANONICAL,
    answer: { text: '', value: null, details: [] },
    pseudocode: [],
    code: { javascript: [] },
    complexity: { time: 'O(log n)', space: 'O(1)', best: '', average: '', worst: '' },
    summary: '',
    actionMeaning: {},
    mapping: [],
    stats: { steps: 10, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} },
    hintPool: [],
    ...overrides,
  } as unknown as DebriefResponse
}

describe('algorithmSteps', () => {
  it('excludes the commit from both sides', () => {
    expect(algorithmSteps(PERFECT)).toBe(9)
    expect(algorithmSteps(CANONICAL)).toBe(9)
  })

  it('treats a canonical trace of only commits as having no steps', () => {
    expect(algorithmSteps([frame('submitAnswer', 0, true, 'terminate')])).toBe(0)
  })

  it('tolerates a missing or malformed trace', () => {
    expect(algorithmSteps(undefined)).toBe(0)
    expect(algorithmSteps(null)).toBe(0)
    expect(algorithmSteps([])).toBe(0)
  })
})

describe('computeScore on a flawless run', () => {
  it('awards full marks and charges nothing for the commit', () => {
    const score = computeScore(debrief())
    expect(score.score).toBe(100)
    expect(score.grade).toBe('S')

    const efficiency = score.lines.find((line) => line.label === 'Path efficiency')
    expect(efficiency?.delta).toBe(0)
    // And it must report equal counts, not a gap.
    expect(efficiency?.detail).toBe('9 steps vs 9 in the reference solution')
  })

  it('does not describe a run with no mistakes as merely close to optimal', () => {
    const verdict = computeScore(debrief()).verdict
    expect(verdict).not.toMatch(/close to optimal/i)
    expect(verdict).toMatch(/optimal line/i)
  })

  it('still charges for hints and real mistakes', () => {
    const withHints = computeScore(debrief({ stats: { steps: 10, mistakes: 0, hintsUsed: 2, mistakesByMechanic: {} } }))
    expect(withHints.score).toBe(90)

    const withMistakes = computeScore(
      debrief({
        playedTrace: [frame('selectObject', 0, false), ...PERFECT],
        stats: { steps: 11, mistakes: 1, hintsUsed: 0, mistakesByMechanic: {} },
      }),
    )
    expect(withMistakes.score).toBeLessThan(100)
  })

  it('charges for a genuinely longer path', () => {
    const wanderer = computeScore(
      debrief({ playedTrace: [...PERFECT, frame('comparePair', 10, true, 'compare')] }),
    )
    const efficiency = wanderer.lines.find((line) => line.label === 'Path efficiency')
    expect(efficiency?.delta).toBeLessThan(0)
  })

  it('is honest when there is no reference trace', () => {
    const alone = computeScore(debrief({ canonicalTrace: [] }))
    const efficiency = alone.lines.find((line) => line.label === 'Path efficiency')
    expect(efficiency?.delta).toBe(0)
    expect(efficiency?.detail).toContain('No reference trace')
  })
})
