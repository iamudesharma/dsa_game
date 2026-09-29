/**
 * The guidance layer is the difference between "a board of numbers" and
 * "do this one thing", so its output is asserted directly. These tests exist
 * because the first version of this module passed every type check while
 * telling the player to compare the wrong thing and highlighting all eight
 * objects — neither of which a type system can catch.
 */

import { describe, expect, it } from 'vitest'
import { getOracle } from '@dsa/dsa-oracles'
import { deJargon, deriveFeedback, deriveTurnPrompt } from './guidance.js'
import { createGameRuntime } from './runtime.js'
import type { Action, GameSpec, GameState } from '@dsa/game-schema'

const oracle = getOracle('binary-search')!
const SEED = 31337

function createRuntime() {
  return createGameRuntime(oracle)
}

/**
 * A minimal hand-written spec rather than a generated one. The engine must not
 * depend on the generator to be testable, and this also proves the guidance
 * layer works from nothing but the contract's shape.
 */
function makeSpec(): GameSpec {
  return {
    specVersion: 1,
    problemId: 'binary-search',
    seed: SEED,
    language: 'en',
    objective: 'Find the wanted beacon by throwing away half of the row each time.',
    theme: {
      title: 'The Beacon Row',
      story: 'A row of beacons, sorted by strength. One is wanted.',
      genre: 'sci-fi',
      tone: 'calm',
    },
    visual: {
      palette: {
        background: '#0b1020',
        primary: '#7dd3fc',
        accent: '#c084fc',
        success: '#86efac',
        danger: '#fca5a5',
      },
      objectGlyphs: [],
    },
    vocabulary: {
      object: 'beacon',
      objectPlural: 'beacons',
      place: 'beacon row',
      actionVerb: 'check',
      target: 'wanted beacon',
      lowerWord: 'weaker',
      equalWord: 'matching',
      higherWord: 'stronger',
    },
    mechanics: [
      { id: 'selectObject', boundDsaOp: 'read', label: 'Check the middle beacon.' },
      { id: 'comparePair', boundDsaOp: 'compare', label: 'Check it against the wanted beacon.' },
      { id: 'choosePath', boundDsaOp: 'choose-path', label: 'Keep the side worth keeping.' },
      { id: 'submitAnswer', boundDsaOp: 'terminate', label: 'Commit the answer.' },
    ],
    narration: {
      intro: 'Find the wanted beacon.',
      hintPool: ['Look at the middle.', 'Compare it.', 'Throw away the other half.'],
      win: 'Found it.',
      lose: 'The row is empty.',
      correctFlavour: [],
    },
    debrief: {
      summary: 'You halved the row each time.',
      actionMeaning: {},
      mapping: [],
      codeLanguages: ['javascript'],
    },
    generatedBy: 'test',
  }
}

function fresh(): { state: GameState; spec: GameSpec } {
  return { state: createRuntime().init(SEED, 'easy'), spec: makeSpec() }
}

function play(state: GameState, action: Action): GameState {
  return createRuntime().apply(state, action).state
}

