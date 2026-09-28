/**
 * Runtime game state + problem instance shapes.
 *
 * The state is a plain serialisable object so it can be:
 *  - diffed / snapshotted for undo,
 *  - sent verbatim to the web or Flutter client,
 *  - replayed deterministically in tests.
 */

import type { GameObjectKind, ContainerKind } from './mechanics.js'
import type { Action } from './action.js'
import type { DsaOp } from './mechanics.js'
import type { TraceFrame } from './trace.js'

export type ObjectVisual =
  | { kind: 'shape'; shape: 'circle' | 'square' | 'hex' | 'star' }
  | { kind: 'emoji'; glyph: string }
  | { kind: 'text'; text: string }
  | { kind: 'bar'; height: number }

export type ObjectState =
  | 'idle'
  | 'selected'
  | 'eliminated'
  | 'matched'
  | 'swapped'
  | 'locked'
  | 'current'
  | 'visited'
  | 'revealed'

export interface GameObject {
  id: string
  kind: GameObjectKind
  /** What the player reads. */
  label: string
  /** Numeric value used by comparisons. May equal label when numeric. */
  value?: number
  /** For ordered containers: current slot id. */
  slotId?: string
  /** x position hint, normalised 0..1. Optional. */
  x?: number
  y?: number
  visual?: ObjectVisual
  state: ObjectState
  /** Arbitrary per-problem tags (e.g. `partOf: "left-half"`). */
  tags?: Record<string, string | number | boolean>
}

export type SlotKind = 'default' | 'target' | 'left' | 'right' | 'mid' | 'sink' | 'source'

export interface Slot {
  id: string
  index: number
  kind: SlotKind
  occupantId?: string
  label?: string
  state?: ObjectState
  /** Set for slots that represent a path/branch choice. */
  meta?: Record<string, string | number | boolean>
}

export interface Container {
  id: string
  kind: ContainerKind
  /** Ordered object ids. Bottom/head first. */
  order: string[]
  capacity?: number
  label?: string
}

export interface Link {
  from: string
  to: string
  kind: 'next' | 'prev'
}

/** The randomized data a problem is played on. */
export interface ProblemInstance {
  problemId: string
  seed: number
  /** The primary data array. */
  values: number[]
  /** Lookup target (two-sum, binary search). */
  target?: number
  /** Preset pairs, e.g. for a parentheses sequence. */
  tokens?: string[]
  /** Linked-list payload, when the problem is a list problem. */
  list?: LinkedNodeSpec[]
  /** Initial linear layout; the oracle decides ids. */
  slots: Slot[]
  /** Per-problem extras (initial container contents, allowed ops, ...). */
  extras?: Record<string, unknown>
}

export interface LinkedNodeSpec {
  id: string
  value: number
  nextId?: string
  prevId?: string
}

export type GamePhase = 'playing' | 'won' | 'lost'

export interface Cursor {
  /** Linked-list cursor. */
  nodeId?: string
  prevNodeId?: string
  /** Binary search window bounds, expressed as slot ids. */
  loSlotId?: string
  midSlotId?: string
  hiSlotId?: string
  /** Sort / scan pointers, expressed as slot ids or object ids. */
  iSlotId?: string
  jSlotId?: string
  /** Current max / best candidate. */
  bestObjectId?: string
}

export interface Variables {
  [name: string]: number | string | boolean | null
}

export interface Progress {
  steps: number
  mistakes: number
  hintsUsed: number
  /** Per-mechanic mistake tallies, used for misconception tagging. */
  mistakesByMechanic: Record<string, number>
}

export interface GameState {
  problemId: string
  seed: number
  instance: ProblemInstance
  objects: Record<string, GameObject>
  slots: Record<string, Slot>
  containers: Record<string, Container>
  links: Link[]
  /** Currently selected object ids (1 for most mechanics, 2 for compare/swap). */
  selection: string[]
  cursor: Cursor
  variables: Variables
  progress: Progress
  phase: GamePhase
  /** Appended by the engine on every validated action. */
  trace: TraceFrame[]
  /**
   * Oracle-owned opaque bookkeeping (e.g. number of completed passes for
   * bubble sort, elapsed comparisons for binary search). The LLM never
   * reads or writes this.
   */
  internal: Record<string, number | string | boolean | null>
}

export interface ActionOutcome {
  correct: boolean
  /** Present when the player's action was wrong. */
  expected?: Partial<Action>
  /** Short, in-theme, in-character feedback. */
  feedback: string
  dsaOp: DsaOp
  /** Index into state.trace of the frame this action produced. */
  traceStep: number
  /** True when the action was not allowed at all in the current state. */
  illegal?: boolean
  /** Set when the action ended the game. */
  won?: boolean
}

export function emptyProgress(): Progress {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} }
}
