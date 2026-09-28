/**
 * Engine tests: runtime hardening, undo, telemetry and the debrief payload.
 *
 * Everything runs against the in-repo fake oracle (`makeFakeOracle`), which
 * also knows how to misbehave on purpose: throw, append the wrong number of
 * trace frames, or return a half-built outcome.
 */

import { describe, expect, it } from 'vitest'
import { cloneState, emptyProgress } from '@dsa/game-schema'
import type { Action, ActionOutcome, GameState, Oracle, TraceFrame } from '@dsa/game-schema'

import { createGameRuntime } from './runtime.js'
import { canUndo, peekSnapshot, popSnapshot, pushSnapshot, rewindProgressTo, undo } from './undo.js'
import { mapGameActionToCode, mistakeSummary, optimisationScore, traceCodeHighlights } from './telemetry.js'
import { FAKE_VALUE_COUNT, bestIdOf, makeFakeOracle, playOptimalGame, relationBetween } from './testing/fake-oracle.js'
import * as engine from './index.js'

const SEED = 7

function wrongRelation(state: GameState, candidate: string, best: string): 'lt' | 'gt' {
  const truth = relationBetween(state, candidate, best)
  return truth === 'lt' ? 'gt' : 'lt'
}

function playOneMistake(): { state: GameState; clean: GameState } {
  const runtime = createGameRuntime(makeFakeOracle())
  const start = runtime.init(SEED, 'easy')
  const best = bestIdOf(start) ?? 'o0'
  const after = runtime.apply(start, {
    type: 'comparePair',
    aId: 'o1',
    bId: best,
    relation: wrongRelation(start, 'o1', best),
  }).state
  return { state: after, clean: start }
}

describe('runtime.init', () => {
  it('produces the declared starting shape', () => {
    const oracle = makeFakeOracle()
    const runtime = createGameRuntime(oracle)
    const state = runtime.init(SEED, 'easy')

    expect(runtime.oracle).toBe(oracle)
    expect(state.problemId).toBe('array-max-min')
    expect(state.seed).toBe(SEED)
    expect(state.phase).toBe('playing')
    expect(state.progress).toEqual(emptyProgress())
    expect(state.trace).toEqual([])
    expect(state.selection).toEqual([])
    expect(Object.keys(state.objects)).toHaveLength(FAKE_VALUE_COUNT)
    expect(Object.keys(state.slots)).toHaveLength(FAKE_VALUE_COUNT)
    expect(state.instance.values).toHaveLength(FAKE_VALUE_COUNT)
  })

  it('is deterministic for the same seed and different across seeds', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    expect(runtime.init(SEED, 'easy').instance.values).toEqual(runtime.init(SEED, 'easy').instance.values)
    expect(runtime.init(SEED, 'easy').instance.values).not.toEqual(runtime.init(SEED + 1, 'easy').instance.values)
  })

  it('fails loudly when the oracle breaks a declared sorted-instance guarantee', () => {
    const runtime = createGameRuntime(makeFakeOracle({ problemId: 'binary-search', values: [5, 1, 9, 3] }))
    expect(() => runtime.init(SEED, 'easy')).toThrow(/not sorted/i)
  })

  it('accepts a sorted instance for a problem that declares sorted: true', () => {
    const runtime = createGameRuntime(makeFakeOracle({ problemId: 'binary-search', values: [1, 3, 5, 9] }))
    expect(runtime.init(SEED, 'easy').instance.values).toEqual([1, 3, 5, 9])
  })
})

