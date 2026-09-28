/**
 * The fixed mechanic catalog.
 *
 * The LLM never invents a mechanic. It only *composes* the ones declared here
 * and chooses which ones to enable. Everything not in this file is illegal.
 */

export const MECHANIC_IDS = [
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

export type MechanicId = (typeof MECHANIC_IDS)[number]

/** The real DSA operation a mechanic action represents. */
export const DSA_OPS = [
  'compare',
  'traverse',
  'move',
  'insert',
  'swap',
  'push',
  'pop',
  'choose-path',
  'read',
  'assign',
  'terminate',
  'link',
  'unlink',
] as const

export type DsaOp = (typeof DSA_OPS)[number]

export interface MechanicDef {
  readonly id: MechanicId
  /** Default DSA op this mechanic represents. */
  readonly op: DsaOp
  /** One-line description used in prompts and docs. */
  readonly description: string
  /** True when the mechanic needs two objects selected. */
  readonly twoParty: boolean
  /** Object kinds this mechanic can legally reference. */
  readonly objectKinds: readonly GameObjectKind[]
  /** Container kinds this mechanic needs, if any. */
  readonly containerKinds: readonly ContainerKind[]
}

export type GameObjectKind =
  | 'item'
  | 'number'
  | 'node'
  | 'token'
  | 'door'
  | 'room'
  | 'slot'
  | 'path'
  | 'target'

export type ContainerKind = 'stack' | 'queue' | 'array' | 'graph'

export const MECHANICS: Readonly<Record<MechanicId, MechanicDef>> = {
  selectObject: {
    id: 'selectObject',
    op: 'read',
    description: 'Click/tap a single object to read it, pick it as the current item, or make it the mid/target.',
    twoParty: false,
    objectKinds: ['item', 'number', 'node', 'door', 'room', 'target'],
    containerKinds: [],
  },
  moveObject: {
    id: 'moveObject',
    op: 'move',
    description: 'Drag an object onto a slot or position to relocate it without destroying order guarantees.',
    twoParty: false,
    objectKinds: ['item', 'number', 'token'],
    containerKinds: [],
  },
  comparePair: {
    id: 'comparePair',
    op: 'compare',
    description: 'Select two objects and declare lt / eq / gt between their values.',
    twoParty: true,
    objectKinds: ['item', 'number', 'node', 'token', 'room'],
    containerKinds: [],
  },
  swapPair: {
    id: 'swapPair',
    op: 'swap',
    description: 'Exchange the positions of two objects.',
    twoParty: true,
    objectKinds: ['item', 'number', 'token', 'node'],
    containerKinds: [],
  },
  pushPop: {
    id: 'pushPop',
    op: 'push',
    description: 'Push an object into or pop an object from a stack/queue container.',
    twoParty: false,
    objectKinds: ['item', 'number', 'node', 'token'],
    containerKinds: ['stack', 'queue'],
  },
  choosePath: {
    id: 'choosePath',
    op: 'choose-path',
    description: 'Pick one branch (e.g. left / right) to narrow the remaining search space.',
    twoParty: false,
    objectKinds: ['path', 'room', 'door', 'item'],
    containerKinds: [],
  },
  traverseNode: {
    id: 'traverseNode',
    op: 'traverse',
    description: 'Advance a cursor from one node to the next linked node.',
    twoParty: false,
    objectKinds: ['node'],
    containerKinds: [],
  },
  connectNodes: {
    id: 'connectNodes',
    op: 'link',
    description: 'Draw or rewire a next/prev pointer between two nodes.',
    twoParty: false,
    objectKinds: ['node'],
    containerKinds: [],
  },
  assignValue: {
    id: 'assignValue',
    op: 'assign',
    description: 'Set a value into a slot, container or variable (e.g. running max, complement, sum).',
    twoParty: false,
    objectKinds: ['item', 'number', 'node', 'token'],
    containerKinds: ['array'],
  },
  submitAnswer: {
    id: 'submitAnswer',
    op: 'terminate',
    description: 'Commit the final answer: declare the result index, value, or outcome.',
    twoParty: false,
    objectKinds: ['item', 'number', 'node', 'room', 'target'],
    containerKinds: [],
  },
} as const

export function isMechanicId(value: unknown): value is MechanicId {
  return typeof value === 'string' && (MECHANIC_IDS as readonly string[]).includes(value)
}

export function isDsaOp(value: unknown): value is DsaOp {
  return typeof value === 'string' && (DSA_OPS as readonly string[]).includes(value)
}

/** Human-readable list used inside LLM prompts. */
export function mechanicsCatalogForPrompt(): string {
  return MECHANIC_IDS.map((id) => `- ${id} (default dsaOp=${MECHANICS[id].op}): ${MECHANICS[id].description}`).join(
    '\n',
  )
}
