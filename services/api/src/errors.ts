/**
 * Central error codes. These are the strings clients may branch on; messages
 * are for humans and may change.
 */

export const ACTION_ERRORS = {
  unknownObject: 'UNKNOWN_OBJECT',
  unknownSlot: 'UNKNOWN_SLOT',
  unknownContainer: 'UNKNOWN_CONTAINER',
  wrongPhase: 'WRONG_PHASE',
  needsTwoObjects: 'NEEDS_TWO_OBJECTS',
  needsComparisonFirst: 'NEEDS_COMPARISON_FIRST',
  underflow: 'UNDERFLOW',
} as const

export type ActionErrorCode = (typeof ACTION_ERRORS)[keyof typeof ACTION_ERRORS]