describe('runtime.apply', () => {
  it('delegates to the oracle and keeps exactly one frame per action', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const result = runtime.apply(start, { type: 'selectObject', objectId: 'o1' })

    expect(result.outcome.correct).toBe(true)
    expect(result.outcome.illegal).toBeFalsy()
    expect(result.outcome.dsaOp).toBe('read')
    expect(result.outcome.traceStep).toBe(0)
    expect(result.warnings).toEqual([])
    expect(result.state.trace).toHaveLength(1)
    expect(result.state.trace[0]?.action).toEqual({ type: 'selectObject', objectId: 'o1' })
    expect(result.state.trace[0]?.index).toBe(0)
  })

  it('turns an oracle throw into a clean illegal outcome', () => {
    const runtime = createGameRuntime(makeFakeOracle({ malform: 'throw' }))
    const start = runtime.init(SEED, 'easy')
    const before = cloneState(start)

    const result = runtime.apply(start, { type: 'selectObject', objectId: 'o1' })

    expect(result.outcome.illegal).toBe(true)
    expect(result.outcome.correct).toBe(false)
    expect(result.outcome.feedback).toContain('fake oracle exploded on purpose')
    expect(result.outcome.dsaOp).toBe('read')
    expect(result.warnings.length).toBeGreaterThan(0)
    // The board is untouched, but the turn still happened.
    expect(result.state.objects).toEqual(before.objects)
    expect(result.state.trace).toHaveLength(0)
    expect(result.state.progress.steps).toBe(1)
    expect(start).toEqual(before)
  })

  it('rejects an action type outside the mechanic catalog without calling the oracle', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const result = runtime.apply(start, { type: 'teleportObject' } as unknown as Action)

    expect(result.outcome.illegal).toBe(true)
    expect(result.warnings.join(' ')).toContain('unknown action type')
    expect(result.state.trace).toHaveLength(0)
  })

  it('repairs an oracle that appended zero trace frames', () => {
    const runtime = createGameRuntime(makeFakeOracle({ frames: 'none' }))
    const start = runtime.init(SEED, 'easy')
    const result = runtime.apply(start, { type: 'selectObject', objectId: 'o1' })

    expect(result.state.trace).toHaveLength(1)
    expect(result.state.trace[0]?.index).toBe(0)
    expect(result.outcome.traceStep).toBe(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('synthesised')
  })

  it('repairs an oracle that appended three trace frames', () => {
    const runtime = createGameRuntime(makeFakeOracle({ frames: 'three' }))
    const start = runtime.init(SEED, 'easy')
    const result = runtime.apply(start, { type: 'selectObject', objectId: 'o1' })

    expect(result.state.trace).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('appended 3 trace frames')
    // The surviving frame is a usable replay frame, whatever the oracle called it.
    expect(result.state.trace[0]?.action).toEqual({ type: 'selectObject', objectId: 'o1' })
    expect(result.outcome.traceStep).toBe(0)
  })

  it('keeps one frame per action across a whole run', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const state = playOptimalGame(runtime, SEED)
    expect(state.phase).toBe('won')
    expect(state.trace).toHaveLength(FAKE_VALUE_COUNT)
    expect(state.trace.map((frame) => frame.index)).toEqual([0, 1, 2, 3])
    expect(state.progress).toEqual({ steps: 4, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} })
  })

  it('accumulates steps, mistakes and mistakesByMechanic', () => {
    const { state, clean } = playOneMistake()
    expect(state.progress.steps).toBe(1)
    expect(state.progress.mistakes).toBe(1)
    expect(state.progress.mistakesByMechanic).toEqual({ comparePair: 1 })
    // The oracle applied the mistake visibly, and reported what it expected.
    expect(state.trace[0]?.correct).toBe(false)

    const runtime = createGameRuntime(makeFakeOracle())
    const second = runtime.apply(state, { type: 'selectObject', objectId: 'o1' })
    expect(second.outcome.correct).toBe(true)
    expect(second.state.progress).toEqual({
      steps: 2,
      mistakes: 1,
      hintsUsed: 0,
      mistakesByMechanic: { comparePair: 1 },
    })
    expect(clean.progress.steps).toBe(0)
  })

  it('does not count a rejected move as a mistake', () => {
    // A rejected move leaves the board untouched and runs no algorithm step, so
    // it is not evidence of a misconception. Counting it would let mis-clicks
    // drive mistakesByMechanic, which is what feeds the Laya misconception tag
    // and the debrief's "we noticed you..." line.
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')

    // An unknown objectId is rejected by the oracle.
    const rejected = runtime.apply(start, { type: 'selectObject', objectId: 'does-not-exist' })
    expect(rejected.outcome.illegal).toBe(true)
    expect(rejected.outcome.correct).toBe(false)
    expect(rejected.state.progress.steps).toBe(1)
    expect(rejected.state.progress.mistakes).toBe(0)
    expect(rejected.state.progress.mistakesByMechanic).toEqual({})
    expect(rejected.state.trace).toHaveLength(0)

    // An action type outside the catalog never reaches the oracle at all.
    const bogus = runtime.apply(start, { type: 'swapPair', aId: 'o1', bId: 'o2' })
    expect(bogus.state.progress.mistakes).toBe(0)

    // Fumbling repeatedly must not manufacture a misconception.
    let fumbled = start
    for (let i = 0; i < 5; i += 1) {
      fumbled = runtime.apply(fumbled, { type: 'selectObject', objectId: 'nope' }).state
    }
    expect(fumbled.progress.steps).toBe(5)
    expect(fumbled.progress.mistakes).toBe(0)

    // A real, evaluated mistake still counts.
    const { state } = playOneMistake()
    expect(state.progress.mistakes).toBe(1)
  })

  it('never mutates the state it was given and hands out an independent copy', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const before = cloneState(start)

    const result = runtime.apply(start, { type: 'selectObject', objectId: 'o1' })

    expect(start).toEqual(before)
    expect(result.state).not.toBe(start)
    expect(result.state.objects).not.toBe(start.objects)
    result.state.objects['o1'] = { ...(result.state.objects['o1']!), state: 'eliminated' }
    expect(start.objects['o1']?.state).toBe('idle')
  })

  it('fills in a default feedback and dsaOp when the oracle omits them', () => {
    const runtime = createGameRuntime(makeFakeOracle({ malform: 'bare-outcome' }))
    const start = runtime.init(SEED, 'easy')
    const result = runtime.apply(start, { type: 'selectObject', objectId: 'o1' })

    expect(result.outcome.feedback).not.toBe('')
    expect(result.outcome.dsaOp).toBe('read')
    expect(result.outcome.traceStep).toBe(0)
  })

  it('treats a garbage oracle result as a rejection and keeps the board', () => {
    const runtime = createGameRuntime(makeFakeOracle({ malform: 'garbage-result' }))
    const start = runtime.init(SEED, 'easy')
    const result = runtime.apply(start, { type: 'selectObject', objectId: 'o1' })

    expect(result.outcome.illegal).toBe(true)
    expect(result.outcome.feedback).not.toBe('')
    expect(result.state.objects).toEqual(start.objects)
    // A rejection runs no algorithm step, so it contributes no replay frame.
    expect(result.state.trace).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('runtime.isWin', () => {
  it('delegates while the game is still being played', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const state = runtime.init(SEED, 'easy')
    expect(runtime.isWin(state)).toBe(false)

    const solved = cloneState(state)
    solved.internal['correct'] = true
    expect(runtime.isWin(solved)).toBe(true)
  })

  it('trusts the phase over the oracle predicate', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const state = runtime.init(SEED, 'easy')

    const won = cloneState(state)
    won.phase = 'won'
    expect(runtime.isWin(won)).toBe(true)

    const lost = cloneState(state)
    lost.phase = 'lost'
    lost.internal['correct'] = true
    expect(runtime.isWin(lost)).toBe(false)
  })

  it('survives being destructured, and refuses moves after the game ended', () => {
    const { apply, debrief, isWin } = createGameRuntime(makeFakeOracle())
    const won = playOptimalGame(createGameRuntime(makeFakeOracle()), SEED)

    expect(isWin(won)).toBe(true)
    expect(debrief(won).phase).toBe('won')
    const late = apply(won, { type: 'selectObject', objectId: 'o1' })
    expect(late.outcome.illegal).toBe(true)
    expect(late.state.phase).toBe('won')
  })
})

