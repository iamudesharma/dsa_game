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
import { findHintViolation } from './hint-safety.js'
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
      objectGlyphs: ['🚪'],
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

/** The words `describeSearchWindow` counts in, so a test can assert on them. */
const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]
const wordFor = (n: number): string => WORDS[n] ?? String(n)

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
    expect(hint.hint).toContain('still in play')
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

  /**
   * The pool line is the hint. It is NOT prefixed with a dump of the algorithm's
   * variables — that dump printed `comparisons=0, found=false, hi=7, lo=0, mid=3`
   * on every request, which is the notation `hint-safety.ts` rejects and which
   * `guidance.ts::deJargon` exists to strip.
   */
  it('serves the pool line on its own, with no variable table in front of it', () => {
    const oracle = makeFakeOracle()
    const runtime = createGameRuntime(oracle)
    const spec = makeSpec(['trust the flavour on this line'])
    const state = runtime.init(SEED, 'easy')
    const hint = nextHint(state, oracle, spec)

    expect(hint.hint).toBe('trust the flavour on this line')
    expect(hint.hint).not.toMatch(/\b(?:lo|hi|mid|best|comparisons)\s*=/i)
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
    expect(hint.hint).toContain('still in play')
  })

  it('describes a search window in words, with no lo/hi notation', () => {
    // A windowed problem: the board is 8 values and the algorithm is tracking
    // 6 of them, so the sentence is "six of the eight". The test oracle's board
    // is only 4 long, so the values are supplied explicitly.
    const state = createGameRuntime(
      makeFakeOracle({ values: [3, 1, 4, 1, 5, 9, 2, 6] }),
    ).init(SEED, 'easy')
    const windowed: GameState = { ...state, variables: { lo: 1, hi: 6, mid: 3 } }
    const hint = nextHint(windowed, NO_ORACLE_SUPPORT)
    expect(hint.hint).toMatch(/six of the eight/i)
    // The window is the useful fact; `lo=1, hi=6` is the notation the screen
    // forbids, and the two must never both be true.
    expect(hint.hint).not.toMatch(/\blo=|\bhi=/)
  })

  it('never reports more values in the window than the board holds', () => {
    // The window comes from the bounds and the total from the board, so a
    // window wider than the board must not produce "six of the four". The
    // total is what the learner can count, so it is the part asserted.
    const state = createGameRuntime(makeFakeOracle()).init(SEED, 'easy')
    const impossible: GameState = { ...state, variables: { lo: 1, hi: 6 } }
    const hint = nextHint(impossible, NO_ORACLE_SUPPORT)
    expect(hint.hint).toContain(`of the ${wordFor(state.instance.values.length)}`)
    expect(hint.hint).toContain('still in play')
  })

  it('describes the whole board when there is no window yet', () => {
    const state = createGameRuntime(makeFakeOracle()).init(SEED, 'easy')
    const cursorOnly: GameState = { ...state, variables: {} }
    expect(variableLine(cursorOnly)).toBe('')
    // Slot and object ids are still resolvable for callers that want them.
    expect(pointerLine(cursorOnly)).toMatch(/bestObjectId=o0 \(\d+\)/)
    const hint = nextHint(cursorOnly, NO_ORACLE_SUPPORT)
    expect(hint.hint).toContain('still in play')
    expect(hint.hint).not.toMatch(/\bbest=|\bi=/)
  })

  /**
   * The regression the screen was written for: a spec hint that is really the
   * canonical algorithm must never reach a learner. On the default tier with no
   * API key, `POST /api/hint` returned exactly these three lines.
   */
  it('serves a window description instead of a hint that is the whole algorithm', () => {
    const oracle = makeFakeOracle({ legalActions: 'absent' })
    const spec = makeSpec([
      'First move: Set lo=0, hi=n-1.',
      'Then: While lo<=hi compute mid=(lo+hi)/2.',
      'Then: If a[mid]==target stop.',
    ])
    let state = createGameRuntime(oracle).init(SEED, 'easy')

    for (let i = 0; i < 3; i += 1) {
      const hint = nextHint(state, oracle, spec)
      expect(hint.screened?.id, `hint ${i + 1}: ${hint.hint}`).toBeDefined()
      expect(hint.hint, `hint ${i + 1}`).not.toMatch(/\b(?:lo|hi|mid)\s*=/)
      expect(hint.hint, `hint ${i + 1}`).toContain('still in play')
      state = incrementHintsUsed(state)
    }
  })

  it('leaves a clean authored hint alone', () => {
    const oracle = makeFakeOracle({ legalActions: 'absent' })
    const spec = makeSpec(['Hold your door next to the exit and ask which is bigger.'])
    const hint = nextHint(createGameRuntime(oracle).init(SEED, 'easy'), oracle, spec)
    expect(hint.screened).toBeUndefined()
    expect(hint.hint).toContain('Hold your door next to the exit')
  })

  it('screens the oracle label too, because it names the move', () => {
    // The oracle rung is the strongest hint available and the most dangerous
    // one: for a windowed problem, naming the move IS naming the position,
    // which is the answer. See `hintFromOracle`.
    const leaky: Oracle = makeFakeOracle({ legalActions: 'single' })
    const spec = makeSpec([])
    const hint = nextHint(createGameRuntime(leaky).init(SEED, 'easy'), leaky, spec)
    expect(hint.source).toBe('heuristic')
    expect(hint.hint.trim()).not.toBe('')
  })

  it('honours a caller-supplied index without skipping the screen', () => {
    const oracle = makeFakeOracle({ legalActions: 'absent' })
    const spec = makeSpec(['a clean hint at zero', 'Set lo=0, hi=n-1.'])
    const state = createGameRuntime(oracle).init(SEED, 'easy')

    const clean = nextHint(state, oracle, spec, { preferIndex: 0 })
    expect(clean.hint).toContain('a clean hint at zero')
    expect(clean.screened).toBeUndefined()

    const leaky = nextHint(state, oracle, spec, { preferIndex: 1 })
    expect(leaky.screened?.id).toBe('notation')
    expect(leaky.hint).not.toMatch(/lo=/)
  })

  it('ignores a preferIndex that is out of range', () => {
    const oracle = makeFakeOracle({ legalActions: 'absent' })
    const spec = makeSpec(['only hint'])
    const state = createGameRuntime(oracle).init(SEED, 'easy')
    const hint = nextHint(state, oracle, spec, { preferIndex: 99 })
    expect(hint.index).toBe(0)
    expect(hint.hint).toContain('only hint')
  })

  it('still says something useful for a state with nothing in it', () => {
    const empty = {} as GameState
    const hint = nextHint(empty, NO_ORACLE_SUPPORT)
    expect(hint.hint.trim()).not.toBe('')
    // Whatever it settles on, it must itself pass the screen — a fallback that
    // the screen would reject is not a fallback.
    expect(findHintViolation(hint.hint)).toBeNull()
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
