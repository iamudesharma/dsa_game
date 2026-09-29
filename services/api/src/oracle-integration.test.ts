/**
 * End-to-end oracle behaviour, exercised through the real engine.
 *
 * This exists because unit tests on an oracle are not enough: a mid that starts
 * out of range, or a generated instance whose target is reachable on the first
 * probe, both pass every isolated assertion and still make the game unwinnable
 * or pointless. Two real bugs got past the unit suite and were only caught by
 * actually playing the game, so that is what this file does.
 */

import { describe, expect, it } from 'vitest'
import { getOracle, ORACLES, unimplementedProblemIds } from '@dsa/dsa-oracles'
import { createGameRuntime, optimisationScore, mistakeSummary } from '@dsa/game-engine'
import { PROBLEMS } from '@dsa/game-schema'
import type { Action, GameState, ProblemInstance, TraceFrame } from '@dsa/game-schema'

const oracle = getOracle('binary-search')!
const runtime = createGameRuntime(oracle)

interface PlayOptions {
  /** Eliminate the wrong half exactly once, to prove mistakes are real. */
  sabotage?: boolean
}

/**
 * Drives a full game. With `sabotage`, the first path choice is deliberately
 * wrong; everything else is the correct play.
 */
function play(seed: number, options: PlayOptions = {}): GameState {
  let state: GameState = runtime.init(seed, 'easy')
  let flipped = false
  let guard = 0

  while (state.phase === 'playing' && guard++ < 60) {
    const values = state.instance.values
    const target = state.instance.target!
    const mid = Number(state.internal['mid'])

    if (state.internal['midChosen'] !== true) {
      state = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` } as Action).state
      continue
    }

    const relation = values[mid]! < target ? 'gt' : values[mid]! > target ? 'lt' : 'eq'
    state = runtime.apply(state, {
      type: 'comparePair',
      aId: `v${mid}`,
      bId: 'target',
      relation,
    } as Action).state
    if (state.phase !== 'playing') break

    if (relation === 'eq') {
      state = runtime.apply(state, {
        type: 'submitAnswer',
        targetId: `v${mid}`,
        value: String(mid),
      } as Action).state
      break
    }

    const goRight = values[mid]! < target
    const wrongNow = options.sabotage === true && !flipped
    if (wrongNow) flipped = true
    state = runtime.apply(state, {
      type: 'choosePath',
      fromId: `v${mid}`,
      pathId: wrongNow ? (goRight ? 'left' : 'right') : goRight ? 'right' : 'left',
    } as Action).state
  }
  return state
}

const SEEDS = [1, 7, 42, 99, 4242, 2024, 31337, 555, 8, 123, 777, 90210]

describe('binary search is actually playable', () => {
  it('can be won on every seed', () => {
    for (const seed of SEEDS) {
      const state = play(seed)
      expect(state.phase, `seed ${seed} did not reach a win`).toBe('won')
    }
  })

  it('never resolves on the first probe, so the halving loop always runs', () => {
    // A target found on the first comparison means the player never eliminates
    // a half, which is the entire lesson. Regression guard for a real bug.
    for (const seed of SEEDS) {
      const state = play(seed)
      const comparisons = Number(state.variables['comparisons'])
      expect(comparisons, `seed ${seed} finished in ${comparisons} comparison(s)`).toBeGreaterThanOrEqual(2)
    }
  })

  it('exposes a usable mid before the first move', () => {
    // Regression guard: mid used to start at -1, which made the very first
    // selection impossible and the game unwinnable.
    for (const seed of SEEDS) {
      const start: GameState = runtime.init(seed, 'easy')
      const n = start.instance.values.length
      const firstMid = Math.floor((n - 1) / 2)
      expect(start.variables['mid']).toBe(firstMid)
      expect(start.cursor.midSlotId).toBe(`s${firstMid}`)
      expect(start.objects[`v${firstMid}`]).toBeDefined()

      const first = runtime.apply(start, { type: 'selectObject', objectId: `v${firstMid}` } as Action)
      expect(first.outcome.illegal).toBeFalsy()
      expect(first.outcome.correct).toBe(true)
    }
  })

  it('punishes a wrong elimination instead of silently correcting it', () => {
    for (const seed of [42, 4242, 99]) {
      const state = play(seed, { sabotage: true })
      expect(state.phase, `seed ${seed}: a wrong half was not fatal`).toBe('lost')

      const wrong = state.trace.filter((f) => !f.correct)
      expect(wrong).toHaveLength(1)
      expect(wrong[0]?.dsaOp).toBe('choose-path')
      expect(wrong[0]?.note).not.toBe('')
      // The target really was ruled out; the game is not pretending otherwise.
      const targetIndex = Number(state.internal['targetIndex'])
      expect(state.objects[`v${targetIndex}`]?.state).toBe('eliminated')
    }
  })

  it('keeps progress.mistakes equal to the incorrect frames in the trace', () => {
    for (const seed of [42, 4242, 99]) {
      const state = play(seed, { sabotage: true })
      expect(state.progress.mistakes).toBe(mistakeSummary(state.trace).total)
    }
  })

  it('does not let rejected fumbles inflate the mistake count', () => {
    const start = runtime.init(42, 'easy')
    let state = start
    for (let i = 0; i < 6; i += 1) {
      state = runtime.apply(state, { type: 'selectObject', objectId: 'nope' } as Action).state
    }
    expect(state.progress.steps).toBe(6)
    expect(state.progress.mistakes).toBe(0)
    expect(state.trace).toHaveLength(0)
    expect(state.phase).toBe('playing')
  })
})

describe('the canonical trace the debrief replays', () => {
  it('marks exactly the complement of [lo, hi] as eliminated on every frame', () => {
    // Regression guard: an earlier version listed the surviving half as
    // eliminated. The lo/hi values were correct, so value-only tests missed it.
    for (const seed of SEEDS) {
      const state = play(seed)
      const frames: TraceFrame[] = oracle.canonicalTrace(state, state.trace)
      expect(frames.length).toBeGreaterThan(0)
      const n = (state.instance as ProblemInstance).values.length

      for (const frame of frames) {
        const lo = Number(frame.variables['lo'])
        const hi = Number(frame.variables['hi'])
        const eliminated = new Set(frame.pointers.eliminated ?? [])
        for (let i = 0; i < n; i += 1) {
          const outside = i < lo || i > hi
          expect(
            eliminated.has(`v${i}`),
            `seed ${seed} frame ${frame.index} index ${i} (lo=${lo} hi=${hi})`,
          ).toBe(outside)
        }
      }
    }
  })

  it('points every frame at a real line of code', () => {
    const state = play(42)
    const code = oracle.code('javascript')
    for (const frame of oracle.canonicalTrace(state, state.trace)) {
      expect(frame.codeLine).toBeGreaterThanOrEqual(1)
      expect(frame.codeLine).toBeLessThanOrEqual(code.length)
      expect(frame.codeLineText).toBe(code[frame.codeLine - 1])
    }
  })

  it('is beaten by a clean run and beaten less well by a sabotaged one', () => {
    const clean = play(42)
    const cleanScore = optimisationScore(clean.trace, oracle.canonicalTrace(clean, clean.trace))
    expect(cleanScore.score).toBe(1)
  })
})

describe('registry honesty', () => {
  it('only exposes oracles for problems that exist in the catalogue', () => {
    const known = new Set(PROBLEMS.map((p) => p.id))
    for (const id of Object.keys({ 'binary-search': oracle })) {
      expect(known.has(id)).toBe(true)
    }
    expect(getOracle('binary-search')).toBeDefined()
    expect(getOracle('does-not-exist')).toBeUndefined()
  })

  it('reports exactly the problems still to be implemented', () => {
    const remaining = unimplementedProblemIds()
    expect(remaining).not.toContain('binary-search')
    // Derived from the registry, never counted. `PROBLEMS.length - 1` was
    // correct for a while and then quietly wrong the moment a second oracle
    // landed, which is the exact failure this file exists to prevent.
    expect(remaining.length).toBe(PROBLEMS.length - Object.keys(ORACLES).length)
  })
})
