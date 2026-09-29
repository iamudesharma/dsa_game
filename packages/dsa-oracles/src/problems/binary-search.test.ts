/**
 * Property + unit tests for the binary-search oracle.
 *
 * The bulk of this file is property-based: a few hundred seeded instances are
 * pushed through the same assertions (instance validity, canonical-trace
 * correctness, the lo/hi and mid invariants, the halving bound). Seeds are
 * plain integers rather than a random generator, so a failure is always
 * reproducible from the test name alone.
 */

import { describe, expect, it } from 'vitest'
import type { Action, ActionOutcome, GameState, ProblemInstance, TraceFrame } from '@dsa/game-schema'
import { getProblem, linearSlots, PROBLEM_IDS } from '@dsa/game-schema'
import { annotatedCode, createBinarySearchOracle } from './binary-search.js'
import { getOracle, ORACLES, requireOracle, unimplementedProblemIds } from '../registry.js'

const oracle = createBinarySearchOracle()

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
type Difficulty = (typeof DIFFICULTIES)[number]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInstance(seed: number, difficulty: Difficulty = 'easy', length?: number): ProblemInstance {
  return oracle.buildInstance({ seed, difficulty, length })
}

function freshState(seed: number, difficulty: Difficulty = 'easy', length?: number): GameState {
  return oracle.initState(buildInstance(seed, difficulty, length))
}

