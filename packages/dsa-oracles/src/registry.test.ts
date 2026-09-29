/**
 * The catalogue must not promise what the app cannot deliver.
 *
 * `POST /api/generate` called `requireOracle`, which THROWS when a problem has
 * no oracle. The call sat outside every `try` in the handler, so the throw
 * escaped to Hono's `onError` and came back as:
 *
 *   500 INTERNAL  "no oracle for problem \"bubble-sort\". Registered oracles:
 *                  binary-search. Registered and in PROBLEMS: binary-search."
 *
 * The client mapped `status >= 500` to `retryable: true`, so the screen offered
 * a "Try again" button on a URL that could never succeed — for ten of the
 * eleven problems the catalogue advertised.
 *
 * "Not built yet" is a fact about the app, not a fault in the request, so it is
 * a 4xx with its own code and it is never retryable. And the catalogue says so
 * up front, via `playable`, instead of letting a learner find out by clicking.
 */

import { describe, expect, it } from 'vitest'
import { API_ERRORS, PROBLEMS } from '@dsa/game-schema'

import { ORACLES, unimplementedProblemIds } from '@dsa/dsa-oracles'

describe('the registry and the catalogue agree', () => {
  it('every registered oracle is a real catalogue problem', () => {
    const ids = new Set(PROBLEMS.map((p) => p.id))
    for (const id of Object.keys(ORACLES)) {
      expect(ids.has(id), `${id} is registered but not in PROBLEMS`).toBe(true)
    }
  })

  it('the unimplemented list is exactly the catalogue minus the oracles', () => {
    const registered = new Set(Object.keys(ORACLES))
    const expected = PROBLEMS.map((p) => p.id).filter((id) => !registered.has(id))
    expect(unimplementedProblemIds().sort()).toEqual(expected.sort())
  })

  it('is honest about how much of the catalogue is playable', () => {
    // If this number changes, the README and the home page copy change with it.
    // It is written as a comparison rather than a literal so that adding the
    // tenth oracle updates the expectation deliberately instead of silently.
    const playable = PROBLEMS.length - unimplementedProblemIds().length
    expect(playable).toBe(Object.keys(ORACLES).length)
    expect(playable).toBeLessThanOrEqual(PROBLEMS.length)
  })
})

describe('the all-playable catalogue', () => {
  /**
   * The set of problems that cannot be played. Any problem in here must produce
   * `PROBLEM_NOT_PLAYABLE` and NOT `INTERNAL`; the test that enforces the
   * status lives against the live app (see the e2e script), and this asserts
   * the classification inputs it depends on.
   */
  const unplayable = unimplementedProblemIds()

  it('has an oracle for every listed problem', () => {
    expect(unplayable).toEqual([])
  })

  it('has a distinct error code rather than being an internal fault', () => {
    // A 500 with a retry button is what a learner saw. The code has to be its
    // own so the client can decide not to offer a retry.
    expect(API_ERRORS.problemNotPlayable).toBe('PROBLEM_NOT_PLAYABLE')
    expect(API_ERRORS.problemNotPlayable).not.toBe(API_ERRORS.internal)
    expect(API_ERRORS.problemNotPlayable).not.toBe(API_ERRORS.unknownProblem)
  })
})
