import type { GameObject, ObjectState } from '@dsa/game-schema'
/** A held comparison operand remains usable; a fixed target is a reference, not a locked action. */
export function displayTokenState(object: GameObject, held: boolean): ObjectState {
  if (held && object.state === 'eliminated') return 'selected'
  if (object.kind === 'target' && object.state === 'locked') return 'idle'
  return object.state
}
export function tokenIsInert(state: ObjectState, problemId: string): boolean {
  return state === 'locked' || (state === 'eliminated' && problemId === 'binary-search')
}
