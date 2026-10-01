/**
 * One place the UI gets contract constants and presentation labels.
 *
 * The contract-owned values below are NOT mirrored — they are re-exported
 * straight from `@dsa/game-schema`, so they cannot drift. Only the label maps
 * at the bottom are genuinely local, because the wire format does not prescribe
 * how the UI should word a provider tier or a game phase.
 *
 * If you find yourself adding a mechanic id, a topic label, a difficulty or an
 * error code here, do not — add it to `packages/game-schema` instead and import
 * it from there. The whole point of a shared contract package is that there is
 * one answer to "what are the valid mechanics", not two.
 */

import {
  ACTION_TO_MECHANIC,
  API_ERRORS,
  DIFFICULTIES,
  MECHANIC_IDS,
  TOPIC_LABELS,
  isMechanicId,
  mechanicForAction,
} from '@dsa/game-schema'
import type { ActionType, DsaTopic, GamePhase } from '@dsa/game-schema'

// --- re-exported verbatim from the contract -------------------------------
export {
  ACTION_TO_MECHANIC,
  API_ERRORS,
  DIFFICULTIES,
  MECHANIC_IDS,
  TOPIC_LABELS,
  isMechanicId,
  mechanicForAction,
}

// The UI addresses error codes by their wire string, which is the uppercase
// form. Derive that map from the contract's own values rather than retyping the
// strings, so adding a code in game-schema shows up here automatically.
export const API_ERROR_CODES = {
  BAD_REQUEST: API_ERRORS.badRequest,
  UNKNOWN_PROBLEM: API_ERRORS.unknownProblem,
  UNKNOWN_GAME: API_ERRORS.unknownGame,
  GENERATION_FAILED: API_ERRORS.generationFailed,
  UNAUTHORIZED: API_ERRORS.unauthorized,
  EMAIL_TAKEN: API_ERRORS.emailTaken,
  INVALID_CREDENTIALS: API_ERRORS.invalidCredentials,
  RATE_LIMITED: API_ERRORS.rateLimited,
  INTERNAL: API_ERRORS.internal,
} as const

/** Fallback only: the catalogue's own `TopicDto.label` wins when present. */
export function topicLabel(id: string, fallback?: string): string {
  if (fallback) return fallback
  const known = TOPIC_LABELS[id as DsaTopic]
  return known ?? id.replace(/-/g, ' ')
}

// --- presentation only ----------------------------------------------------

/**
 * Keyed by string, not by `ProviderTier`, on purpose.
 *
 * `ProviderTier` is a wire enum the API team adds to as new providers land, and
 * an exhaustive `Record<ProviderTier, string>` turns every addition into a
 * compile error in a file that has nothing to do with providers. The UI only
 * ever needs a human word, so a missing tier should degrade to printing its own
 * id. `providerTierLabel` is the accessor; this map stays exported for the
 * existing call sites.
 */
const TIER_LABELS: Readonly<Record<string, string>> = {
  'opencode-go': 'opencode go',
  opencode: 'opencode',
  openrouter: 'OpenRouter',
  'local-llm': 'local model',
  template: 'built-in template',
}

export const PROVIDER_TIER_LABELS: Readonly<Record<string, string>> = TIER_LABELS

export function providerTierLabel(tier: string | null | undefined): string {
  if (!tier) return '—'
  return TIER_LABELS[tier] ?? tier
}

export const GAME_PHASE_LABELS: Readonly<Record<GamePhase, string>> = {
  playing: 'Playing',
  won: 'Solved',
  lost: 'Ran out of patience',
}

export const DSA_OP_LABELS: Readonly<Record<string, string>> = {
  compare: 'compare',
  traverse: 'traverse',
  move: 'move',
  insert: 'insert',
  swap: 'swap',
  push: 'push',
  pop: 'pop',
  'choose-path': 'branch',
  read: 'read',
  assign: 'assign',
  terminate: 'finish',
  link: 'link',
  unlink: 'unlink',
}

export function dsaOpLabel(op: string): string {
  return DSA_OP_LABELS[op] ?? op
}

export const ACTION_TYPE_LABELS: Readonly<Record<ActionType, string>> = {
  selectObject: 'read an element',
  moveObject: 'move an element',
  comparePair: 'compare two elements',
  swapPair: 'swap two elements',
  pushPop: 'push / pop',
  choosePath: 'choose a branch',
  traverseNode: 'follow a link',
  connectNodes: 'wire a link',
  assignValue: 'assign a value',
  submitAnswer: 'commit the answer',
}