describe('undo', () => {
  it('pushes, peeks, pops and reports whether undo is possible', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const after = runtime.apply(start, { type: 'selectObject', objectId: 'o1' }).state

    expect(canUndo([])).toBe(false)
    const stack = pushSnapshot([], start)
    expect(canUndo(stack)).toBe(true)
    expect(peekSnapshot(stack)).toEqual(start)

    const withBoth = pushSnapshot(stack, after)
    expect(withBoth).toHaveLength(2)
    expect(peekSnapshot(withBoth)).toEqual(after)
    expect(popSnapshot(withBoth)).toEqual(after)
    // Peeking and popping for inspection must not consume the snapshot.
    expect(withBoth).toHaveLength(2)
  })

  it('trims the oldest snapshots past the limit', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    let state = runtime.init(SEED, 'easy')
    let stack: GameState[] = []
    for (let i = 1; i < 4; i++) {
      stack = pushSnapshot(stack, state, 2)
      state = runtime.apply(state, { type: 'selectObject', objectId: `o${i}` }).state
    }
    expect(stack).toHaveLength(2)
    expect(peekSnapshot(stack)?.selection).toEqual([])
  })

  it('returns null when there is nothing to undo', () => {
    const result = undo([])
    expect(result.state).toBeNull()
    expect(result.stack).toEqual([])
    expect(undo([null as unknown as GameState]).state).toBeNull()
  })

  it('restores a clone, not a live reference', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const stack = pushSnapshot([], start)
    const { stack: rest, state } = undo(stack)

    expect(rest).toHaveLength(0)
    expect(state).toEqual(start)
    expect(state).not.toBe(start)
    if (state !== null) state.objects['o0'] = { ...state.objects['o0']!, state: 'eliminated' }
    const again = pushSnapshot([], start)
    expect(peekSnapshot(again)?.objects['o0']?.state).toBe('current')
  })

  it('does not rewind mistakes, because a mistake is a fact about the player', () => {
    const { state, clean } = playOneMistake()
    const stack = pushSnapshot(pushSnapshot([], state), clean)
    const { state: restored } = undo(stack)
    expect(restored?.trace).toHaveLength(0)
    expect(restored?.progress.mistakes).toBe(0)

    if (restored === null) throw new Error('expected a snapshot to restore')
    const rewound = rewindProgressTo(state, restored)
    expect(rewound.progress.mistakes).toBe(1)
    expect(rewound.progress.mistakesByMechanic).toEqual({ comparePair: 1 })
    expect(rewound.progress.steps).toBe(1)
    // The board really did rewind, though.
    expect(rewound.internal['i']).toBe(1)
    expect(rewound.trace).toHaveLength(0)
  })
})

