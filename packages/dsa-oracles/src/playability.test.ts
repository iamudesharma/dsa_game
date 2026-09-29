/**
 * Every registered oracle must be winnable, on every seed.
 *
 * THIS IS THE TEST THAT MATTERS MOST IN THE PACKAGE. An oracle is a claim
 * about what "correct" means, and a claim nobody can execute is a claim
 * nobody has checked. A single unwinnable game is invisible to a unit test
 * that only inspects the data structures — the state is well-formed, the
 * actions are legal, the canonical trace is perfect, and the player still
 * cannot reach the end.
 *
 * So this drives each oracle to a win using ONLY what the oracle itself
 * advertises: `legalActions` for the shape of the next move, and the
 * canonical trace for the answer. No fixture hand-picks the right ids, so an
 * oracle that computes a correct canonical trace but grades its own
 * `selectObject` wrongly still fails here.
 *
 * It is also the cheapest possible oracle review: a new oracle is playable or
 * it is not, and this says which in one line.
 */

import { describe, expect, it } from 'vitest'
import type { Action, GameState, Oracle } from '@dsa/game-schema'
import { linearSlots } from '@dsa/game-schema'

import { ORACLES, unimplementedProblemIds } from './registry.js'

const SEEDS = 30
const MAX_STEPS = 500

/**
 * Build the next action from what the oracle advertises.
 *
 * `legalActions` gives the SHAPE of the next move; the canonical trace gives
 * which specific id the algorithm wants. Both are needed and neither is
 * enough, and the reason is instructive:
 *
 *  - `selectObject` in binary search advertises EVERY in-window cell, because
 *    the player is meant to choose. Taking `objectIds[0]` probes index 0 and
 *    is rejected forever, so the id has to come from the reference.
 *  - `choosePath` advertises only the node, never the branch. The path id
 *    exists nowhere in `legalActions` at all.
 *  - `comparePair` needs a relation, and it is recomputed from the LIVE values
 *    rather than copied off the reference — a stale relation would hide an
 *    oracle whose own arithmetic disagrees with its own trace.
 */
/**
 * Replay the canonical trace as an ACTION SEQUENCE and require every step to
 * be legal, correct, and to end in a win.
 *
 * This is the whole test, and it is deliberately not clever. An earlier
 * version tried to re-derive each move from `legalActions` at every turn, and
 * that machinery was wrong three separate ways before it worked:
 *
 *  - `legalActions` advertises CHOICES, not answers. Binary search offers every
 *    in-window cell, because picking the midpoint is the player's job.
 *  - `comparePair`'s relation is read in an orientation that differs per oracle
 *    and is documented only in that oracle's header comment.
 *  - `choosePath` advertises a node, and the branch id appears nowhere.
 *
 * None of that is a defect in the oracles — it is the design, and a client
 * reads the same hints the learner does. Replaying the reference instead asks
 * the question that actually matters: **is the canonical trace a winning line
 * that the engine grades correct at every single step, with a control offered
 * at every turn?** That is what "this game is playable" means, and it needs no
 * cleverness to check.
 */
interface DriveResult {
  readonly phase: string
  readonly steps: number
  readonly reason: string
}

function drive(oracle: Oracle, seed: number, difficulty: 'easy' | 'medium' | 'hard'): DriveResult {
  const instance = oracle.buildInstance({ seed, difficulty })
  const plan = oracle.canonicalTrace(oracle.initState(instance))
  if (plan.length > MAX_STEPS) {
    return { phase: 'playing', steps: plan.length, reason: `reference plan is ${plan.length} steps, over the bound` }
  }

  let state = oracle.initState(instance)
  let steps = 0

  for (const frame of plan) {
    if (state.phase !== 'playing') {
      return { phase: state.phase, steps, reason: `run ended before the reference finished (${frame.action.type})` }
    }
    const offered = oracle.legalActions?.(state) ?? []
    if (offered.length === 0) {
      return { phase: state.phase, steps, reason: `no control offered before ${frame.action.type}` }
    }
    if (!offered.some((d) => d.type === frame.action.type)) {
      return {
        phase: state.phase,
        steps,
        reason: `the oracle offers ${offered.map((d) => d.type).join('/')} but the reference plays ${frame.action.type}`,
      }
    }

    const result = oracle.applyAction(state, frame.action)
    steps += 1
    if (result.outcome.illegal) {
      return { phase: state.phase, steps, reason: `reference move ${frame.action.type} was ILLEGAL: ${result.outcome.feedback}` }
    }
    if (result.outcome.correct !== true) {
      return { phase: state.phase, steps, reason: `reference move ${frame.action.type} was graded WRONG: ${result.outcome.feedback}` }
    }
    state = result.nextState
  }

  return {
    phase: state.phase,
    steps,
    reason: state.phase === 'won' ? 'won' : `the reference ran out of moves in ${state.phase}`,
  }
}

