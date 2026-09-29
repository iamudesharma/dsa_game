/**
 * The oracle registry.
 *
 * `ORACLES` is the single place where a problem id maps to its deterministic
 * truth. Everything downstream (engine, decision layer, API) resolves an
 * oracle through `getOracle` / `requireOracle` and never imports a problem
 * module directly, so swapping an implementation is a one-line change here.
 *
 * ---------------------------------------------------------------------------
 * ADDING A PROBLEM
 *
 * 1. Create `src/problems/<id>.ts` exporting
 *    `export function create<PascalCase>Oracle(): Oracle` plus any extra
 *    exports the debrief needs (a rich commented listing, a difficulty
 *    table, ...). The factory must return a *fresh* object each call: the
 *    engine is free to hold the oracle across sessions, and the instance
 *    seed is the only source of randomness.
 * 2. Import the factory here and add `'<id>': create<PascalCase>Oracle(),` to
 *    `ORACLES`. The key MUST equal the id in `PROBLEMS` — `getOracle` refuses
 *    any key that is not in the catalogue, so a typo fails loudly at build
 *    time of the record rather than silently at runtime.
 * 3. `index.ts` re-exports the factory so consumers can import it directly.
 * 4. Add `src/problems/<id>.test.ts` covering, at minimum: instance validity
 *    against that problem's `instanceHints`, canonical-trace correctness, the
 *    lo/hi invariant, one full winning action sequence, one wrong-but-legal
 *    sequence, and illegal actions not throwing.
 *
 * The catalogue currently has an oracle for every id. Keep the registry and
 * catalogue honest by checking `unimplementedProblemIds()` when adding games.
 */

import { PROBLEM_IDS } from '@dsa/game-schema'
import type { Oracle } from '@dsa/game-schema'
import { createArrayMaxMinOracle } from './problems/array-max-min.js'
import { createBinarySearchOracle } from './problems/binary-search.js'
import { createSortOracle } from './problems/sorts.js'
import {
  createLinkedListTraversalOracle,
  createMoveZeroesOracle,
  createQueueOperationsOracle,
  createReverseLinkedListOracle,
  createStackPushPopOracle,
  createTwoSumOracle,
  createValidParenthesesOracle,
} from './problems/remaining.js'

/**
 * Implemented oracle factories, keyed by problem id. Built once at module
 * load: oracles are stateless pure functions of the instance, so a shared
 * instance is safe and saves a rebuild per request.
 */
export const ORACLES: Readonly<Record<string, Oracle>> = {
  'array-max-min': createArrayMaxMinOracle(),
  'binary-search': createBinarySearchOracle(),
  'bubble-sort': createSortOracle('bubble-sort'),
  'selection-sort': createSortOracle('selection-sort'),
  'two-sum': createTwoSumOracle(),
  'move-zeroes': createMoveZeroesOracle(),
  'valid-parentheses': createValidParenthesesOracle(),
  'stack-push-pop': createStackPushPopOracle(),
  'queue-operations': createQueueOperationsOracle(),
  'linked-list-traversal': createLinkedListTraversalOracle(),
  'reverse-linked-list': createReverseLinkedListOracle(),
}

const IMPLEMENTED_IDS: ReadonlySet<string> = new Set(Object.keys(ORACLES))

/**
 * The ids in the catalogue with no oracle yet. Exposed so the API can answer
 * "which problems are playable" without duplicating the subtraction.
 */
export function unimplementedProblemIds(): string[] {
  return PROBLEM_IDS.filter((id) => !IMPLEMENTED_IDS.has(id))
}

/**
 * Resolve an oracle, or `undefined` for an unknown problem id.
 *
 * The `PROBLEM_IDS` membership test is what stops the registry from drifting
 * away from the catalogue: an oracle keyed to a problem that does not exist
 * is not reachable, and a catalogue problem without an oracle is reported by
 * `unimplementedProblemIds` instead of blowing up mid-session.
 */
export function getOracle(problemId: string): Oracle | undefined {
  if (!PROBLEM_IDS.includes(problemId)) return undefined
  return ORACLES[problemId]
}

/** Same as `getOracle`, for call sites where a missing oracle is a bug. */
export function requireOracle(problemId: string): Oracle {
  const oracle = getOracle(problemId)
  if (oracle) return oracle
  const known = Object.keys(ORACLES).join(', ') || '(none)'
  const playable = PROBLEM_IDS.filter((id) => IMPLEMENTED_IDS.has(id)).join(', ') || '(none)'
  throw new Error(
    `@dsa/dsa-oracles: no oracle for problem "${problemId}". ` +
      `Registered oracles: ${known}. Registered and in PROBLEMS: ${playable}.`,
  )
}
