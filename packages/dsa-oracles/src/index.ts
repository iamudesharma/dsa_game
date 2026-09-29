/**
 * `@dsa/dsa-oracles` — the deterministic truth layer.
 *
 * Oracles own instance generation, action validation, expected answers, win
 * conditions and the canonical algorithm visualisation. They are pure and
 * seeded: no LLM, no clock, no I/O.
 */

export {
  ORACLES,
  getOracle,
  requireOracle,
  unimplementedProblemIds,
} from './registry.js'

export { createBinarySearchOracle, annotatedCode } from './problems/binary-search.js'
export { createArrayMaxMinOracle } from './problems/array-max-min.js'
export { createBubbleSortOracle, createSelectionSortOracle, createSortOracle } from './problems/sorts.js'
export {
  createFrequencyCountOracle,
  createKadaneMaxSubarrayOracle,
  createLinkedListCycleOracle,
  createMergeIntervalsOracle,
  createNextGreaterElementOracle,
  createPatternOracle,
  createPrefixSumRangeOracle,
  createRotatedSearchOracle,
  createSlidingWindowMaxSumOracle,
  createTwoPointersPairOracle,
  createValidAnagramOracle,
  createValidPalindromeOracle,
} from './problems/patterns.js'
export {
  createBstSearchOracle,
  createBstValidateOracle,
  createTreeLevelOrderOracle,
  createTreeTraversalsOracle,
  createTreeOracle,
} from './problems/trees.js'
export { createKthLargestHeapOracle } from './problems/heap.js'
export {
  createGraphOracle,
  createMaxAreaIslandOracle,
  createNumIslandsOracle,
  createRottingOrangesOracle,
  createUnionFindConnectOracle,
  createWordSearchOracle,
} from './problems/graphs.js'
export {
  createLinkedListTraversalOracle,
  createMoveZeroesOracle,
  createQueueOperationsOracle,
  createReverseLinkedListOracle,
  createStackPushPopOracle,
  createTwoSumOracle,
  createValidParenthesesOracle,
} from './problems/remaining.js'
