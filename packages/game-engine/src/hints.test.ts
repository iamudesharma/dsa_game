/**
 * Hint ladder tests.
 *
 * The ladder has to survive every degraded configuration, because a hint is
 * the difference between "I am stuck" and "this game is broken": no LLM tier,
 * no Laya, no oracle affordances, no variables, no cursor.
 */

import { describe, expect, it } from 'vitest'
import { cloneState } from '@dsa/game-schema'
import type { GameSpec, GameState, Oracle } from '@dsa/game-schema'

import { createGameRuntime } from './runtime.js'
import { FALLBACK_HINT, describeStateFacts, incrementHintsUsed, nextHint, pointerLine, variableLine } from './hints.js'
import { bestIdOf, makeFakeOracle, playOptimalGame, relationBetween } from './testing/fake-oracle.js'

const SEED = 7

/** A structurally complete spec; only `narration.hintPool` matters to the engine. */
function makeSpec(hintPool: string[]): GameSpec {
  return {
    specVersion: 1,
    problemId: 'array-max-min',
    seed: SEED,
    language: 'en',
    objective: 'Learn to keep a running best while scanning an array.',
    theme: {
      title: 'The Long Corridor',
      story: 'Every door in the corridor hides a number, and only the biggest one is the exit.',
      genre: 'detective',
      tone: 'playful',
    },
    visual: {
      palette: {
        background: '#0b1020',
        primary: '#8ab4f8',
        accent: '#ffd479',
        success: '#7ee787',
        danger: '#ff7b72',
      },
      objectGlyphs: { number: '🚪' },
    },
    vocabulary: {
      object: 'door',
      objectPlural: 'doors',
      place: 'the corridor',
      actionVerb: 'read',
      target: 'the exit',
      lowerWord: 'lower',
      equalWord: 'equal',
      higherWord: 'higher',
    },
    mechanics: [{ id: 'comparePair', boundDsaOp: 'compare', label: 'weigh two doors' }],
    narration: {
      intro: 'Walk the corridor and find the biggest number.',
      hintPool,
      win: 'You found the exit.',
      lose: 'The corridor ends without an exit.',
      correctFlavour: [],
    },
    debrief: { summary: 'You scanned the corridor.', actionMeaning: {}, mapping: [], codeLanguages: ['javascript'] },
    generatedBy: 'test',
  }
}

const NO_ORACLE_SUPPORT = makeFakeOracle({ legalActions: 'absent' })