function nOf(state: GameState, key: string): number {
  const v = state.internal[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN
}

/** `pathId`, but only on the frames that carry one. Narrowed so the test can
 *  read it off a `TraceFrame` without reaching through the Action union. */
function pathIdOf(frame: TraceFrame): string | undefined {
  const action = frame.action as { type: string; pathId?: string }
  return action.type === 'choosePath' ? action.pathId : undefined
}

function bOf(state: GameState, key: string): boolean {
  return state.internal[key] === true
}

function sOf(state: GameState, key: string): string {
  const v = state.internal[key]
  return typeof v === 'string' ? v : ''
}

/** Ground truth, computed the slow and obvious way. */
function linearIndexOf(values: readonly number[], target: number): number {
  for (let k = 0; k < values.length; k++) {
    if (values[k] === target) return k
  }
  return -1
}

function targetOf(instance: ProblemInstance): number {
  return instance.target ?? Number.NaN
}

/**
 * The action a perfect player would take next, derived from the oracle's own
 * bookkeeping. This is deliberately written out longhand instead of reusing
 * the oracle's internals so the test drives the public `applyAction` surface.
 */
function perfectAction(state: GameState): Action {
  const lo = nOf(state, 'lo')
  const hi = nOf(state, 'hi')
  const mid = nOf(state, 'mid')
  const targetIndex = nOf(state, 'targetIndex')
  const target = targetOf(state.instance)

  if (bOf(state, 'terminated')) {
    return { type: 'submitAnswer', targetId: 'answer', value: String(targetIndex) }
  }
  if (!bOf(state, 'midChosen')) {
    return { type: 'selectObject', objectId: `v${Math.floor((lo + hi) / 2)}` }
  }
  if (!bOf(state, 'hasComparison')) {
    const midValue = state.instance.values[mid] ?? Number.NaN
    const relation = midValue < target ? 'gt' : midValue > target ? 'lt' : 'eq'
    return { type: 'comparePair', aId: `v${mid}`, bId: 'target', relation }
  }
  if (sOf(state, 'lastRelation') === 'eq') {
    return { type: 'choosePath', fromId: `v${mid}`, pathId: 'found' }
  }
  return { type: 'choosePath', fromId: `v${mid}`, pathId: targetIndex < mid ? 'left' : 'right' }
}

interface Played {
  state: GameState
  outcomes: ActionOutcome[]
  actions: Action[]
}

function playFrom(state: GameState, maxSteps = 200): Played {
  let current = state
  const outcomes: ActionOutcome[] = []
  const actions: Action[] = []
  for (let k = 0; k < maxSteps && current.phase === 'playing'; k++) {
    const action = perfectAction(current)
    const res = oracle.applyAction(current, action)
    actions.push(action)
    outcomes.push(res.outcome)
    current = res.nextState
  }
  return { state: current, outcomes, actions }
}

/** `legalActions` is optional on the interface; this oracle must implement it. */
function legalActionsOf(state: GameState) {
  const describeActions = oracle.legalActions
  if (!describeActions) throw new Error('binary-search oracle does not implement legalActions')
  return describeActions(state)
}

function allInstances(count: number): ProblemInstance[] {
  const out: ProblemInstance[] = []
  for (let seed = 1; seed <= count; seed++) {
    out.push(buildInstance(seed, DIFFICULTIES[seed % DIFFICULTIES.length] as Difficulty))
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. Correctness of the canonical trace
// ---------------------------------------------------------------------------

describe('canonicalTrace correctness', () => {
  /**
   * The return line depends on the outcome, and the debrief highlights it.
   *
   * `instanceHints.targetGuaranteed` is true, so the not-found branch is not
   * reachable through `buildInstance` — which is exactly why it needed a test
   * written by hand. The canonical trace used to hardcode `return -1` for both
   * outcomes, so a successful reference solution lit the one line the player
   * never executed. An untested branch is how that survived.
   */
  /**
   * The return line a PLAYED commit reports, which is a different code path from
   * the canonical trace's and had the same bug: a successful `submitAnswer`
   * highlighted `return -1`.
   */
  it('reports line 6 for a won commit and line 13 for a wrong one', () => {
    const state = freshState(3)
    const truth = nOf(state, 'targetIndex')
    expect(truth).toBeGreaterThanOrEqual(0)

    // `applyAction` records the frame on the NEXT state's trace, so the frame
    // is read off the resulting trace rather than off the return value.
    const commit = (value: number) => {
      const result = oracle.applyAction(state, {
        type: 'submitAnswer',
        targetId: 'answer',
        value: String(value),
      })
      return { correct: result.outcome.correct, frame: result.nextState.trace.at(-1) }
    }

    const won = commit(truth)
    expect(won.correct).toBe(true)
    expect(won.frame?.codeLine).toBe(6)

    const lost = commit((truth + 1) % state.instance.values.length)
    expect(lost.correct).toBe(false)
    expect(lost.frame?.codeLine).toBe(13)
  })

  it('returns from line 6 on a hit and line 13 on a miss', () => {
    // A hit: the generator guarantees the target is present.
    const hit = oracle.canonicalTrace(freshState(3))
    expect(hit[hit.length - 1]!.codeLine).toBe(6)

    // A miss: an instance whose target is absent, which the generator will
    // not produce but the trace must still describe honestly.
    const instance = buildInstance(3)
    const absent: ProblemInstance = { ...instance, target: undefined }
    const missed = oracle.canonicalTrace(oracle.initState(absent))
    expect(missed).toHaveLength(1)
    expect(missed[0]!.dsaOp).toBe('terminate')
    expect(missed[0]!.codeLine).toBe(13)
    expect(missed[0]!.note).toContain('no target')
  })

  it('finds the true target index on 240 seeded instances', () => {
    let checked = 0
    for (const instance of allInstances(240)) {
      const state = oracle.initState(instance)
      const target = targetOf(instance)
      const truth = linearIndexOf(instance.values, target)

      expect(truth, `seed ${instance.seed}: target must be present`).toBeGreaterThanOrEqual(0)
      expect(truth).toBe(nOf(state, 'targetIndex'))

      const frames = oracle.canonicalTrace(state)
      expect(frames.length).toBeGreaterThan(0)

      const last = frames[frames.length - 1]
      expect(last).toBeDefined()
      if (!last) continue

      // Terminates on the submit frame, and that frame reports the index the
      // naive linear search also found.
      expect(last.dsaOp).toBe('terminate')
      // The return line is 6 (`return mid`) when the target WAS found and 13
      // (`return -1`) when the window emptied. Asserting 13 unconditionally
      // baked a real bug into this test: it passed while the canonical trace
      // highlighted `return -1` for runs that succeeded, which is the one line
      // the player never executed.
      expect(last.codeLine).toBe(6)
      expect(last.action).toEqual({ type: 'submitAnswer', targetId: 'answer', value: String(truth) })
      expect(last.note).toContain(`index ${truth}`)

      // Nothing in the canonical run is ever marked wrong.
      expect(frames.every((f) => f.correct)).toBe(true)
      frames.forEach((frame, i) => expect(frame.index).toBe(i))
      checked += 1
    }
    expect(checked).toBe(240)
  })

  it('narrows the window monotonically and always keeps the target inside it', () => {
    for (const instance of allInstances(120)) {
      const state = oracle.initState(instance)
      const frames = oracle.canonicalTrace(state)
      let previousSpan = Number.POSITIVE_INFINITY

      for (const frame of frames) {
        const lo = Number(frame.variables['lo'])
        const hi = Number(frame.variables['hi'])
        const span = hi - lo + 1
        if (frame.variables['mid'] === -1) continue
        // The target index is never discarded by a correct run.
        const targetIndex = nOf(state, 'targetIndex')
        expect(targetIndex).toBeGreaterThanOrEqual(lo)
        expect(targetIndex).toBeLessThanOrEqual(hi)
        if (frame.dsaOp === 'choose-path') {
          expect(span).toBeLessThan(previousSpan)
        }
        previousSpan = Math.max(previousSpan, span)
      }
    }
  })

  it('adds a commentary note for a flawed playedTrace without changing correctness', () => {
    const instance = buildInstance(99)
    const state = oracle.initState(instance)
    const played = playFrom(state).state.trace
    const withMistake: TraceFrame[] = [
      ...played,
      { ...played[0]!, correct: false, note: 'synthetic slip' },
    ]

    const clean = oracle.canonicalTrace(state)
    const annotated = oracle.canonicalTrace(state, withMistake)

    expect(annotated).toHaveLength(clean.length)
    expect(annotated.every((f) => f.correct)).toBe(true)
    expect(annotated.slice(0, -1)).toEqual(clean.slice(0, -1))
    expect(clean[clean.length - 1]?.note).not.toContain('misstep')
    expect(annotated[annotated.length - 1]?.note).toContain('1 misstep')
  })

  it('does not mutate the state it is given', () => {
    const state = freshState(5150)
    const before = JSON.stringify(state)
    oracle.canonicalTrace(state)
    oracle.canonicalTrace(state, [])
    oracle.answerSummary(state)
    legalActionsOf(state)
    oracle.isWin(state)
    expect(JSON.stringify(state)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// 2 + 3. Invariants of the algorithm's own run
// ---------------------------------------------------------------------------

describe('canonical run invariants', () => {
  it('never violates lo <= hi + 1 and always computes mid = floor((lo + hi) / 2)', () => {
    for (const instance of allInstances(200)) {
      const state = oracle.initState(instance)
      const frames = oracle.canonicalTrace(state)

      for (const frame of frames) {
        const lo = Number(frame.variables['lo'])
        const hi = Number(frame.variables['hi'])
        const mid = Number(frame.variables['mid'])

        // The empty window is representable only as the single step lo = hi+1.
        expect(lo, `seed ${instance.seed} frame ${frame.index}`).toBeLessThanOrEqual(hi + 1)

        // `mid` is only a live value on the frames where the algorithm reads
        // it, i.e. the mid computation (`read`) and the comparison. An
        // elimination frame records the *new* window against the *old* mid
        // (that is the line that just executed), and the terminator has no
        // mid left.
        if (frame.dsaOp === 'read' || frame.dsaOp === 'compare') {
          expect(lo).toBeLessThanOrEqual(hi)
          expect(mid).toBe(Math.floor((lo + hi) / 2))
        } else if (frame.dsaOp === 'choose-path') {
          const previous = frames[frame.index - 1]
          if (previous?.variables['lastRelation'] === 'eq' || pathIdOf(frame) === 'found') {
            // The HIT. The search did not shrink — the target was here — so the
            // "window strictly shrinks" rule does not apply and mid is still the
            // answer rather than something left behind.
            expect(frame.codeLine).toBe(6)
            expect(mid).toBe(Math.floor((lo + hi) / 2))
          } else {
            expect(mid).toBe(Number(previous?.variables['mid']))
            // The window strictly shrinks and mid leaves it behind.
            expect(hi - lo + 1).toBeLessThan(
              Number(previous?.variables['hi']) - Number(previous?.variables['lo']) + 1,
            )
            expect(mid < lo || mid > hi).toBe(true)
          }
        } else {
          expect(frame.dsaOp).toBe('terminate')
          // Two different things terminate, and the difference is the answer
          // sitting in the window: the `choosePath('found')` that reports the
          // hit still points at it (line 6, `return mid`), while the commit
          // that follows has no mid left to report.
          if (pathIdOf(frame) === 'found') {
            expect(frame.codeLine).toBe(6)
            expect(mid).toBe(Math.floor((lo + hi) / 2))
          } else {
            expect(mid).toBe(-1)
          }
        }
      }
    }
  })

  it('lists exactly the elements outside the live window as eliminated', () => {
    for (const instance of allInstances(120)) {
      const n = instance.values.length
      const state = oracle.initState(instance)
      for (const frame of oracle.canonicalTrace(state)) {
        const lo = Number(frame.variables['lo'])
        const hi = Number(frame.variables['hi'])
        const listed = frame.pointers.eliminated ?? []
        const outside = Array.from({ length: n }, (_, k) => `v${k}`).filter(
          (id, k) => k < lo || k > hi,
        )
        // No repeats, and the right elements: the discarded half, never the
        // half that just survived.
        expect(new Set(listed).size, `seed ${instance.seed} frame ${frame.index}`).toBe(listed.length)
        expect([...listed].sort()).toEqual(outside.sort())
      }
    }
  })

  it('marks exactly the discarded elements on the board during a perfect run', () => {
    for (const instance of allInstances(60)) {
      const n = instance.values.length
      let state = oracle.initState(instance)
      let k = 0
      while (state.phase === 'playing' && k < 60) {
        const action = perfectAction(state)
        const res = oracle.applyAction(state, action)
        state = res.nextState
        k += 1

        const frame = state.trace[state.trace.length - 1]
        if (!frame) continue
        const lo = Number(frame.variables['lo'])
        const hi = Number(frame.variables['hi'])
        const outside = new Set(
          Array.from({ length: n }, (_, idx) => `v${idx}`).filter((_, idx) => idx < lo || idx > hi),
        )
        for (let idx = 0; idx < n; idx++) {
          const id = `v${idx}`
          const eliminatedOnBoard = state.objects[id]?.state === 'eliminated'
          const eliminatedSlot = state.slots[`s${idx}`]?.state === 'eliminated'
          // The board only ever loses cells, and it loses exactly the ones
          // that just fell outside the window.
          expect(eliminatedOnBoard, `${instance.seed} frame ${frame.index} ${id}`).toBe(outside.has(id))
          expect(eliminatedSlot, `${instance.seed} frame ${frame.index} s${idx}`).toBe(outside.has(id))
          // `pointers.eliminated` and the board must agree.
          expect((frame.pointers.eliminated ?? []).includes(id)).toBe(outside.has(id))
        }
      }
      expect(state.phase).toBe('won')
    }
  })

  it('halves the space: comparisons <= ceil(log2(n)) + 1', () => {
    for (const instance of allInstances(200)) {
      const n = instance.values.length
      const state = oracle.initState(instance)
      const frames = oracle.canonicalTrace(state)
      const comparisons = frames.filter((f) => f.dsaOp === 'compare').length

      // Brief's bound, plus the tight worst case floor(log2 n) + 1. A lucky
      // target can be found earlier, so there is no matching lower bound.
      expect(comparisons).toBeGreaterThanOrEqual(1)
      expect(comparisons).toBeLessThanOrEqual(Math.ceil(Math.log2(n)) + 1)
      expect(comparisons).toBeLessThanOrEqual(Math.floor(Math.log2(n)) + 1)
    }
  })

  /**
   * The shape of a reference run, and why it is TWO terminators.
   *
   * A `found` run is `read, compare, choosePath` per narrowing step, then a
   * `choosePath('found')` that REPORTS the hit, and only then the commit. The
   * old count assumed a single terminator, because the reference used to break
   * straight from the final comparison to `submitAnswer` — which made it
   * UNPLAYABLE: the game asks for the path decision before it will accept a
   * commit. `playability.test.ts` replays the reference and refused it.
   */
  it('emits one frame per mid / compare / eliminate step, then the hit and the commit', () => {
    for (const instance of allInstances(80)) {
      const state = oracle.initState(instance)
      const frames = oracle.canonicalTrace(state)
      const reads = frames.filter((f) => f.dsaOp === 'read').length
      const compares = frames.filter((f) => f.dsaOp === 'compare').length
      const paths = frames.filter((f) => f.dsaOp === 'choose-path').length
      const terminators = frames.filter((f) => f.dsaOp === 'terminate').length

      expect(reads).toBe(compares)
      expect(paths).toBe(compares - 1)
      // One terminator reports the hit, one commits it.
      expect(terminators).toBe(2)
      expect(frames).toHaveLength(reads + compares + paths + 2)
      expect(frames[frames.length - 2] ? pathIdOf(frames[frames.length - 2]!) : undefined).toBe('found')
      expect(frames[frames.length - 1]?.action.type).toBe('submitAnswer')
      expect(frames[frames.length - 1]?.dsaOp).toBe('terminate')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. The playable path
// ---------------------------------------------------------------------------

describe('a perfect run wins', () => {
  it('select -> compare -> choosePath ... -> submitAnswer reaches phase "won"', () => {
    for (const instance of allInstances(60)) {
      const start = oracle.initState(instance)
      const { state, outcomes, actions } = playFrom(start)

      expect(state.phase, `seed ${instance.seed}`).toBe('won')
      expect(oracle.isWin(state)).toBe(true)
      expect(outcomes.every((o) => o.correct)).toBe(true)
      expect(outcomes.some((o) => o.won === true)).toBe(true)
      expect(outcomes.some((o) => o.illegal === true)).toBe(false)
      expect(state.progress.mistakes).toBe(0)

      // Exactly one trace frame per action, indexed 0..k-1 in order.
      expect(state.trace).toHaveLength(actions.length)
      expect(state.trace).toHaveLength(outcomes.length)
      state.trace.forEach((frame, i) => {
        expect(frame.index).toBe(i)
        expect(frame.action).toEqual(actions[i])
        expect(frame.correct).toBe(true)
        expect(outcomes[i]?.traceStep).toBe(i)
      })

      // The winning move is the last one and it revealed the target cell.
      const last = state.trace[state.trace.length - 1]
      expect(last?.action.type).toBe('submitAnswer')
      expect(state.objects[`v${nOf(state, 'targetIndex')}`]?.state).toBe('revealed')

      // The player's comparison count matches the canonical run exactly.
      const canonical = oracle.canonicalTrace(start)
      expect(outcomes.filter((o) => o.dsaOp === 'compare')).toHaveLength(
        canonical.filter((f) => f.dsaOp === 'compare').length,
      )
      expect(nOf(state, 'comparisons')).toBe(canonical.filter((f) => f.dsaOp === 'compare').length)
    }
  })

  it('keeps the target inside the window all the way to the hit', () => {
    let runsWithADiscard = 0
    for (const instance of allInstances(30)) {
      const start = oracle.initState(instance)
      const targetIndex = nOf(start, 'targetIndex')
      const { state, actions } = playFrom(start)

      // Every turn of the run keeps the target reachable.
      expect(Number(state.variables['lo'])).toBeLessThanOrEqual(targetIndex)
      expect(Number(state.variables['hi'])).toBeGreaterThanOrEqual(targetIndex)
      expect(state.slots[`s${targetIndex}`]?.state).not.toBe('eliminated')
      expect(state.objects[`v${targetIndex}`]?.state).toBe('revealed')
      expect(actions.at(-1)?.type).toBe('submitAnswer')

      // The hit is reported before the answer is committed.
      const foundFrame = state.trace.find((f) => f.dsaOp === 'terminate' && f.codeLine === 6)
      expect(foundFrame?.action).toEqual({
        type: 'choosePath',
        fromId: `v${targetIndex}`,
        pathId: 'found',
      })

      // Some runs get lucky on the first probe; most have to discard a half.
      if (state.trace.some((f) => f.dsaOp === 'choose-path')) runsWithADiscard += 1
    }
    expect(runsWithADiscard).toBeGreaterThan(10)
  })
})

// ---------------------------------------------------------------------------
// 5. The wrong path
// ---------------------------------------------------------------------------

describe('a wrong path choice is applied, reported, and fatal', () => {
  it('reports the expectation, eliminates the target, and loses the run', () => {
    for (const instance of allInstances(60)) {
      const start = oracle.initState(instance)
      const targetIndex = nOf(start, 'targetIndex')

      const afterSelect = oracle.applyAction(start, perfectAction(start))
      expect(afterSelect.outcome.correct).toBe(true)
      const afterCompare = oracle.applyAction(afterSelect.nextState, perfectAction(afterSelect.nextState))
      expect(afterCompare.outcome.correct).toBe(true)

      const compared = afterCompare.nextState
      const mid = nOf(compared, 'mid')
      const correctPath = sOf(compared, 'lastRelation') === 'eq' ? 'found' : targetIndex < mid ? 'left' : 'right'
      const wrongPath = correctPath === 'left' ? 'right' : 'left'

      const res = oracle.applyAction(compared, {
        type: 'choosePath',
        fromId: `v${mid}`,
        pathId: wrongPath,
      })

      expect(res.outcome.correct, `seed ${instance.seed}`).toBe(false)
      expect(res.outcome.illegal).toBeUndefined()
      expect(res.outcome.won).toBeFalsy()
      expect(res.outcome.expected).toEqual({
        type: 'choosePath',
        fromId: `v${mid}`,
        pathId: correctPath,
      })
      expect(res.outcome.feedback).toMatch(/ruled out/i)

      // The mistake is applied, not auto-corrected: the discarded half really
      // is marked gone, and the target really is outside the new window.
      const lo = nOf(res.nextState, 'lo')
      const hi = nOf(res.nextState, 'hi')
      expect(lo > hi || targetIndex < lo || targetIndex > hi).toBe(true)
      expect(res.nextState.objects[`v${targetIndex}`]?.state).toBe('eliminated')
      expect(res.nextState.slots[`s${targetIndex}`]?.state).toBe('eliminated')
      expect(bOf(res.nextState, 'wrongPath')).toBe(true)
      expect(res.nextState.progress.mistakes).toBe(1)

      expect(res.nextState.phase).toBe('lost')
      expect(oracle.isWin(res.nextState)).toBe(false)
      expect(res.nextState.trace).toHaveLength(3)
    }
  })

  it('ends the run: further actions are illegal', () => {
    const start = freshState(77)
    const s1 = oracle.applyAction(start, perfectAction(start)).nextState
    const s2 = oracle.applyAction(s1, perfectAction(s1)).nextState
    const mid = nOf(s2, 'mid')
    const res = oracle.applyAction(s2, { type: 'choosePath', fromId: `v${mid}`, pathId: 'upwards' })
    const after = oracle.applyAction(res.nextState, { type: 'selectObject', objectId: `v${mid}` })
    expect(after.outcome.illegal).toBe(true)
  })

  it('a wrong relation is reported, leaves the window alone, and can be retried', () => {
    const start = freshState(1234)
    const targetIndex = nOf(start, 'targetIndex')
    const mid = nOf(start, 'mid') // the first mid exists before any move
    const s1 = oracle.applyAction(start, perfectAction(start)).nextState
    const chosen = nOf(s1, 'mid')
    const midValue = s1.instance.values[chosen] ?? 0
    const target = targetOf(s1.instance)
    const trueRelation = midValue < target ? 'gt' : midValue > target ? 'lt' : 'eq'
    const wrongRelation = trueRelation === 'lt' ? 'gt' : 'lt'

    const loBefore = nOf(s1, 'lo')
    const hiBefore = nOf(s1, 'hi')
    const res = oracle.applyAction(s1, {
      type: 'comparePair',
      aId: `v${chosen}`,
      bId: 'target',
      relation: wrongRelation,
    })

    expect(res.outcome.correct).toBe(false)
    expect(res.outcome.illegal).toBeUndefined()
    expect(res.outcome.expected).toMatchObject({ type: 'comparePair', relation: trueRelation })
    // Nothing was discarded.
    expect(nOf(res.nextState, 'lo')).toBe(loBefore)
    expect(nOf(res.nextState, 'hi')).toBe(hiBefore)
    expect(nOf(res.nextState, 'comparisons')).toBe(0)
    expect(res.nextState.objects[`v${targetIndex}`]?.state).not.toBe('eliminated')
    expect(res.nextState.phase).toBe('playing')
    // The player has not chosen a path yet.
    const early = oracle.applyAction(res.nextState, {
      type: 'choosePath',
      fromId: `v${chosen}`,
      pathId: 'left',
    })
    expect(early.outcome.illegal).toBe(true)
    // Retrying with the right relation works, and the mid pointer never moved.
    const retry = oracle.applyAction(res.nextState, perfectAction(res.nextState))
    expect(retry.outcome.correct).toBe(true)
    expect(mid).toBe(chosen)
  })

  it('accepts the relation in either argument order', () => {
    const start = freshState(606)
    const s1 = oracle.applyAction(start, perfectAction(start)).nextState
    const forward = oracle.applyAction(s1, perfectAction(s1))
    const s1b = oracle.applyAction(start, perfectAction(start)).nextState
    const reversed = oracle.applyAction(s1b, {
      type: 'comparePair',
      aId: 'target',
      bId: `v${nOf(s1, 'mid')}`,
      relation: (perfectAction(s1) as Extract<Action, { type: 'comparePair' }>).relation,
    })
    expect(forward.outcome.correct).toBe(true)
    expect(reversed.outcome.correct).toBe(true)
  })

  it('treats selecting the target object as a legal but pointless move', () => {
    const start = freshState(31)
    const res = oracle.applyAction(start, { type: 'selectObject', objectId: 'target' })
    expect(res.outcome.illegal).toBeUndefined()
    expect(res.outcome.correct).toBe(false)
    expect(res.outcome.expected).toMatchObject({ type: 'selectObject' })
    expect(bOf(res.nextState, 'midChosen')).toBe(false)
    expect(res.nextState.phase).toBe('playing')
  })

  it('resolves a slot id as "keep the side that holds the target"', () => {
    const start = freshState(808)
    const targetIndex = nOf(start, 'targetIndex')
    const s1 = oracle.applyAction(start, perfectAction(start)).nextState
    const s2 = oracle.applyAction(s1, perfectAction(s1)).nextState
    const mid = nOf(s2, 'mid')
    // Any slot id resolves through the truth, so it is always the right call.
    const res = oracle.applyAction(s2, { type: 'choosePath', fromId: `v${mid}`, pathId: 's7' })
    expect(res.outcome.correct).toBe(true)
    const lo = nOf(res.nextState, 'lo')
    const hi = nOf(res.nextState, 'hi')
    expect(lo <= targetIndex).toBe(true)
    expect(hi >= targetIndex).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Illegal actions
// ---------------------------------------------------------------------------

describe('illegal actions', () => {
  const ILLEGAL: readonly Action[] = [
    { type: 'selectObject', objectId: 'does-not-exist' },
    { type: 'selectObject', objectId: 'v999' },
    { type: 'swapPair', aId: 'v0', bId: 'v1' },
    { type: 'moveObject', objectId: 'v0', toSlotId: 's1' },
    { type: 'traverseNode', fromNodeId: 'v0', toNodeId: 'v1' },
    { type: 'pushPop', containerId: 'c0', op: 'push', objectId: 'v0' },
    { type: 'connectNodes', fromNodeId: 'v0', toNodeId: 'v1', linkKind: 'next' },
    // compare before select
    { type: 'comparePair', aId: 'v0', bId: 'target', relation: 'lt' },
    // choosePath before compare
    { type: 'choosePath', fromId: 'v0', pathId: 'left' },
    { type: 'assignValue', targetId: 'nope', value: '2' },
    { type: 'assignValue', targetId: 'mid', value: 'banana' },
    { type: 'assignValue', targetId: 'mid', value: '99' },
    { type: 'submitAnswer', targetId: 'answer', value: '' },
    { type: 'submitAnswer', targetId: 'answer', value: 'seven' },
  ]

  it('are rejected without throwing and without touching the board', () => {
    for (const action of ILLEGAL) {
      const start = freshState(3)
      const res = oracle.applyAction(start, action)

      expect(res.outcome.illegal, JSON.stringify(action)).toBe(true)
      expect(res.outcome.correct).toBe(false)
      expect(res.outcome.traceStep).toBe(0)
      expect(res.outcome.feedback.length).toBeGreaterThan(0)

      // Only progress.steps and one trace frame may differ.
      expect(res.nextState.objects).toEqual(start.objects)
      expect(res.nextState.slots).toEqual(start.slots)
      expect(res.nextState.containers).toEqual(start.containers)
      expect(res.nextState.links).toEqual(start.links)
      expect(res.nextState.variables).toEqual(start.variables)
      expect(res.nextState.cursor).toEqual(start.cursor)
      expect(res.nextState.internal).toEqual(start.internal)
      expect(res.nextState.selection).toEqual(start.selection)
      expect(res.nextState.phase).toBe('playing')
      expect(res.nextState.progress.steps).toBe(1)
      expect(res.nextState.progress.mistakes).toBe(0)
      expect(res.nextState.trace).toHaveLength(1)
      expect(res.nextState.trace[0]?.correct).toBe(false)
      expect(res.nextState.trace[0]?.index).toBe(0)
      expect(res.nextState.trace[0]?.codeLineText).toBe(oracle.code('javascript')[0])
    }
  })

  it('rejects a repeated selection of the current mid', () => {
    const start = freshState(3)
    const first = oracle.applyAction(start, perfectAction(start))
    expect(first.outcome.correct).toBe(true)
    const mid = nOf(first.nextState, 'mid')
    expect(mid).toBeGreaterThanOrEqual(0)

    const again = oracle.applyAction(first.nextState, { type: 'selectObject', objectId: `v${mid}` })
    expect(again.outcome.illegal).toBe(true)
    expect(again.nextState.objects).toEqual(first.nextState.objects)
    expect(again.nextState.slots).toEqual(first.nextState.slots)
    expect(again.nextState.internal).toEqual(first.nextState.internal)
    expect(again.nextState.trace).toHaveLength(2)
  })

  it('rejects a second comparison of the same pair', () => {
    const start = freshState(3)
    const s1 = oracle.applyAction(start, perfectAction(start)).nextState
    const s2 = oracle.applyAction(s1, perfectAction(s1)).nextState
    // Replay the very same comparison: the first one is already on record.
    const first = perfectAction(s1) as Extract<Action, { type: 'comparePair' }>
    const action: Action = { type: 'comparePair', aId: first.aId, bId: first.bId, relation: first.relation }
    const again = oracle.applyAction(s2, action)
    expect(again.outcome.illegal).toBe(true)
    expect(again.nextState.internal).toEqual(s2.internal)
  })

  it('rejects a comparePair that is not mid-vs-target', () => {
    const start = freshState(3)
    const s1 = oracle.applyAction(start, perfectAction(start)).nextState
    const mid = nOf(s1, 'mid')
    const res = oracle.applyAction(s1, { type: 'comparePair', aId: `v${mid}`, bId: `v${mid + 1}`, relation: 'lt' })
    expect(res.outcome.illegal).toBe(true)
  })

  it('rejects everything once the run is over', () => {
    const won = playFrom(freshState(9)).state
    expect(won.phase).toBe('won')
    for (const action of ILLEGAL.slice(0, 4)) {
      const res = oracle.applyAction(won, action)
      expect(res.outcome.illegal).toBe(true)
      expect(res.nextState.objects).toEqual(won.objects)
    }
  })

  it('never throws, whatever it is handed', () => {
    const start = freshState(3)
    const hostile: unknown[] = [undefined, null, 42, 'selectObject', {}, { type: 'nope' }]
    for (const raw of hostile) {
      const action = raw as Action
      expect(() => oracle.applyAction(start, action)).not.toThrow()
      const res = oracle.applyAction(start, action)
      expect(res.outcome.illegal).toBe(true)
      expect(res.nextState.phase).toBe('playing')
      expect(res.nextState.objects).toEqual(start.objects)
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Purity
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('applyAction leaves the input state byte-identical', () => {
    let state = freshState(20260926)
    for (let k = 0; k < 8 && state.phase === 'playing'; k++) {
      const before = JSON.stringify(state)
      const deep = structuredClone(state)
      const res = oracle.applyAction(state, perfectAction(state))
      expect(JSON.stringify(state)).toBe(before)
      expect(state).toEqual(deep)
      expect(res.nextState).not.toBe(state)
      expect(res.nextState.instance).not.toBe(state.instance)
      state = res.nextState
    }
  })

  it('applyAction leaves the shared instance untouched', () => {
    const instance = buildInstance(4711)
    const before = JSON.stringify(instance)
    let state = oracle.initState(instance)
    for (let k = 0; k < 8 && state.phase === 'playing'; k++) {
      state = oracle.applyAction(state, perfectAction(state)).nextState
    }
    // `cloneState` is `structuredClone`, so each turn also hands back a copy
    // of the instance. The caller's instance must survive all of it.
    expect(JSON.stringify(instance)).toBe(before)
    expect(state.instance).toStrictEqual(instance)
    expect(state.instance).not.toBe(instance)
  })

  it('two independent runs of the same input produce the same trace', () => {
    const a = playFrom(freshState(6161))
    const b = playFrom(freshState(6161))
    expect(JSON.stringify(b.state.trace)).toBe(JSON.stringify(a.state.trace))
    expect(b.state.phase).toBe(a.state.phase)
  })

  it('initState and the reporting helpers are pure', () => {
    const instance = buildInstance(8)
    const before = JSON.stringify(instance)
    const a = oracle.initState(instance)
    const b = oracle.initState(instance)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    oracle.answerSummary(a)
    legalActionsOf(a)
    oracle.complexity()
    oracle.code('python')
    oracle.pseudocode()
    expect(JSON.stringify(instance)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// 8. Determinism and instance validity
// ---------------------------------------------------------------------------

describe('buildInstance', () => {
  it('is a pure function of its input', () => {
    const a = buildInstance(42, 'easy')
    const b = buildInstance(42, 'easy')
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    expect(JSON.stringify(buildInstance(42, 'medium'))).not.toBe(JSON.stringify(a))
  })

  it('varies with the seed', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) seen.add(JSON.stringify(buildInstance(seed).values))
    expect(seen.size).toBeGreaterThan(55)
    expect(JSON.stringify(buildInstance(42).values)).not.toBe(JSON.stringify(buildInstance(43).values))
  })

  it('is sorted, unique, in range, and puts the target beyond the first probe', () => {
    const hints = getProblem('binary-search')?.instanceHints
    const [rangeMin, rangeMax] = hints?.valueRange ?? [1, 99]
    for (const instance of allInstances(200)) {
      const values = instance.values
      const target = targetOf(instance)

      expect(values.length).toBeGreaterThanOrEqual(hints?.minLength ?? 8)
      expect(values.length).toBeLessThanOrEqual(hints?.maxLength ?? 16)
      for (let k = 0; k < values.length; k++) {
        const v = values[k] ?? Number.NaN
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(rangeMin ?? 1)
        expect(v).toBeLessThanOrEqual(rangeMax ?? 99)
        if (k > 0) expect(v).toBeGreaterThan(values[k - 1] as number)
      }

      expect(values).toContain(target)
      const index = linearIndexOf(values, target)
      // Not at the leading edge...
      expect(index).toBeGreaterThan(0)
      // ...and crucially not the first midpoint, because a target found on the
      // first probe never runs the halving loop this problem exists to teach.
      const firstMid = Math.floor((values.length - 1) / 2)
      expect(index).not.toBe(firstMid)
      expect(index).toBeGreaterThanOrEqual(1)

      expect(instance.problemId).toBe('binary-search')
      expect(instance.seed).toBeGreaterThan(0)
      expect(instance.slots).toEqual(linearSlots(values.length))
      expect(instance.extras?.['targetIndex']).toBe(index)
      expect(instance.extras?.['lo']).toBe(0)
      expect(instance.extras?.['hi']).toBe(values.length - 1)
      expect(instance.extras?.['mid']).toBe(firstMid)
      expect(instance.extras?.['found']).toBe(false)
      expect(instance.extras?.['comparisons']).toBe(0)
      expect(instance.extras?.['steps']).toBe(0)
      expect(instance.extras?.['wrongAnswers']).toBe(0)
      expect(instance.extras?.['history']).toEqual([])
    }
  })

  it('follows the difficulty curve and clamps to the hints', () => {
    expect(buildInstance(1, 'easy').values).toHaveLength(8)
    expect(buildInstance(1, 'medium').values).toHaveLength(12)
    expect(buildInstance(1, 'hard').values).toHaveLength(16)
    expect(buildInstance(1, 'easy', 3).values).toHaveLength(8)
    expect(buildInstance(1, 'easy', 500).values).toHaveLength(16)
    expect(buildInstance(1, 'hard', 10).values).toHaveLength(10)
  })

  it('initState lays out one object and one occupied slot per element', () => {
    const instance = buildInstance(31415)
    const state = oracle.initState(instance)
    const n = instance.values.length

    expect(Object.keys(state.objects)).toHaveLength(n + 1)
    expect(Object.keys(state.slots)).toHaveLength(n)
    for (let k = 0; k < n; k++) {
      const obj = state.objects[`v${k}`]
      const slot = state.slots[`s${k}`]
      expect(obj).toEqual({
        id: `v${k}`,
        kind: 'number',
        label: String(instance.values[k]),
        value: instance.values[k],
        slotId: `s${k}`,
        visual: { kind: 'text', text: String(instance.values[k]) },
        state: 'idle',
        tags: { index: k },
      })
      expect(slot).toMatchObject({ id: `s${k}`, index: k, kind: 'default', occupantId: `v${k}`, state: 'idle' })
    }
    expect(state.objects['target']).toEqual({
      id: 'target',
      kind: 'target',
      label: 'target',
      value: instance.target,
      visual: { kind: 'text', text: String(instance.target) },
      state: 'idle',
    })

    expect(state.containers).toEqual({})
    expect(state.links).toEqual([])
    expect(state.selection).toEqual([])
    // The window and the first mid pointer both exist before the first move, so
    // the board can show them immediately and the first selection can succeed.
    const firstMid = Math.floor((n - 1) / 2)
    expect(state.cursor).toEqual({
      loSlotId: 's0',
      midSlotId: `s${firstMid}`,
      hiSlotId: `s${n - 1}`,
    })
    expect(state.variables).toEqual({
      lo: 0,
      mid: firstMid,
      hi: n - 1,
      target: instance.target,
      comparisons: 0,
      steps: 0,
      found: false,
    })
    expect(state.progress).toEqual({ steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} })
    expect(state.phase).toBe('playing')
    expect(state.trace).toEqual([])
    expect(state.internal['history']).toBe('[]')
    expect(state.internal['mid']).toBe(Math.floor((n - 1) / 2))
    expect(state.internal['midChosen']).toBe(false)
    expect(JSON.parse(String(state.internal['history']))).toEqual([])

    // The first probe is known before the first move, and the same value is
    // reported everywhere (`extras`, `internal`, `variables`, `cursor`), so a
    // consumer can pick the right cell without any lookahead.
    expect(instance.extras?.['mid']).toBe(firstMid)
    expect(state.internal['mid']).toBe(firstMid)
    expect(state.variables['mid']).toBe(firstMid)
    expect(state.cursor.midSlotId).toBe(`s${firstMid}`)

    // Consequence worth pinning: the very first selection is already gradeable,
    // so a run can never be stuck on turn one.
    const first = oracle.applyAction(state, { type: 'selectObject', objectId: `v${firstMid}` })
    expect(first.outcome.correct).toBe(true)
    expect(first.outcome.illegal).toBeUndefined()
    expect(first.outcome.expected).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 9. Code line mapping
// ---------------------------------------------------------------------------

describe('code line mapping', () => {
  it('every canonical frame points at the real source line', () => {
    const js = oracle.code('javascript')
    for (const instance of allInstances(80)) {
      const frames = oracle.canonicalTrace(oracle.initState(instance))
      for (const frame of frames) {
        expect(frame.codeLine).toBeGreaterThanOrEqual(1)
        expect(frame.codeLine).toBeLessThanOrEqual(js.length)
        expect(frame.codeLineText).toBe(js[frame.codeLine - 1])
      }
    }
  })

  it('every gameplay frame points at the real source line too', () => {
    const js = oracle.code('javascript')
    const start = freshState(2024)
    const { state } = playFrom(start)
    expect(state.trace.length).toBeGreaterThan(3)
    for (const frame of state.trace) {
      expect(frame.codeLineText).toBe(js[frame.codeLine - 1])
    }
  })

  it('uses one numbering across javascript, python and pseudocode', () => {
    for (const language of ['javascript', 'typescript', 'python', 'java', 'cpp'] as const) {
      expect(oracle.code(language)).toHaveLength(14)
    }
    expect(oracle.pseudocode()).toHaveLength(14)

    const js = oracle.code('javascript')
    const py = oracle.code('python')
    const ps = oracle.pseudocode()

    // The three statements the trace points at must sit on the same line in
    // every listing, and `return -1` must be line 13 in all of them.
    expect(js[12]).toContain('return -1')
    expect(py[12]).toContain('return -1')
    expect(ps[12]).toContain('RETURN -1')
    expect(js[4]).toContain('mid')
    expect(py[4]).toContain('mid')
    expect(ps[4]).toContain('mid')
    expect(js[7]).toContain('lo = mid + 1')
    expect(py[7]).toContain('lo = mid + 1')
    expect(ps[7]).toContain('lo <- mid + 1')
    expect(js[9]).toContain('hi = mid - 1')
    expect(py[9]).toContain('hi = mid - 1')
    expect(ps[9]).toContain('hi <- mid - 1')

    // Typescript and the unspecialised languages fall back to javascript
    // rather than throwing.
    expect(oracle.code('typescript')).toEqual(js)
    expect(oracle.code('java')).toEqual(js)
    expect(oracle.code('cpp')).toEqual(js)
  })

  it('offers a rich annotated listing with the same 14 numbered statements', () => {
    const annotated = annotatedCode('javascript')
    expect(annotated.length).toBeGreaterThan(14)
    expect(annotated.some((l) => l.startsWith(' 5 |') && l.includes('mid'))).toBe(true)
    expect(annotated.some((l) => l.startsWith('13 |') && l.includes('return -1'))).toBe(true)
    expect(annotatedCode('python').some((l) => l.startsWith('13 |'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Remaining surface: answers, complexity, legal actions, registry
// ---------------------------------------------------------------------------

describe('answerSummary', () => {
  it('reports the index, the target, the comparison count and the length', () => {
    const instance = buildInstance(1024)
    const fresh = oracle.initState(instance)
    expect(oracle.answerSummary(fresh)).toEqual({
      text: `index ${nOf(fresh, 'targetIndex')}`,
      value: nOf(fresh, 'targetIndex'),
      details: [
        { label: 'target', value: instance.target },
        { label: 'comparisons', value: 0 },
        { label: 'array length', value: instance.values.length },
      ],
    })

    const won = playFrom(fresh).state
    const summary = oracle.answerSummary(won)
    expect(summary.value).toBe(nOf(won, 'targetIndex'))
    expect(summary.details?.find((d) => d.label === 'comparisons')?.value).toBe(nOf(won, 'comparisons'))
    expect(summary.details?.find((d) => d.label === 'target')?.value).toBe(instance.target)
  })
})

describe('complexity', () => {
  it('is the binary-search cost model', () => {
    expect(oracle.complexity()).toEqual({
      time: 'O(log n)',
      space: 'O(1)',
      best: 'O(1)',
      worst: 'O(log n)',
      average: 'O(log n)',
      note: 'Every comparison halves the search space.',
    })
  })
})

describe('legalActions', () => {
  it('advertises the next expected interaction and nothing else', () => {
    const start = freshState(55)
    const descriptors = legalActionsOf(start)
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]?.type).toBe('selectObject')
    expect(descriptors[0]?.options?.objectIds).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'])

    const s1 = oracle.applyAction(start, perfectAction(start)).nextState
    expect(legalActionsOf(s1)[0]?.type).toBe('comparePair')
    expect(legalActionsOf(s1)[0]?.expects).toBe('relation')

    const s2 = oracle.applyAction(s1, perfectAction(s1)).nextState
    expect(legalActionsOf(s2)[0]?.type).toBe('choosePath')

    // Only the elements still inside the window are offered.
    const s3 = oracle.applyAction(s2, perfectAction(s2)).nextState
    const next = legalActionsOf(s3)[0]
    expect(next?.type).toBe('selectObject')
    const offered = next?.options?.objectIds ?? []
    const lo = nOf(s3, 'lo')
    const hi = nOf(s3, 'hi')
    expect(offered).toEqual(
      Array.from({ length: hi - lo + 1 }, (_, k) => `v${lo + k}`),
    )
  })

  it('offers submitAnswer after the hit is reported, and nothing after the run', () => {
    const { state } = playFrom(freshState(56))
    expect(state.phase).toBe('won')
    expect(legalActionsOf(state)).toEqual([])
  })

  it('keeps cursor, variables and internal in agreement about the mid', () => {
    for (const instance of allInstances(40)) {
      let state = oracle.initState(instance)
      let k = 0
      while (state.phase === 'playing' && k < 60) {
        state = oracle.applyAction(state, perfectAction(state)).nextState
        k += 1
        const mid = nOf(state, 'mid')
        // The mid is reported identically everywhere, every turn.
        expect(state.variables['mid']).toBe(mid)
        expect(state.cursor.midSlotId).toBe(mid >= 0 ? `s${mid}` : undefined)
        expect(state.variables['lo']).toBe(nOf(state, 'lo'))
        expect(state.variables['hi']).toBe(nOf(state, 'hi'))
      }
      expect(state.phase).toBe('won')
    }
  })
})

describe('submitAnswer', () => {
  it('accepts the index, the value, or a cell id', () => {
    const start = freshState(4321)
    const targetIndex = nOf(start, 'targetIndex')
    const target = targetOf(start.instance)

    for (const value of [String(targetIndex), String(target), `v${targetIndex}`, `s${targetIndex}`, ` index ${targetIndex} `]) {
      const state = oracle.initState(start.instance)
      const res = oracle.applyAction(state, { type: 'submitAnswer', targetId: 'answer', value })
      expect(res.outcome.correct, value).toBe(true)
      expect(res.outcome.won).toBe(true)
      expect(res.nextState.phase).toBe('won')
      expect(oracle.isWin(res.nextState)).toBe(true)
      expect(res.nextState.objects[`v${targetIndex}`]?.state).toBe('revealed')
    }
  })

  it('loses the run and names the real index on a wrong answer', () => {
    const start = freshState(8765)
    const targetIndex = nOf(start, 'targetIndex')
    const wrong = (targetIndex + 3) % start.instance.values.length
    const res = oracle.applyAction(start, { type: 'submitAnswer', targetId: 'answer', value: String(wrong) })

    expect(res.outcome.correct).toBe(false)
    expect(res.outcome.illegal).toBeUndefined()
    expect(res.outcome.won).toBe(false)
    expect(res.outcome.expected).toEqual({
      type: 'submitAnswer',
      targetId: 'answer',
      value: String(targetIndex),
    })
    expect(res.outcome.feedback).toContain(`index ${targetIndex}`)
    expect(res.nextState.phase).toBe('lost')
    expect(oracle.isWin(res.nextState)).toBe(false)
  })
})

describe('assignValue', () => {
  it('accepts a correct bound without spending a comparison', () => {
    const start = freshState(2468)
    const before = nOf(start, 'comparisons')
    const mid = Math.floor((nOf(start, 'hi') + 0) / 2)
    const res = oracle.applyAction(start, { type: 'assignValue', targetId: 'mid', value: String(mid) })

    expect(res.outcome.correct).toBe(true)
    expect(nOf(res.nextState, 'mid')).toBe(mid)
    expect(nOf(res.nextState, 'comparisons')).toBe(before)
    expect(res.outcome.dsaOp).toBe('assign')
  })

  it('reports a wrong value without corrupting the window', () => {
    const start = freshState(1357)
    const res = oracle.applyAction(start, { type: 'assignValue', targetId: 'lo', value: '4' })

    expect(res.outcome.correct).toBe(false)
    expect(res.outcome.illegal).toBeUndefined()
    expect(res.outcome.expected).toEqual({ type: 'assignValue', targetId: 'lo', value: '0' })
    expect(nOf(res.nextState, 'lo')).toBe(0)
    expect(nOf(res.nextState, 'hi')).toBe(start.instance.values.length - 1)
    expect(res.nextState.phase).toBe('playing')
  })
})

describe('registry', () => {
  it('only exposes oracles for problems that exist in the catalogue', () => {
    for (const id of Object.keys(ORACLES)) {
      expect(PROBLEM_IDS, id).toContain(id)
      expect(getOracle(id)?.problemId).toBe(id)
    }
    expect(getOracle('binary-search')).toBeDefined()
    expect(getOracle('not-a-problem')).toBeUndefined()
  })

  it('requireOracle throws a message that names the registered ids', () => {
    expect(requireOracle('binary-search').problemId).toBe('binary-search')
    expect(() => requireOracle('not-a-problem')).toThrow(/not-a-problem/)
    expect(() => requireOracle('not-a-problem')).toThrow(/binary-search/)
    expect(requireOracle('two-sum').problemId).toBe('two-sum')
  })

  it('has an oracle for every catalogue problem', () => {
    const missing = unimplementedProblemIds()
    expect(missing).toEqual(PROBLEM_IDS.filter((id) => !(id in ORACLES)))
    expect(missing).toEqual([])
    expect(missing).toHaveLength(PROBLEM_IDS.length - Object.keys(ORACLES).length)
  })
})
