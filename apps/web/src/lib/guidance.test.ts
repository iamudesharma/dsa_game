import { describe, expect, it } from 'vitest'
import { getOracle } from '@dsa/dsa-oracles'
import { createGameRuntime } from '@dsa/game-engine'
import { deriveBranchChoices, deriveRangeWindow, deriveWorkCountdown } from './guidance'

describe('rotated search numeric window', () => {
  const runtime = createGameRuntime(getOracle('rotated-search')!)
  it('renders branches and object IDs when the oracle uses variables instead of cursor slots', () => {
    const state = runtime.init(31337, 'hard')
    const mid = state.variables.mid as number
    const branches = deriveBranchChoices(state)!
    expect(branches.fromId).toBe(`v${mid}`)
    expect(branches.left.to).toBe(mid - 1)
    expect(branches.right.from).toBe(mid + 1)
    expect(deriveRangeWindow(state).has).toBe(true)
  })
  it('counts the remaining range without treating Big O as a maximum number of player moves', () => {
    const state = runtime.init(31337, 'hard')
    state.variables.lo = 3
    state.variables.hi = 4
    const work = deriveWorkCountdown(state, null)
    expect(work.live).toBe(2)
    expect(work.worstCase).toBeNull()
    expect(work.unit).toBe('moves')
  })
})