describe('deriveTurnPrompt', () => {
  it('names a single object to act on, not the whole legal set', () => {
    // The oracle offers every in-window object as legal. Highlighting all of
    // them tells a learner nothing, so the pointer wins.
    const { state, spec } = fresh()
    const prompt = deriveTurnPrompt({ state, oracle, spec })
    expect(prompt.mechanic).toBe('selectObject')
    expect(prompt.targets).toHaveLength(1)
    expect(prompt.targets[0]?.role).toBe('current')
  })

  it('reports the operation the mechanic actually performs', () => {
    // Regression: `isDsaOp` was tested against an ACTION type, always failed,
    // and silently fell back to 'read' — so a compare turn advertised a read.
    const { state, spec } = fresh()
    const mid = Number(state.variables['mid'])
    const selected = play(state, { type: 'selectObject', objectId: `v${mid}` })
    const prompt = deriveTurnPrompt({ state: selected, oracle, spec })
    expect(prompt.mechanic).toBe('comparePair')
    expect(prompt.dsaOp).toBe('compare')
    expect(prompt.reason).not.toMatch(/looking at one element/i)
  })

  it('uses the theme vocabulary, not developer nouns', () => {
    const { state, spec } = fresh()
    const prompt = deriveTurnPrompt({ state, oracle, spec })
    const text = `${prompt.instruction} ${prompt.goal} ${prompt.reason}`.toLowerCase()
    // The spec's own noun, not the contract's.
    expect(text).toContain(spec.vocabulary.object)
    expect(text).not.toMatch(/\bindex\b|\barray element\b|\bdata element\b/)
  })

  it('offers both branches in the theme words when narrowing the space', () => {
    const { state, spec } = fresh()
    const values = state.instance.values
    const target = state.instance.target!
    const mid = Number(state.variables['mid'])
    let s = play(state, { type: 'selectObject', objectId: `v${mid}` })
    s = play(s, {
      type: 'comparePair',
      aId: `v${mid}`,
      bId: 'target',
      relation: values[mid]! < target ? 'gt' : 'lt',
    })
    const prompt = deriveTurnPrompt({ state: s, oracle, spec })
    expect(prompt.mechanic).toBe('choosePath')
    const text = prompt.targets.map((t) => t.label).join(' | ')
    expect(text).toContain(spec.vocabulary.lowerWord)
    expect(text).toContain(spec.vocabulary.higherWord)
  })

  it('counts the search space down as halves are discarded', () => {
    const { state } = fresh()
    const values = state.instance.values
    const target = state.instance.target!
    const runtime = createRuntime()

    const at = (s: GameState) => deriveTurnPrompt({ state: s, oracle, spec: fresh().spec }).indicator.detail

    expect(at(state)).toMatch(/8 of 8/)
    const mid = Number(state.variables['mid'])
    let s = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` }).state
    s = runtime.apply(s, {
      type: 'comparePair',
      aId: `v${mid}`,
      bId: 'target',
      relation: values[mid]! < target ? 'gt' : 'lt',
    }).state
    s = runtime.apply(s, {
      type: 'choosePath',
      fromId: `v${mid}`,
      pathId: values[mid]! < target ? 'right' : 'left',
    }).state
    expect(at(s)).toMatch(/4 of 8/)
  })

  it('is total: a terminal state still yields a usable prompt', () => {
    const { state, spec } = fresh()
    const won: GameState = { ...state, phase: 'won' }
    const prompt = deriveTurnPrompt({ state: won, oracle, spec })
    expect(prompt.instruction.length).toBeGreaterThan(0)
    expect(prompt.progress).toBe(1)
  })

  it('is total: an oracle with no legalActions still yields a prompt', () => {
    const { state, spec } = fresh()
    const blind = { ...oracle, legalActions: undefined }
    const prompt = deriveTurnPrompt({ state, oracle: blind, spec })
    expect(prompt.instruction.length).toBeGreaterThan(0)
    expect(prompt.reason.length).toBeGreaterThan(0)
  })

  it('nudges after repeated trouble, and never scolds', () => {
    const { state, spec } = fresh()
    // Build genuine wrong turns: the nudge fires on consecutive incorrect
    // steps, not merely on a mistake count, so a state with an empty trace and
    // a doctored counter must NOT nudge.
    const runtime = createRuntime()
    const values = state.instance.values
    const target = state.instance.target!
    const mid = Number(state.variables['mid'])

    let s = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` }).state
    const wrongRelation = values[mid]! < target ? 'lt' : 'gt'
    s = runtime.apply(s, {
      type: 'comparePair',
      aId: `v${mid}`,
      bId: 'target',
      relation: wrongRelation,
    }).state
    s = runtime.apply(s, {
      type: 'comparePair',
      aId: `v${mid}`,
      bId: 'target',
      relation: wrongRelation,
    }).state

    expect(s.progress.mistakes).toBeGreaterThanOrEqual(2)
    const nudged = deriveTurnPrompt({ state: s, oracle, spec })
    expect(nudged.nudge).not.toBeNull()
    const text = (nudged.nudge?.message ?? '').toLowerCase()
    for (const banned of ['wrong', 'stupid', 'bad', 'fail', 'you should not']) {
      expect(text).not.toContain(banned)
    }
  })

  it('does not nudge a player who is doing fine', () => {
    const { state, spec } = fresh()
    expect(deriveTurnPrompt({ state, oracle, spec }).nudge).toBeNull()
  })
})

