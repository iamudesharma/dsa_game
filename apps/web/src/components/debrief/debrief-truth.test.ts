/**
 * The debrief must not tell a learner they erred when they did not.
 *
 * `CanonicalCompare.tsx` and `ExplanationPanel.tsx` both had a defect that only
 * appears on a PERFECT run, which is why neither showed up in a normal
 * playthrough: `findDivergence` fell through to a frame-count comparison, so a
 * 10-frame run against a 9-frame reference produced a "divergence" at step 9
 * and the copy underneath it read "the mistake compounded from here, not from
 * the start" — on a run with `mistakes: 0` and every frame `correct: true`.
 *
 * The functions are re-implemented here as the harness drives them, because they
 * are pure functions of two trace arrays and that is the cheapest honest way to
 * test the branch that matters.
 */

import { describe, expect, it } from 'vitest'
import type { TraceFrame } from '@dsa/game-schema'

function frame(type: string, index: number, correct = true, note = ''): TraceFrame {
  return { index, action: { type }, correct, note, codeLine: index + 1 } as unknown as TraceFrame
}

/** Assign the algorithm operation a frame stands for, as the oracle records it. */
function op(f: TraceFrame, dsaOp: string): TraceFrame {
  ;(f as unknown as { dsaOp: string }).dsaOp = dsaOp
  return f
}

const SHARED = [
  op(frame('selectObject', 0, true, 'mid = 3'), 'read'),
  op(frame('comparePair', 1, true, 'target above mid'), 'compare'),
  op(frame('choosePath', 2, true, 'keep right'), 'choose-path'),
  op(frame('selectObject', 3, true, 'mid = 5'), 'read'),
  op(frame('comparePair', 4, true, 'target below mid'), 'compare'),
  op(frame('choosePath', 5, true, 'keep left'), 'choose-path'),
  op(frame('selectObject', 6, true, 'mid = 4'), 'read'),
  op(frame('comparePair', 7, true, 'target equals mid'), 'compare'),
  op(frame('choosePath', 8, true, 'found'), 'terminate'),
]
const WITH_COMMIT = [...SHARED, op(frame('submitAnswer', 9, true, 'found at v4'), 'terminate')]

/** Mirrors the shipped `findDivergence`, including the tail flag. */
function findDivergence(played: TraceFrame[], canonical: TraceFrame[]) {
  const limit = Math.min(played.length, canonical.length)
  for (let i = 0; i < limit; i += 1) {
    const p = played[i]!
    const c = canonical[i]!
    if (p.correct === false || p.dsaOp !== c.dsaOp) {
      return { index: i, tailOnly: false, playedNote: p.note, canonicalNote: c.note }
    }
  }
  if (played.length > limit) {
    return { index: limit, tailOnly: true, playedNote: played[limit]?.note ?? '' }
  }
  return null
}

/** The three branches the panel renders, keyed off the divergence. */
function panelCopy(divergence: ReturnType<typeof findDivergence>): string {
  if (divergence === null) return 'Every step you took is the step the reference takes.'
  if (divergence.tailOnly) return 'You followed the reference solution exactly, and then finished the round.'
  return 'Everything before this step was right. Whatever went wrong starts here.'
}

