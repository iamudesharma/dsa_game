/**
 * A trace frame records what one player action actually did to the algorithm.
 *
 * The post-game screen replays these frames side-by-side with the real
 * algorithm visualisation and the source code, so each frame must be able to
 * point at a code line and a set of algorithm variables.
 */

import type { Action } from './action.js'
import type { DsaOp } from './mechanics.js'
import type { Variables } from './state.js'

export interface TraceFrame {
  /** Monotonic index within the game. */
  index: number
  /** The action the player performed. */
  action: Action
  /** 1-based index into the oracle's `code(lang)` output. */
  codeLine: number
  /** The literal source line at `codeLine`, for cheap rendering. */
  codeLineText: string
  /** Algorithm variables after this step (lo, mid, hi, i, j, max, ...). */
  variables: Variables
  /** Which objects/slots the algorithm is pointing at right now. */
  pointers: {
    current?: string
    compare?: string[]
    eliminated?: string[]
    swapped?: string[]
    read?: string[]
  }
  dsaOp: DsaOp
  correct: boolean
  /** Engine-authored note (short). Narration prose comes from the spec. */
  note: string
}

export interface Complexity {
  time: string
  space: string
  best?: string
  worst?: string
  average?: string
  note?: string
}