describe('telemetry', () => {
  it('buckets mistakes by mechanic and by dsa op', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const best = bestIdOf(start) ?? 'o0'
    const state = runtime.apply(start, {
      type: 'comparePair',
      aId: 'o1',
      bId: best,
      relation: wrongRelation(start, 'o1', best),
    }).state
    const state2 = runtime.apply(state, { type: 'selectObject', objectId: 'o2' }).state

    const summary = mistakeSummary(state2.trace)
    expect(summary.total).toBe(1)
    expect(summary.byMechanic).toEqual({ comparePair: 1 })
    expect(summary.byDsaOp).toEqual({ compare: 1 })
    expect(summary.firstMistakeAt).toBe(0)

    const clean = mistakeSummary(playOptimalGame(runtime, SEED).trace)
    expect(clean.total).toBe(0)
    expect(clean.firstMistakeAt).toBeNull()
    expect(clean.byMechanic).toEqual({})
  })

  it('is empty-safe for a trace that is not an array', () => {
    const summary = mistakeSummary(undefined as unknown as TraceFrame[])
    expect(summary).toEqual({ total: 0, byMechanic: {}, byDsaOp: {}, firstMistakeAt: null })
  })

  it('scores optimal play as 1 and sloppy play below 1', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const won = playOptimalGame(runtime, SEED)
    const optimal = optimisationScore(won.trace, runtime.debrief(won).canonicalTrace)
    expect(optimal.ratio).toBe(1)
    expect(optimal.score).toBe(1)
    expect(optimal.note).toContain('optimal')

    const sloppyTrace = [...won.trace, ...won.trace, ...won.trace]
    const sloppy = optimisationScore(sloppyTrace, runtime.debrief(won).canonicalTrace)
    expect(sloppy.ratio).toBe(3)
    expect(sloppy.score).toBeGreaterThan(0)
    expect(sloppy.score).toBeLessThan(1)
    expect(sloppy.note).toContain('12 steps')

    const empty = optimisationScore([], [])
    expect(empty.score).toBe(1)
    expect(empty.ratio).toBe(0)
    expect(empty.note).toContain('no reference trace')
  })

  it('dedupes and sorts the code lines the player hit', () => {
    const frames = [
      { codeLine: 7 },
      { codeLine: 4 },
      { codeLine: 7 },
      { codeLine: 1 },
      { codeLine: 0 },
      { codeLine: -3 },
      { codeLine: 2.5 },
    ] as unknown as TraceFrame[]
    expect(traceCodeHighlights(frames)).toEqual([1, 4, 7])
    expect(traceCodeHighlights([])).toEqual([])
  })

  it('only maps mechanics the player actually used', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const best = bestIdOf(start) ?? 'o0'
    const state = runtime.apply(start, {
      type: 'comparePair',
      aId: 'o1',
      bId: best,
      relation: relationBetween(start, 'o1', best),
    }).state

    const mapping = mapGameActionToCode(state.trace)
    expect(mapping).toHaveLength(1)
    expect(mapping[0]?.algorithmTerm).toContain('comparison')
    expect(JSON.stringify(mapping)).not.toMatch(/stack|pointer|swap/i)

    const everything = mapGameActionToCode(playOptimalGame(runtime, SEED).trace)
    expect(everything.map((row) => row.algorithmTerm)).toHaveLength(2)
    expect(everything.every((row) => row.gameTerm !== '' && row.algorithmTerm !== '')).toBe(true)
  })

  it('never states a comparison as a max-finding pattern', () => {
    // Regression guard. These terms are shown to the learner in the debrief as
    // the algorithm meaning of what they just did. An earlier version described
    // comparePair as "comparison: if a[i] > best", which is the max-finding
    // pattern: wrong for binary search, two sum, sorting and most of the
    // catalogue. A confidently wrong comparison is the worst thing this layer
    // could teach, so assert the absence of any max-specific form.
    const runtime = createGameRuntime(makeFakeOracle())
    const start = runtime.init(SEED, 'easy')
    const best = bestIdOf(start) ?? 'o0'
    const played = runtime.apply(start, {
      type: 'comparePair',
      aId: 'o1',
      bId: best,
      relation: relationBetween(start, 'o1', best),
    }).state

    const rows = mapGameActionToCode(played.trace)
    const text = rows.map((r) => `${r.gameTerm} ${r.algorithmTerm}`).join(' ').toLowerCase()
    expect(text).not.toMatch(/a\[i\]\s*>\s*best|running max|keep the largest/)
    expect(text).not.toMatch(/a\[k\]\s*=\s*v/)
  })

  it('does not impose a card or door metaphor that would clash with the theme', () => {
    // The themed vocabulary is the generator's job. This layer describes the
    // interaction in plain words so it cannot contradict a mountain-pass theme
    // with "read a card" or "pick one of two doors".
    const runtime = createGameRuntime(makeFakeOracle())
    const rows = mapGameActionToCode(playOptimalGame(runtime, SEED).trace)
    const text = rows.map((r) => r.gameTerm).join(' ').toLowerCase()
    for (const intruder of ['card', 'door', 'room', 'ledger', 'chain']) {
      expect(text, `game term leaked the "${intruder}" metaphor`).not.toContain(intruder)
    }
  })
})