describe('nextHint', () => {
  it('always produces a non-empty hint at every step of a played game', () => {
    const runtime = createGameRuntime(NO_ORACLE_SUPPORT)
    const states: GameState[] = []
    let state = runtime.init(SEED, 'easy')
    states.push(state)

    const total = state.instance.values.length
    for (let i = 1; i < total; i++) {
      const best = bestIdOf(state) ?? 'o0'
      state = runtime.apply(state, {
        type: 'comparePair',
        aId: `o${i}`,
        bId: best,
        relation: relationBetween(state, `o${i}`, best),
      }).state
      states.push(state)
    }
    state = runtime.apply(state, {
      type: 'submitAnswer',
      targetId: bestIdOf(state) ?? 'o0',
      value: String(Number.parseInt((bestIdOf(state) ?? 'o0').slice(1), 10)),
    }).state
    states.push(state)
    expect(state.phase).toBe('won')

    for (const step of states) {
      const hint = nextHint(step, NO_ORACLE_SUPPORT)
      expect(hint.hint.trim()).not.toBe('')
      expect(hint.source).toBe('heuristic')
      expect(hint.index).toBe(0)
    }
  })

  it('is deterministic: the same state always yields the same hint', () => {
    const state = createGameRuntime(makeFakeOracle()).init(SEED, 'easy')
    const first = nextHint(state, NO_ORACLE_SUPPORT)
    const second = nextHint(cloneState(state), NO_ORACLE_SUPPORT)
    expect(second.hint).toBe(first.hint)
    expect(second.index).toBe(first.index)

    const played = createGameRuntime(makeFakeOracle()).apply(state, { type: 'selectObject', objectId: 'o1' }).state
    expect(nextHint(played, NO_ORACLE_SUPPORT).hint).toBe(nextHint(played, NO_ORACLE_SUPPORT).hint)
  })

  it('works with an oracle that has no legalActions at all', () => {
    const oracle: Oracle = makeFakeOracle({ legalActions: 'absent' })
    expect(oracle.legalActions).toBeUndefined()

    const state = createGameRuntime(oracle).init(SEED, 'easy')
    const hint = nextHint(state, oracle)
    expect(hint.hint).toContain('i=')
    expect(hint.hint).not.toBe(FALLBACK_HINT)
  })

  it('walks the spec hintPool in order, then falls through to the heuristics', () => {
    const oracle = makeFakeOracle({ legalActions: 'single' })
    const runtime = createGameRuntime(oracle)
    const spec = makeSpec(['first pool hint', 'second pool hint'])
    let state = runtime.init(SEED, 'easy')

    const first = nextHint(state, oracle, spec)
    expect(first.source).toBe('spec')
    expect(first.index).toBe(0)
    expect(first.hint).toContain('first pool hint')

    state = incrementHintsUsed(state)
    const second = nextHint(state, oracle, spec)
    expect(second.source).toBe('spec')
    expect(second.index).toBe(1)
    expect(second.hint).toContain('second pool hint')

    // The pool is exhausted: the ladder must keep going anyway.
    state = incrementHintsUsed(state)
    const third = nextHint(state, oracle, spec)
    expect(third.source).toBe('heuristic')
    expect(third.index).toBe(2)
    expect(third.hint).toBe('Compare the highlighted card with your running best')
  })

  it('prefixes pool hints with a factual line derived from the state', () => {
    const oracle = makeFakeOracle()
    const runtime = createGameRuntime(oracle)
    const spec = makeSpec(['trust the flavour on this line'])
    const state = runtime.init(SEED, 'easy')
    const hint = nextHint(state, oracle, spec)

    const [first, ...rest] = hint.hint.split('\n')
    expect(first).toBe(describeStateFacts(state))
    expect(first).toContain('best=')
    expect(first).toContain('i=')
    expect(rest.join('\n')).toBe('trust the flavour on this line')
  })

  it('uses an oracle label when exactly one move is legal', () => {
    const oracle = makeFakeOracle({ legalActions: 'single' })
    const state = createGameRuntime(oracle).init(SEED, 'easy')
    const hint = nextHint(state, oracle)
    expect(hint.source).toBe('heuristic')
    expect(hint.hint).toBe('Compare the highlighted card with your running best')
  })

  it('ignores the oracle when several moves are legal', () => {
    const oracle = makeFakeOracle({ legalActions: 'normal' })
    const state = createGameRuntime(oracle).init(SEED, 'easy')
    expect(oracle.legalActions?.(state).length).toBe(2)

    const hint = nextHint(state, oracle)
    expect(hint.hint).not.toContain('Read the next card')
    expect(hint.hint).toContain('i=')
  })

  it('describes a search window when the algorithm is tracking one', () => {
    const state = createGameRuntime(makeFakeOracle()).init(SEED, 'easy')
    const windowed: GameState = { ...state, variables: { lo: 1, hi: 6, mid: 3 } }
    const hint = nextHint(windowed, NO_ORACLE_SUPPORT)
    expect(hint.hint).toContain('lo=1')
    expect(hint.hint).toContain('hi=6')
    expect(hint.hint).toContain('the answer can only be inside that window')
  })

  it('describes the cursor when there are no variables at all', () => {
    const state = createGameRuntime(makeFakeOracle()).init(SEED, 'easy')
    const cursorOnly: GameState = { ...state, variables: {} }
    expect(variableLine(cursorOnly)).toBe('')
    // Slot and object ids are resolved to the label a player actually reads.
    expect(pointerLine(cursorOnly)).toMatch(/bestObjectId=o0 \(\d+\)/)
    const hint = nextHint(cursorOnly, NO_ORACLE_SUPPORT)
    expect(hint.hint).toContain('the algorithm is looking exactly here')
  })

  it('falls back to the guard text for a state with nothing in it', () => {
    const empty = {} as GameState
    expect(nextHint(empty, NO_ORACLE_SUPPORT).hint).toBe(FALLBACK_HINT)
    expect(describeStateFacts(empty)).not.toBe('')
  })

  it('never throws, whatever it is handed', () => {
    const broken: Oracle = {
      problemId: 'broken',
      buildInstance: () => {
        throw new Error('nope')
      },
      initState: () => {
        throw new Error('nope')
      },
      applyAction: () => {
        throw new Error('nope')
      },
      isWin: () => false,
      canonicalTrace: () => [],
      pseudocode: () => [],
      code: () => [],
      complexity: () => ({ time: '?', space: '?' }),
      answerSummary: () => ({ text: '' }),
      legalActions: () => {
        throw new Error('nope')
      },
    }
    for (const candidate of [undefined, null, {}, 42, { progress: { hintsUsed: -3 }, variables: null }]) {
      const hint = nextHint(candidate as unknown as GameState, broken)
      expect(hint.hint.trim()).not.toBe('')
    }
  })
})

describe('incrementHintsUsed', () => {
  it('returns a new state with one more hint spent and leaves the input alone', () => {
    const state = createGameRuntime(makeFakeOracle()).init(SEED, 'easy')
    const before = cloneState(state)

    const spent = incrementHintsUsed(state)
    expect(spent).not.toBe(state)
    expect(spent.progress.hintsUsed).toBe(1)
    expect(spent.progress.steps).toBe(0)
    expect(incrementHintsUsed(spent).progress.hintsUsed).toBe(2)
    expect(state).toEqual(before)
  })

  it('drives which pool entry the ladder serves next', () => {
    const oracle = makeFakeOracle({ legalActions: 'absent' })
    const spec = makeSpec(['pool one', 'pool two'])
    const runtime = createGameRuntime(oracle)

    let state = runtime.init(SEED, 'easy')
    expect(nextHint(state, oracle, spec).index).toBe(0)
    state = incrementHintsUsed(state)
    expect(nextHint(state, oracle, spec).index).toBe(1)
    state = incrementHintsUsed(state)
    expect(nextHint(state, oracle, spec).source).toBe('heuristic')
  })

  it('works on a finished game too', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const won = playOptimalGame(runtime, SEED)
    expect(incrementHintsUsed(won).progress.hintsUsed).toBe(1)
  })
})