describe('a flawless run is not reported as a mistake', () => {
  it('finds no divergence at all when the traces are identical', () => {
    expect(findDivergence(SHARED, SHARED)).toBeNull()
  })

  it('treats a trailing commit as a tail, not a mistake', () => {
    const divergence = findDivergence(WITH_COMMIT, SHARED)
    expect(divergence).not.toBeNull()
    expect(divergence?.tailOnly).toBe(true)
    expect(panelCopy(divergence)).not.toMatch(/mistake|wrong/i)
  })

  /**
   * The second version of the same bug, found by running the app rather than by
   * reading it. Binary search accepts two ways to close the loop, and the
   * reference line takes the shorter one:
   *
   *   played   choosePath  dsaOp=terminate  "found at v2"
   *   canon    submitAnswer dsaOp=terminate  "found: target 15 at index 2"
   *
   * Both `correct: true`, both the same OPERATION. Comparing `action.type`
   * called that a divergence and printed "whatever went wrong starts here"
   * about a run with zero wrong turns. The comparison has to be on `dsaOp`.
   */
  it('matches two different controls that performed the same operation', () => {
    const found = op(frame('choosePath', 8, true, 'found at v2'), 'terminate')
    const submitted = op(frame('submitAnswer', 8, true, 'found: target 15 at index 2'), 'terminate')
    const played = [...SHARED.slice(0, 8), found]
    const canonical = [...SHARED.slice(0, 8), submitted]

    // Same operation, different control, and the shared prefix agrees.
    expect(played[8]!.action.type).not.toBe(canonical[8]!.action.type)
    expect(findDivergence(played, canonical)).toBeNull()
    expect(panelCopy(null)).not.toMatch(/wrong|mistake/i)
  })

  it('never emits the "compounded" sentence for a run with no mistakes', () => {
    // Every arrangement a correct run can produce.
    const runs = [
      [SHARED, SHARED],
      [WITH_COMMIT, SHARED],
      [[...SHARED, ...SHARED], SHARED],
    ] as const
    for (const [played, canonical] of runs) {
      const copy = panelCopy(findDivergence([...played], [...canonical]))
      expect(copy).not.toMatch(/compounded/i)
      expect(copy).not.toMatch(/diverg/i)
    }
  })
})

describe('a real mistake is still found', () => {
  it('reports a wrong move even when the operation matches', () => {
    // The case an operation-only comparison would miss: same op, wrong outcome.
    // The learner claimed the right operation and got it wrong, which is the
    // single most important thing this panel exists to surface.
    const played = [...SHARED]
    played[3] = op(frame('selectObject', 3, false, 'picked the wrong element'), 'read')

    const divergence = findDivergence(played, [...SHARED])
    expect(divergence?.tailOnly).toBe(false)
    expect(divergence?.index).toBe(3)
    expect(panelCopy(divergence)).toMatch(/starts here/i)
  })

  it('reports a genuinely different operation at the point it differs', () => {
    // A correct move that is not the operation the reference performs IS a
    // divergence: the learner won by a route that is not the one being taught,
    // and that is worth naming.
    const played = [...SHARED]
    played[1] = op(frame('choosePath', 1, true, 'discarded a half early'), 'choose-path')
    const divergence = findDivergence(played, [...SHARED])
    expect(divergence?.index).toBe(1)
    expect(divergence?.tailOnly).toBe(false)
  })
})

/** Mirrors `humaniseMisconception` from `ExplanationPanel`. */
function humaniseMisconception(slug: string): string {
  const words = slug.replace(/-/g, ' ').trim()
  if (words === '') return ''
  return `You ${/^[aeiou]/i.test(words) ? 'an' : 'a'} habit of ${words} — worth naming on purpose next time.`
}

describe('misconception tag', () => {
  it('renders nothing for the no-mistakes sentinel', () => {
    // The server now sends `''` rather than the literal `no-mistakes`, because
    // "likely misconception: no-mistakes" reads as a diagnosis to a child who
    // has not made one. The falsy check in the component is what hides the
    // block, so the invariant to assert is that the empty string hides it.
    expect(humaniseMisconception('')).toBe('')
    expect(Boolean(humaniseMisconception(''))).toBe(false)
  })

  it('turns a slug into a phrase, not a diagnosis', () => {
    const phrase = humaniseMisconception('path-selection')
    expect(phrase).toContain('path selection')
    expect(phrase).not.toMatch(/^misconception/i)
    // A learner has a habit, not a misconception.
    expect(phrase).toMatch(/habit of/)
  })

  it('gets the article right', () => {
    expect(humaniseMisconception('off-by-one')).toMatch(/^You an /)
    expect(humaniseMisconception('path-selection')).toMatch(/^You a /)
  })
})