describe('debrief', () => {
  it('assembles the full post-game payload', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const won = playOptimalGame(runtime, SEED)
    const debrief = runtime.debrief(won)

    expect(debrief.problemId).toBe('array-max-min')
    expect(debrief.phase).toBe('won')
    expect(debrief.playedTrace.length).toBeGreaterThan(0)
    expect(debrief.canonicalTrace.length).toBeGreaterThan(0)
    expect(debrief.pseudocode.length).toBeGreaterThan(0)
    expect(debrief.code.javascript.length).toBeGreaterThan(0)
    expect(debrief.code.python.length).toBeGreaterThan(0)
    expect(debrief.code.typescript.length).toBeGreaterThan(0)
    expect(debrief.complexity.time).not.toBe('')
    expect(debrief.complexity.space).not.toBe('')
    expect(debrief.answer.text).not.toBe('')
    expect(String(debrief.answer.value)).toMatch(/^\d+$/)
  })

  it('derives stats from progress and from the played trace', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const won = playOptimalGame(runtime, SEED)
    const stats = runtime.debrief(won).stats

    expect(stats.steps).toBe(4)
    expect(stats.mistakes).toBe(0)
    expect(stats.hintsUsed).toBe(0)
    expect(stats.mistakesByMechanic).toEqual({})
    expect(stats.mistakeAnalysis.total).toBe(0)
    expect(stats.optimisation.score).toBe(1)
    expect(stats.codeHighlights).toEqual([4, 5, 7])
    expect(stats.actionMapping).toHaveLength(2)
  })

  it('reports a run that was still in progress as not won', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const debrief = runtime.debrief(runtime.init(SEED, 'easy'))
    expect(debrief.phase).toBe('lost')
    expect(debrief.stats.steps).toBe(0)
  })

  it('never throws on a malformed state', () => {
    const runtime = createGameRuntime(makeFakeOracle())
    const debrief = (): ReturnType<typeof runtime.debrief> => runtime.debrief({} as GameState)
    expect(debrief).not.toThrow()
    expect(debrief().answer.text).not.toBe('')
    expect(debrief().complexity.time).not.toBe('')
    expect(debrief().playedTrace).toEqual([])
  })

  it('survives an oracle that throws from every debrief hook', () => {
    const hostile: Oracle = {
      ...makeFakeOracle(),
      canonicalTrace: () => {
        throw new Error('no canonical trace today')
      },
      answerSummary: () => {
        throw new Error('no answer today')
      },
      complexity: () => {
        throw new Error('no complexity today')
      },
    }
    const runtime = createGameRuntime(hostile)
    const debrief = runtime.debrief(playOptimalGame(runtime, SEED))
    expect(debrief.canonicalTrace).toEqual([])
    expect(debrief.answer.text).not.toBe('')
    expect(debrief.complexity.time).toBe('unspecified')
    expect(debrief.playedTrace.length).toBeGreaterThan(0)
  })
})

