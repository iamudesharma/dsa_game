/**
 * The action union. Every player interaction in every game is exactly one of
 * these shapes. Mechanics describe *how* they look; actions describe *what*
 * happened, and are what the oracle validates.
 */

import type { MechanicId, DsaOp } from './mechanics.js'

export type Relation = 'lt' | 'eq' | 'gt'
export type StackOp = 'push' | 'pop'
export type LinkKind = 'next' | 'prev'

interface ActionBase {
  /** Optional client-generated id to make replays idempotent. */
  actionId?: string
}

export interface SelectObjectAction extends ActionBase {
  type: 'selectObject'
  objectId: string
}

export interface MoveObjectAction extends ActionBase {
  type: 'moveObject'
  objectId: string
  toSlotId: string
}

export interface ComparePairAction extends ActionBase {
  type: 'comparePair'
  aId: string
  bId: string
  relation: Relation
}

export interface SwapPairAction extends ActionBase {
  type: 'swapPair'
  aId: string
  bId: string
}

export interface PushPopAction extends ActionBase {
  type: 'pushPop'
  containerId: string
  op: StackOp
  /** Required for push. */
  objectId?: string
}

export interface ChoosePathAction extends ActionBase {
  type: 'choosePath'
  fromId: string
  pathId: string
}

export interface TraverseNodeAction extends ActionBase {
  type: 'traverseNode'
  fromNodeId: string
  toNodeId: string
}

export interface ConnectNodesAction extends ActionBase {
  type: 'connectNodes'
  fromNodeId: string
  toNodeId: string
  linkKind: LinkKind
}

export interface AssignValueAction extends ActionBase {
  type: 'assignValue'
  targetId: string
  value: string
}

export interface SubmitAnswerAction extends ActionBase {
  type: 'submitAnswer'
  targetId: string
  value: string
}

export type Action =
  | SelectObjectAction
  | MoveObjectAction
  | ComparePairAction
  | SwapPairAction
  | PushPopAction
  | ChoosePathAction
  | TraverseNodeAction
  | ConnectNodesAction
  | AssignValueAction
  | SubmitAnswerAction

export type ActionType = Action['type']

export const ACTION_TYPES = [
  'selectObject',
  'moveObject',
  'comparePair',
  'swapPair',
  'pushPop',
  'choosePath',
  'traverseNode',
  'connectNodes',
  'assignValue',
  'submitAnswer',
] as const

/** Which mechanic each action type belongs to. 1:1 by design. */
export const ACTION_TO_MECHANIC: Readonly<Record<ActionType, MechanicId>> = {
  selectObject: 'selectObject',
  moveObject: 'moveObject',
  comparePair: 'comparePair',
  swapPair: 'swapPair',
  pushPop: 'pushPop',
  choosePath: 'choosePath',
  traverseNode: 'traverseNode',
  connectNodes: 'connectNodes',
  assignValue: 'assignValue',
  submitAnswer: 'submitAnswer',
}

/** Default DSA op for each action type. */
export const ACTION_TO_DSA_OP: Readonly<Record<ActionType, DsaOp>> = {
  selectObject: 'read',
  moveObject: 'move',
  comparePair: 'compare',
  swapPair: 'swap',
  pushPop: 'push',
  choosePath: 'choose-path',
  traverseNode: 'traverse',
  connectNodes: 'link',
  assignValue: 'assign',
  submitAnswer: 'terminate',
}

export function isActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && (ACTION_TYPES as readonly string[]).includes(value)
}

export function mechanicForAction(action: Action): MechanicId {
  return ACTION_TO_MECHANIC[action.type]
}

export function dsaOpForAction(action: Action): DsaOp {
  return ACTION_TO_DSA_OP[action.type]
}