describe('deriveFeedback', () => {
  it('always explains, including on success', () => {
    // Educational-game research: explanatory feedback beats "Correct!". A
    // success with an empty `teach` teaches nothing.
    const { state, spec } = fresh()
    const runtime = createRuntime()
    const mid = Number(state.variables['mid'])
    const good = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` })
    const fb = deriveFeedback({
      state: good.state,
      oracle,
      spec,
      outcome: good.outcome,
      frame: good.state.trace[good.state.trace.length - 1],
    })
    expect(fb.verdict).toBe('correct')
    expect(fb.teach.trim().length).toBeGreaterThan(0)
    expect(fb.codeLine).toBeGreaterThan(0)
  })

  it('tells the learner what the program wanted when they are wrong', () => {
    const { state, spec } = fresh()
    const runtime = createRuntime()
    const mid = Number(state.variables['mid'])
    const selected = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` })
    const values = state.instance.values
    const target = state.instance.target!
    const wrong = values[mid]! < target ? 'lt' : 'gt'
    const bad = runtime.apply(selected.state, {
      type: 'comparePair',
      aId: `v${mid}`,
      bId: 'target',
      relation: wrong,
    })
    const fb = deriveFeedback({
      state: bad.state,
      oracle,
      spec,
      outcome: bad.outcome,
      frame: bad.state.trace[bad.state.trace.length - 1],
    })
    expect(fb.verdict).toBe('wrong')
    expect(fb.nextStep && fb.nextStep.length).toBeTruthy()
    expect(fb.teach.length).toBeGreaterThan(0)
  })

  it('never leaks the algorithm notation into player-facing text', () => {
    const { state, spec } = fresh()
    const runtime = createRuntime()
    const values = state.instance.values
    const target = state.instance.target!
    let s = state
    for (let i = 0; i < 6; i += 1) {
      const mid = Number(s.variables['mid'])
      if (s.phase !== 'playing') break
      if (s.internal['midChosen'] !== true) {
        s = runtime.apply(s, { type: 'selectObject', objectId: `v${mid}` }).state
        continue
      }
      const rel = values[mid]! < target ? 'gt' : values[mid]! > target ? 'lt' : 'eq'
      const c = runtime.apply(s, { type: 'comparePair', aId: `v${mid}`, bId: 'target', relation: rel })
      s = c.state
      const fb = deriveFeedback({
        state: s,
        oracle,
        spec,
        outcome: c.outcome,
        frame: s.trace[s.trace.length - 1],
      })
      // `codeLineText` is exempt: it is the literal source line and is shown in
      // a monospace code panel, not as prose.
      expect(fb.teach).not.toMatch(/\bwindow \[/i)
      expect(fb.teach).not.toMatch(/\b(lo|hi|mid)\s*=/i)
      expect(fb.teach).not.toMatch(/"(lt|eq|gt)"/)
      expect(fb.teach).not.toMatch(/\bindex \d+\b/i)
      if (rel === 'eq') {
        s = runtime.apply(s, { type: 'submitAnswer', targetId: `v${mid}`, value: String(mid) }).state
        break
      }
      s = runtime.apply(s, {
        type: 'choosePath',
        fromId: `v${mid}`,
        pathId: values[mid]! < target ? 'right' : 'left',
      }).state
    }
  })

  it('praises the strategy, never the person', () => {
    const { state, spec } = fresh()
    const runtime = createRuntime()
    const mid = Number(state.variables['mid'])
    const good = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` })
    const fb = deriveFeedback({
      state: good.state,
      oracle,
      spec,
      outcome: good.outcome,
      frame: good.state.trace[0],
    })
    const text = `${fb.headline} ${fb.teach} ${fb.encourage ?? ''}`.toLowerCase()
    for (const banned of ['great job', 'amazing', 'awesome', 'so smart', 'well done', 'nice job']) {
      expect(text).not.toContain(banned)
    }
  })
})

describe('spoiler safety', () => {
  /**
   * The oracle's own legalActions label reads "Choose index 6, the middle of
   * [6, 7]". On the winning turn, index 6 IS the answer — so any code path that
   * surfaces that string to the learner hands over the result on the last move.
   * The guidance layer deliberately ignores it, and this is the test that keeps
   * it ignored.
   */
  it('never names the answer position, on any turn of a real game', () => {
    const { state, spec } = fresh()
    const runtime = createRuntime()
    const values = state.instance.values
    const target = state.instance.target!
    const answerIndex = Number(state.internal['targetIndex'])

    let s = state
    for (let turn = 0; turn < 20 && s.phase === 'playing'; turn += 1) {
      const prompt = deriveTurnPrompt({ state: s, oracle, spec })
      const prose = [
        prompt.instruction,
        prompt.reason,
        prompt.goal,
        ...prompt.targets.map((t) => `${t.label} ${t.hint}`),
      ].join(' ')

      // Position phrasing for the answer index is the giveaway.
      expect(
        new RegExp(`\\b(index|position|spot|slot|number|#)\\s*${answerIndex}\\b`, 'i').test(prose),
        `turn ${turn} named the answer position: ${prose}`,
      ).toBe(false)
      // The oracle's range notation must not appear either.
      expect(prose).not.toMatch(/\[\s*-?\d+\s*,\s*-?\d+\s*\]/)
      expect(prose.toLowerCase()).not.toContain('index')

      const mid = Number(s.variables['mid'])
      if (s.internal['midChosen'] !== true) {
        s = runtime.apply(s, { type: 'selectObject', objectId: `v${mid}` }).state
        continue
      }
      const rel = values[mid]! < target ? 'gt' : values[mid]! > target ? 'lt' : 'eq'
      s = runtime.apply(s, { type: 'comparePair', aId: `v${mid}`, bId: 'target', relation: rel }).state
      if (rel === 'eq' || s.phase !== 'playing') break
      s = runtime.apply(s, {
        type: 'choosePath',
        fromId: `v${mid}`,
        pathId: values[mid]! < target ? 'right' : 'left',
      }).state
    }

    // And the last prompt before the answer still must not give it away.
    const last = deriveTurnPrompt({ state: s, oracle, spec })
    const lastProse = [last.instruction, last.reason, ...last.targets.map((t) => t.label)].join(' ')
    expect(new RegExp(`\\b${answerIndex}\\b`)).toBeDefined()
    expect(lastProse).not.toMatch(new RegExp(`(^|[^\\d])${answerIndex}([^\\d]|$)`))
  })

  it('does not emit the "answer" target role, which would spoil via a tap target', () => {
    // A tappable target that is the answer leaks the answer through a rendering
    // channel that the text guardrails never see.
    const { state, spec } = fresh()
    const runtime = createRuntime()
    let s = state
    for (let i = 0; i < 12 && s.phase === 'playing'; i += 1) {
      const prompt = deriveTurnPrompt({ state: s, oracle, spec })
      expect(prompt.targets.every((t) => t.role !== 'answer')).toBe(true)
      const mid = Number(s.variables['mid'])
      if (s.internal['midChosen'] !== true) {
        s = runtime.apply(s, { type: 'selectObject', objectId: `v${mid}` }).state
        continue
      }
      const rel = values1(s) < target1(s) ? 'gt' : values1(s) > target1(s) ? 'lt' : 'eq'
      s = runtime.apply(s, { type: 'comparePair', aId: `v${mid}`, bId: 'target', relation: rel }).state
      if (rel === 'eq' || s.phase !== 'playing') break
      s = runtime.apply(s, {
        type: 'choosePath',
        fromId: `v${mid}`,
        pathId: values1(s) < target1(s) ? 'right' : 'left',
      }).state
    }
  })

  it('only ever points at real board objects', () => {
    // Regression: the branch turn used to mint `__branch_high_v3` for the higher
    // side. It validated, rendered, and highlighted nothing, because no tile
    // carried that id. A target id the UI cannot resolve is a dead target.
    const { state, spec } = fresh()
    const runtime = createRuntime()
    const values = state.instance.values
    const target = state.instance.target!

    let s = state
    for (let turn = 0; turn < 12 && s.phase === 'playing'; turn += 1) {
      const prompt = deriveTurnPrompt({ state: s, oracle, spec })
      for (const t of prompt.targets) {
        expect(
          s.objects[t.id],
          `turn ${turn} target "${t.id}" is not a real board object`,
        ).toBeDefined()
        // Real object ids only — no synthetic prefixes, ever.
        expect(t.id.startsWith('__')).toBe(false)
      }

      const mid = Number(s.variables['mid'])
      if (s.internal['midChosen'] !== true) {
        s = runtime.apply(s, { type: 'selectObject', objectId: `v${mid}` }).state
        continue
      }
      const rel = values[mid]! < target ? 'gt' : values[mid]! > target ? 'lt' : 'eq'
      s = runtime.apply(s, { type: 'comparePair', aId: `v${mid}`, bId: 'target', relation: rel }).state
      if (rel === 'eq' || s.phase !== 'playing') break
      s = runtime.apply(s, {
        type: 'choosePath',
        fromId: `v${mid}`,
        pathId: values[mid]! < target ? 'right' : 'left',
      }).state
    }
  })
})

function values1(s: GameState): number {
  return s.instance.values[Number(s.variables['mid'])] ?? 0
}
function target1(s: GameState): number {
  return s.instance.target ?? 0
}

describe('deJargon', () => {
  it('rewrites notation into plain words', () => {
    const { spec } = fresh()
    expect(deJargon('Index 3 is the midpoint of [0, 7].', spec)).not.toMatch(/\bindex\b|\[0, 7\]/i)
    expect(deJargon('keeping window [4, 7]', spec)).not.toMatch(/\[4, 7\]/)
    expect(deJargon('mid = 3', spec)).not.toMatch(/mid\s*=/)
  })

  it('translates relation codes into the theme words', () => {
    const { spec } = fresh()
    const out = deJargon('the relation is "gt"', spec)
    expect(out).toContain(spec.vocabulary.higherWord)
    expect(out).not.toContain('"gt"')
  })

  it('leaves ordinary prose alone', () => {
    expect(deJargon('That half is ruled out.')).toBe('That half is ruled out.')
  })
})