describe('action outcome contract', () => {
  it('always produces a complete, client-ready outcome', () => {
    const runtime = createGameRuntime(makeFakeOracle({ frames: 'none' }))
    const start = runtime.init(SEED, 'easy')
    const outcomes: ActionOutcome[] = []

    let state = start
    outcomes.push(runtime.apply(state, { type: 'selectObject', objectId: 'o1' }).outcome)
    state = runtime.apply(state, { type: 'selectObject', objectId: 'o1' }).state
    const best = bestIdOf(state) ?? 'o0'
    outcomes.push(
      runtime.apply(state, {
        type: 'comparePair',
        aId: 'o1',
        bId: best,
        relation: relationBetween(state, 'o1', best),
      }).outcome,
    )

    for (const outcome of outcomes) {
      expect(typeof outcome.correct).toBe('boolean')
      expect(outcome.feedback).not.toBe('')
      expect(outcome.dsaOp).not.toBe('')
      expect(outcome.traceStep).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('public surface', () => {
  it('re-exports the whole engine from the barrel', () => {
    const expected = [
      'createGameRuntime',
      'canUndo',
      'peekSnapshot',
      'popSnapshot',
      'pushSnapshot',
      'rewindProgressTo',
      'undo',
      'describeStateFacts',
      'incrementHintsUsed',
      'nextHint',
      'pointerLine',
      'variableLine',
      'mapGameActionToCode',
      'mistakeSummary',
      'optimisationScore',
      'traceCodeHighlights',
    ]
    for (const name of expected) {
      expect(typeof (engine as unknown as Record<string, unknown>)[name]).toBe('function')
    }
    expect(engine.DEFAULT_UNDO_LIMIT).toBe(20)
    expect(engine.FALLBACK_HINT).not.toBe('')
  })

  it('plays a whole game through the barrel alone', () => {
    const runtime = engine.createGameRuntime(makeFakeOracle())
    const won = playOptimalGame(runtime, SEED)
    expect(won.phase).toBe('won')
    expect(engine.optimisationScore(won.trace, runtime.debrief(won).canonicalTrace).score).toBe(1)
    expect(engine.nextHint(won, runtime.oracle).hint).not.toBe('')
  })
})