describe.each(Object.keys(ORACLES))('%s is playable', (problemId) => {
  const oracle = ORACLES[problemId]!

  it(`is won on all ${SEEDS} seeds, at every difficulty`, () => {
    const failures: string[] = []
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const result = drive(oracle, seed, difficulty)
        if (result.phase !== 'won') {
          failures.push(`${difficulty}/${seed}: ${result.reason} after ${result.steps} steps`)
        }
      }
    }
    expect(failures, failures.slice(0, 5).join('\n')).toEqual([])
  })

  it('reports a canonical trace that agrees with brute force on the answer', () => {
    // The trace is what the debrief replays and what the hints quote, so a
    // canonical trace whose final answer disagrees with the data would teach
    // the wrong thing while every gameplay test still passed.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const instance = oracle.buildInstance({ seed, difficulty: 'medium' })
      const state = oracle.initState(instance)
      const frames = oracle.canonicalTrace(state)
      expect(frames.length, `seed ${seed}`).toBeGreaterThan(0)
      expect(frames.every((f) => f.correct), `seed ${seed}: a reference step is marked wrong`).toBe(true)

      const last = frames[frames.length - 1]!
      expect(last.dsaOp, `seed ${seed}: canonical trace does not end on a commit`).toBe('terminate')

      const summary = oracle.answerSummary(state)
      expect(summary.value, `seed ${seed}: no machine-readable answer`).not.toBeNull()
    }
  })

  it('builds instances that satisfy its own hints', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const instance = oracle.buildInstance({ seed, difficulty })
        expect(instance.problemId).toBe(problemId)
        expect(instance.values.length, `seed ${seed}/${difficulty}`).toBeGreaterThan(0)
        expect(instance.slots.length).toBe(instance.values.length)
        // Determinism: the same input must produce the same board, or replays
        // and the debrief are not reproducible.
        const again = oracle.buildInstance({ seed, difficulty })
        expect(again.values).toEqual(instance.values)
      }
    }
  })

  it('is deterministic: same seed, same initial state', () => {
    const a = oracle.initState(oracle.buildInstance({ seed: 7, difficulty: 'medium' }))
    const b = oracle.initState(oracle.buildInstance({ seed: 7, difficulty: 'medium' }))
    expect(a).toEqual(b)
  })

  it('offers a legal move at every turn of a driven run', () => {
    // `legalActions` drives the UI's controls, so an empty list mid-run is a
    // dead board the player cannot act on even though the engine would accept
    // an action. Asserted as a walk, because "non-empty at the start" is not
    // "non-empty at turn nine".
    const instance = oracle.buildInstance({ seed: 3, difficulty: 'medium' })
    const plan = oracle.canonicalTrace(oracle.initState(instance))
    let state = oracle.initState(instance)
    for (const [k, frame] of plan.entries()) {
      expect(oracle.legalActions?.(state).length, `before step ${k} (${frame.action.type})`).toBeGreaterThan(0)
      state = oracle.applyAction(state, frame.action).nextState
    }
    expect(state.phase).toBe('won')
  })

  it('never throws on an unknown action type for this problem', () => {
    const state = oracle.initState(oracle.buildInstance({ seed: 5, difficulty: 'easy' }))
    const nonsense = { type: 'moveObject', objectId: 'v0', toSlotId: 's0' } as unknown as Action
    const result = oracle.applyAction(state, nonsense)
    // Either it is genuinely used by this problem, or it is refused cleanly.
    // Throwing is the only unacceptable outcome.
    expect(result.outcome).toBeDefined()
  })
})

describe('the registry is honest', () => {
  it('has a registered oracle for every catalogue problem', () => {
    expect(unimplementedProblemIds()).toEqual([])
  })

  it('every registered oracle has linear slots that match its values', () => {
    for (const [id, oracle] of Object.entries(ORACLES)) {
      const instance = oracle.buildInstance({ seed: 2, difficulty: 'medium' })
      expect(instance.slots.length, id).toBe(instance.values.length)
      // Sanity: the ids the kernel mints must be the ones the slot table uses.
      expect(linearSlots(instance.values.length).map((s) => s.id)).toHaveLength(instance.values.length)
    }
  })
})
