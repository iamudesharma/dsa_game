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
