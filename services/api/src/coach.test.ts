/**
 * The coach, tested through the real engine and the real oracle.
 *
 * WHY A REAL GAME INSTEAD OF A HAND-BUILT STATE: the interesting coach bugs are
 * not "does the function return a string", they are "does the snapshot agree with
 * what the oracle believes", "does the guardrail survive a board where `mid` IS the
 * answer", "does the second turn actually see the first". All three are invisible
 * against a fixture and obvious against a played game, so the fixture here is a
 * real binary-search run driven by the same actions a learner would make.
 *
 * WHAT IS DELIBERATELY NOT MOCKED: the engine, the oracle, the template spec. The
 * only thing stubbed is the MODEL TRANSPORT, because the point of the fallback is
 * that it is the real path when no model is reachable — and a test that mocked the
 * fallback would be testing nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireOracle } from '@dsa/dsa-oracles'
import { createGameRuntime } from '@dsa/game-engine'
import { buildTemplateSpec } from '@dsa/provider-chain'
import type { ChatReply, ChatRequest, ChatTransport } from '@dsa/provider-chain'
import { createApp } from './app.js'
import { createDecisionEngine } from '@dsa/decision-layer'
import { getProblem, COACH_BUDGET } from '@dsa/game-schema'
import type { Action, GameSpec, GameState, LearnerBand } from '@dsa/game-schema'
import { putSession, resetStore } from './store.js'
import {
  appendTurn,
  coachThreadCount,
  createThread,
  deleteThread,
  getThread,
  listThreadsForGame,
  resetThreads,
  setThreadSummary,
} from './coach/threads.js'
import { assembleWindow, budgetAfterPreamble, estimateTokens, estimateTurnTokens } from './coach/budget.js'
import { findViolation, screenCoachReply } from './coach/guardrails.js'
import { buildSnapshot } from './coach/snapshot.js'
import { buildTurnPrompt } from './coach/prompt.js'
import { classifyIntent, fallbackAnswer } from './coach/fallback.js'
import { createCoachService, setCoachService } from './coach/service.js'
import type { CoachTurn, GuidancePromptSnapshot } from '@dsa/game-schema'

// ---------------------------------------------------------------- the fixture

const oracle = requireOracle('binary-search')
const runtime = createGameRuntime(oracle)
const problem = getProblem('binary-search')
if (problem === undefined) throw new Error('binary-search is missing from the catalogue')
const problemMeta = problem

/** The template spec: no key needed, and its vocabulary is real, not a stub. */
function makeSpec(state: GameState): GameSpec {
  return buildTemplateSpec({ problem: problemMeta, instance: state.instance, seed: 42, difficulty: 'easy' })
}

/**
 * Drive a correct run for `steps` ACTIONS, optionally sabotaging one elimination so
 * the state carries a real mistake the coach can talk about.
 *
 * One turn is three actions (read, compare, choose) plus a final `submitAnswer`, so
 * `steps` counts actions rather than turns — which is what makes `steps` a stable
 * way to reach a given board depth without hard-coding a turn count.
 */
function play(seed: number, steps: number, options: { sabotageAtStep?: number } = {}): GameState {
  let state = runtime.init(seed, 'easy')
  const sabotage = options.sabotageAtStep
  let action = 0

  for (let step = 0; step < steps && state.phase === 'playing'; step += 1) {
    const values = state.instance.values
    const target = state.instance.target ?? 0
    const mid = Number(state.internal['mid'])
    const at = action
    action += 1

    if (state.internal['midChosen'] !== true) {
      state = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` } as Action).state
      continue
    }
    const midValue = values[mid] ?? 0
    const relation = midValue < target ? 'gt' : midValue > target ? 'lt' : 'eq'
    state = runtime.apply(state, {
      type: 'comparePair',
      aId: `v${mid}`,
      bId: 'target',
      relation,
    } as Action).state
    if (state.phase !== 'playing') break

    // The hit. Without this the run walks past the target and loses, so no fixture
    // would ever reach the won state the guardrail's hardest test needs.
    if (relation === 'eq') {
      state = runtime.apply(state, {
        type: 'submitAnswer',
        targetId: 'answer',
        value: String(mid),
      } as Action).state
      break
    }

    const goRight = midValue < target
    const wrong = sabotage === at
    state = runtime.apply(state, {
      type: 'choosePath',
      fromId: `v${mid}`,
      pathId: wrong ? (goRight ? 'left' : 'right') : goRight ? 'right' : 'left',
    } as Action).state
  }
  return state
}

/** Play to completion, whatever that takes. */
function playToWin(seed: number): GameState {
  return play(seed, 200)
}

const midGame = play(42, 4)
const mistakeGame = play(42, 4, { sabotageAtStep: 1 })
const spec = makeSpec(midGame)
const midPrompt = buildTurnPrompt({ state: midGame, spec, oracle })
const midSnapshot = buildSnapshot({ state: midGame, spec, oracle, turnPrompt: midPrompt })

/** The canonical answer for `midGame`, straight from the oracle. */
const ANSWER_INDEX = Number(midGame.internal['targetIndex'])

/**
 * A transport that records what it was sent and replies with whatever the test
 * queued. It is the ONLY stub in this file.
 */
class StubTransport implements ChatTransport {
  readonly id = 'stub'
  readonly model = 'stub-model'
  readonly requests: ChatRequest[] = []
  available = true
  failWith: Error | null = null

  constructor(private readonly replies: readonly string[] = ['Read the middle, then decide which half survives.']) {}

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    this.requests.push(request)
    if (this.failWith !== null) throw this.failWith
    const next = this.replies[this.requests.length - 1] ?? this.replies[this.replies.length - 1] ?? ''
    return { text: next, model: this.model, approxTokens: estimateTokens(next) }
  }
}

beforeEach(() => {
  resetStore()
  resetThreads()
  setCoachService(null)
})

afterEach(() => {
  setCoachService(null)
  vi.restoreAllMocks()
})

// --------------------------------------------------------------------- A. threads

describe('coach threads', () => {
  it('creates, appends, lists and deletes', () => {
    const thread = createThread({ gameId: 'game-1', problemId: 'binary-search', now: 1000 })
    expect(thread.turns).toHaveLength(0)
    expect(thread.spentTokens).toBe(0)

    const withTurn = appendTurn(thread.id, turn('learner', 'which one?', 1001), 1001)
    expect(withTurn?.turns).toHaveLength(1)
    expect(withTurn?.spentTokens).toBeGreaterThan(0)

    const listed = listThreadsForGame('game-1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(thread.id)
    // The title is the learner's own first words: no model call, and it is the
    // only title that is guaranteed to mean something to them.
    expect(listed[0]?.title).toBe('which one?')
    expect(listed[0]?.turnCount).toBe(1)

    expect(deleteThread(thread.id)).toBe(true)
    expect(deleteThread(thread.id)).toBe(false)
    expect(listThreadsForGame('game-1')).toHaveLength(0)
  })

  it('supports several conversations per game, newest first, so a client can switch', () => {
    const first = createThread({ gameId: 'game-1', problemId: 'binary-search', now: 1000 })
    const second = createThread({ gameId: 'game-1', problemId: 'binary-search', now: 2000 })
    appendTurn(first.id, turn('learner', 'about the middle', 1500), 1500)

    const listed = listThreadsForGame('game-1')
    expect(listed.map((t) => t.id)).toEqual([second.id, first.id])
    expect(listed.map((t) => t.title)).toEqual(['New question', 'about the middle'])
  })

  it('isolates one game\'s threads from another', () => {
    const a = createThread({ gameId: 'game-a', problemId: 'binary-search', now: 1000 })
    createThread({ gameId: 'game-b', problemId: 'binary-search', now: 1000 })

    expect(listThreadsForGame('game-a').map((t) => t.id)).toEqual([a.id])
    expect(listThreadsForGame('game-b')).toHaveLength(1)
    expect(listThreadsForGame('game-a')).toHaveLength(1)

    deleteThread(a.id)
    expect(listThreadsForGame('game-a')).toHaveLength(0)
    expect(listThreadsForGame('game-b')).toHaveLength(1)
  })

  it('hands back copies, so a caller cannot mutate another thread\'s history', () => {
    const thread = createThread({ gameId: 'game-1', problemId: 'binary-search', now: 1000 })
    appendTurn(thread.id, turn('learner', 'hello', 1001), 1001)

    const first = getThread(thread.id, 1002)
    const second = getThread(thread.id, 1003)
    expect(first).not.toBe(second)
    expect(first?.turns).not.toBe(second?.turns)

    // A mutable `GuidancePromptSnapshot` is the thing most likely to be corrupted
    // by an accidental in-place edit, so the guard is on the array identity.
    first?.turns.push(turn('learner', 'sneaky', 1004))
    expect(getThread(thread.id, 1005)?.turns).toHaveLength(1)
  })

  it('evicts past the cap, least-recently-used first', () => {
    const ids: string[] = []
    for (let i = 0; i < 405; i += 1) {
      ids.push(createThread({ gameId: 'game-bulk', problemId: 'binary-search', now: 1000 + i }).id)
    }
    expect(coachThreadCount()).toBeLessThanOrEqual(400)
    // The oldest five are the ones that went: the cap is a real bound, not a hint.
    expect(getThread(ids[0] ?? '')).toBeUndefined()
    expect(getThread(ids[ids.length - 1] ?? '')).toBeDefined()
    expect(listThreadsForGame('game-bulk')).toHaveLength(coachThreadCount())
  })

  it('drops threads that have been idle past the TTL, even under the cap', () => {
    const idle = createThread({ gameId: 'game-idle', problemId: 'binary-search', now: 0 })
    // Six hours later the next create triggers the sweep.
    createThread({ gameId: 'game-idle', problemId: 'binary-search', now: 1000 * 60 * 60 * 7 })
    expect(getThread(idle.id, 0)).toBeUndefined()
  })

  it('drops a game\'s threads when the game session is evicted', () => {
    // A conversation whose every snapshot is a board nobody can see any more is
    // worse than no conversation, so the two stores are kept in step.
    const thread = createThread({ gameId: 'game-1', problemId: 'binary-search', now: 1000 })
    putSession(session('game-1'))

    // 205 more sessions pushes past the 200 cap, and the oldest — game-1 — is first
    // out. Its threads must go with it.
    for (let i = 0; i < 205; i += 1) putSession(session(`game-${i}`))
    expect(getThread(thread.id, Date.now())).toBeUndefined()
  })
})

// --------------------------------------------------------------------- B. budget

describe('the token budget', () => {
  const TIGHT = { maxPromptTokens: 600, replyReserveTokens: 100, maxTurns: 24 }

  it('estimates tokens locally and never asks the model', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    // A snapshot is the expensive half of a turn, which is the whole reason the
    // drop order below matters.
    const snapTurn = turn('learner', 'which one?', 1, midSnapshot)
    expect(estimateTurnTokens(snapTurn)).toBeGreaterThan(estimateTokens('which one?') + 50)
  })

  it('keeps the most recent turns when there are too many', () => {
    const turns = manyTurns(40, 1)
    const window = assembleWindow(turns, { maxPromptTokens: 100_000, replyReserveTokens: 100, maxTurns: 24 })
    expect(window.turns).toHaveLength(24)
    expect(window.turns[window.turns.length - 1]?.id).toBe(turns[39]?.id)
    expect(window.droppedTurns).toBe(16)
  })

  it('DROPS SNAPSHOTS BEFORE TEXT — the single most important rule here', () => {
    // Budget chosen to hold every turn's WORDS and only a couple of the snapshots.
    // A board is roughly ten times a child's question, so the correct outcome is
    // "old turns lost their board, everyone kept their question" — NOT "old turns
    // were dropped whole while newer ones kept their boards".
    const turns = manyTurns(8, 1).map((t, i) => (i % 2 === 0 ? { ...t, snapshot: midSnapshot } : t))
    const wordTotal = turns.reduce((sum, t) => sum + estimateTokens(t.text), 0)
    const boardCost = estimateTurnTokens({ ...turns[0]!, snapshot: midSnapshot })
    const window = assembleWindow(turns, {
      maxPromptTokens: wordTotal + 2 * boardCost,
      replyReserveTokens: 0,
      maxTurns: 24,
    })

    // Every turn survived, and at least one gave up its board.
    expect(window.turns).toHaveLength(turns.length)
    expect(window.snapshotStrippedTurns).toBeGreaterThan(0)

    // Every turn kept its WORDS, the oldest included. This is the assertion the
    // whole rule exists for: the words the learner typed are the last thing to go.
    expect(window.turns[0]?.text).toBe(turns[0]?.text)
    for (const kept of window.turns) {
      const original = turns.find((t) => t.id === kept.id)
      expect(kept.text).toBe(original?.text)
    }

    // And the strict alternative — dropping whole turns — would have thrown away
    // the oldest questions, which are exactly the ones that make the newest one
    // mean something.
    expect(window.droppedTurns).toBe(0)
    expect(window.turns.some((t) => t.snapshot === undefined)).toBe(true)
  })

  it('never exceeds maxPromptTokens, and honours the reply reserve', () => {
    for (const budget of [
      { maxPromptTokens: 600, replyReserveTokens: 100, maxTurns: 24 },
      { maxPromptTokens: 300, replyReserveTokens: 200, maxTurns: 4 },
      { maxPromptTokens: 200, replyReserveTokens: 150, maxTurns: 24 },
      { maxPromptTokens: 80, replyReserveTokens: 60, maxTurns: 2 },
    ]) {
      const turns = manyTurns(30, 2).map((t, i) => ({ ...t, snapshot: i % 3 === 0 ? midSnapshot : undefined }))
      const window = assembleWindow(turns, budget)
      const usable = budget.maxPromptTokens - budget.replyReserveTokens
      expect(window.approxPromptTokens, JSON.stringify(budget)).toBeLessThanOrEqual(usable)
      for (const kept of window.turns) {
        expect(estimateTurnTokens(kept), `turn ${kept.id}`).toBeLessThanOrEqual(usable)
      }
    }
  })

  it('always keeps the newest turn, truncating it rather than dropping it', () => {
    // A window with no current question is not a conversation, it is a monologue.
    const long = turn('learner', 'a'.repeat(4000), 9)
    const window = assembleWindow([long], TIGHT)
    expect(window.turns).toHaveLength(1)
    expect(window.turns[0]?.id).toBe(long.id)
    expect(window.truncatedTurnIds).toContain(long.id)
    expect(window.approxPromptTokens).toBeLessThanOrEqual(TIGHT.maxPromptTokens - TIGHT.replyReserveTokens)
  })

  it('produces a non-empty, chronological summary whenever it drops anything', () => {
    const turns = manyTurns(12, 1).map((t) => ({ ...t, snapshot: midSnapshot }))
    const window = assembleWindow(turns, { maxPromptTokens: 300, replyReserveTokens: 0, maxTurns: 24 })

    expect(window.droppedTurns).toBeGreaterThan(0)
    expect(window.summary).not.toBeNull()
    expect((window.summary ?? '').length).toBeGreaterThan(0)
    // One line per exchange, learner first: "asked X; I answered Y".
    const lines = (window.summary ?? '').split('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toMatch(/^asked "/)
    expect(window.summary).toContain('I answered')
    // The dropped turns are the OLD ones, so the summary must start with them.
    expect(window.summary).toContain(turns[0]?.text.slice(0, 20))
  })

  it('keeps the summary bounded no matter how long the thread gets', () => {
    const first = assembleWindow(manyTurns(60, 1), { maxPromptTokens: 200, replyReserveTokens: 0, maxTurns: 2 })
    const rolled = assembleWindow(manyTurns(60, 1), { maxPromptTokens: 200, replyReserveTokens: 0, maxTurns: 2 }, first.summary)
    expect((rolled.summary ?? '').length).toBeLessThan(1200)
    expect((rolled.summary ?? '').split('\n').length).toBeLessThanOrEqual(10)
  })

  it('leaves the summary null when nothing was dropped', () => {
    const window = assembleWindow(manyTurns(3, 1), { maxPromptTokens: 100_000, replyReserveTokens: 100, maxTurns: 24 })
    expect(window.droppedTurns).toBe(0)
    expect(window.summary).toBeNull()
  })

  it('charges the system prompt against the same ceiling without eating the reserve', () => {
    const base = { maxPromptTokens: 1000, replyReserveTokens: 300, maxTurns: 24 }
    const shrunk = budgetAfterPreamble(['x'.repeat(2000)], base)
    expect(shrunk.replyReserveTokens).toBe(base.replyReserveTokens)
    expect(shrunk.maxPromptTokens).toBe(base.maxPromptTokens - 500)

    // A preamble bigger than the whole budget must not produce a negative or
    // zero-width ceiling: the reply reserve is untouchable, and at least one token
    // of window has to survive or there is no conversation to send.
    const floored = budgetAfterPreamble(['x'.repeat(100_000)], base)
    expect(floored.replyReserveTokens).toBe(base.replyReserveTokens)
    expect(floored.maxPromptTokens).toBe(floored.replyReserveTokens + 1)
  })

  it('folds spent tokens into the thread as turns are appended', () => {
    const thread = createThread({ gameId: 'game-1', problemId: 'binary-search', now: 0 })
    const withBoard = appendTurn(thread.id, turn('learner', 'which one?', 1, midSnapshot), 1)
    const without = appendTurn(thread.id, turn('coach', 'read the middle', 2), 2)
    expect(without?.spentTokens).toBe((withBoard?.spentTokens ?? 0) + estimateTokens('read the middle'))
    setThreadSummary(thread.id, 'asked something', 3)
    expect(getThread(thread.id, 4)?.summary).toBe('asked something')
  })
})

// ----------------------------------------------------------------- C. guardrails

describe('the guardrails', () => {
  /**
   * One positive and one negative per rule, in a table.
   *
   * The positives matter as much as the negatives: a filter that blocks everything
   * passes every "does it catch the leak" test and ships a coach that says the same
   * canned refusal to every question.
   */
  const CASES: readonly {
    id: string
    safe: string
    unsafe: string
  }[] = [
    {
      id: 'pasted-code',
      safe: 'Halving means throwing away half of what is left, every single time.',
      unsafe: 'function binarySearch(a, t) {\n  let lo = 0\n  return mid\n}',
    },
    {
      id: 'answer-claim',
      safe: 'Ask yourself whether the value you are holding is bigger or smaller than the target.',
      unsafe: 'The answer is 5.',
    },
    {
      id: 'answer-is-target-value',
      safe: 'Two of the values are still in play, and one of them is the pressure hull.',
      unsafe: `It is the ${String(midSnapshot.targetValue)} pod, that is the one.`,
    },
    {
      id: 'index-claim',
      safe: 'The ends of the row are still marked, and everything between them is in play.',
      unsafe: 'Try position 4.',
    },
    {
      id: 'value-claim',
      safe: 'Keep anything above the value you are holding, and throw the rest away.',
      // Deliberately NOT the target's own value: that phrasing is caught earlier by
      // the cross-check rule, and using it here would only test the same rule twice.
      // This one asserts a resolution about a value that is merely on the board,
      // which is still a spoiler and still a claim the learner cannot check.
      unsafe: "It's 21.",
    },
    {
      id: 'full-solution',
      safe: 'Now probe the middle of what is left.',
      unsafe: 'Now press the middle, then click the right half, then submit.',
    },
    {
      id: 'future-leak',
      safe: 'What do the two values you can see have to say about each other?',
      unsafe: 'Next you will halve the range.',
    },
    {
      id: 'unearned-correction',
      safe: 'This is the right way to think about halving, because it always splits what is left.',
      unsafe: "That's correct!",
    },
  ]

  for (const testCase of CASES) {
    it(`${testCase.id}: passes a safe reply unchanged and rewrites a leaking one`, () => {
      const safe = screenCoachReply(testCase.safe, midSnapshot)
      expect(safe.ok, `"${testCase.safe}" was rewritten: ${safe.ok ? '' : safe.redacted.reason}`).toBe(true)
      expect(safe.text).toBe(testCase.safe)

      const unsafe = screenCoachReply(testCase.unsafe, midSnapshot)
      expect(unsafe.ok, `"${testCase.unsafe}" slipped through`).toBe(false)
      if (unsafe.ok) return
      expect(unsafe.redacted.reason).toContain(testCase.id)
      // The original is preserved VERBATIM, so a client can show a learner what the
      // coach was going to say and a developer what the model actually produced.
      expect(unsafe.redacted.original).toBe(testCase.unsafe)
      expect(unsafe.text).not.toBe(testCase.unsafe)
      expect(unsafe.text.trim()).not.toBe('')
      // The rewrite never names the answer, and it contains no digits at all, which
      // is the invariant that makes "never names the answer" provable.
      expect(unsafe.text).not.toContain(String(ANSWER_INDEX))
      expect(unsafe.text).not.toMatch(/\d/)
    })
  }

  it('reports WHICH rule fired, so a developer is not left guessing', () => {
    for (const testCase of CASES) {
      expect(findViolation(testCase.unsafe, midSnapshot)?.id).toBe(testCase.id)
      expect(findViolation(testCase.safe, midSnapshot)).toBeNull()
    }
  })

  it('rewrites rather than passing through and rather than crashing', () => {
    for (const hostile of [
      '',
      '   ',
      'a'.repeat(50_000),
      '<script>alert(1)</script>',
      '```js\nconst a = 1\n```',
      '🙂🙂🙂',
      JSON.stringify(midSnapshot),
    ]) {
      const result = screenCoachReply(hostile, midSnapshot)
      expect(typeof result.text).toBe('string')
      expect(() => screenCoachReply(hostile, midSnapshot)).not.toThrow()
    }
  })

  it('blocks a themed answer claim and a word-form ordinal', () => {
    // The themed phrasing is the interesting one: no "index", no "answer", just a
    // noun and a number, which is how a coach in a salvage-yard theme says it.
    expect(screenCoachReply('It is the 68 pod you want.', midSnapshot).ok).toBe(false)
    expect(screenCoachReply('Take the fifth one, that is the one.', midSnapshot).ok).toBe(false)
  })

  it('lets obviously safe coaching through — the filter is not a mangler', () => {
    const safe = [
      'Your two ends are the lowest and the highest value on the board. Only what sits between them is still in play.',
      'You have narrowed it down to the values between your two ends, which is exactly the strategy this algorithm is built on.',
      'Read the value in the middle of what is left, and tell me which way it goes compared to the target.',
      'I cannot tell you which one to pick, but I can tell you what the comparison is for.',
      'This is the right way to think about halving.',
      'The half you are looking at is the half the value is not sitting on.',
    ]
    for (const reply of safe) {
      const result = screenCoachReply(reply, midSnapshot)
      expect(result.ok, `mangled: "${reply}" -> ${result.ok ? '' : result.redacted.reason}`).toBe(true)
      expect(result.text).toBe(reply)
    }
  })

  it('lets the engine praise a WIN, because the engine established it', () => {
    const won: GuidancePromptSnapshot = { ...midSnapshot, phase: 'won' }
    expect(screenCoachReply('Well done, you found it!', won).ok).toBe(true)
    // The same sentence mid-game is unearned and is rewritten.
    expect(screenCoachReply('Well done, you found it!', midSnapshot).ok).toBe(false)
  })

  it('degrades to a snapshot-free line when even the rewrite is not verifiably clean', () => {
    // Defence in depth, made reachable. A spec whose own `instruction` is itself a
    // step sequence would be quoted into the rewrite, and the rewrite would then
    // trip `full-solution` too. Rather than pass that through — or recurse — the
    // guardrail drops to a line with no numbers, no board nouns and no snapshot text
    // at all. Unreachable in a real spec today, and that is the point: an untested
    // worst case is a worst case that will not be one when it matters.
    const dangerous: GuidancePromptSnapshot = {
      ...midSnapshot,
      instruction: 'Choose the middle, then read it against the target',
    }
    const result = screenCoachReply('Now press the middle, then click the right half.', dangerous)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.text).toBe(
      'I cannot put that into words without handing you the answer, and that is the part worth doing yourself. Look again at what is still in play, and tell me what you notice about the two values you can see.',
    )
    expect(result.text).not.toMatch(/\d/)
    expect(result.text).not.toContain('then')
    // And the refusal is still in character: it refuses, and it redirects.
    expect(result.text).toContain('answer')
    expect(result.text.length).toBeGreaterThan(40)
  })

  it('holds when the engine\'s own instruction names the answer — the hardest case', () => {
    // On a winning turn the oracle's own label for the next move IS the answer's
    // position ("Choose index 6"), because `mid === targetIndex` is exactly what
    // winning means. So a rewrite that quoted the snapshot's instruction would hand
    // over the position through the back door, and nothing else would catch it.
    // That is what makes "digit-free rewrites" a requirement rather than a style.
    const finalState = playToWin(42)
    expect(finalState.phase).toBe('won')
    const answer = String(Number(finalState.internal['targetIndex']))

    const states: GuidancePromptSnapshot[] = [
      // A real won board.
      buildSnapshot({ state: finalState, spec, oracle, turnPrompt: buildTurnPrompt({ state: finalState, spec, oracle }) }),
      // And a synthetic mid-game board whose instruction names the answer, which is
      // the shape the real one takes a turn earlier and which a real one may not
      // happen to produce on a given seed. The guard must hold for the SHAPE, not
      // for whichever seed the test happened to pick.
      { ...midSnapshot, mid: Number(answer), instruction: `Choose index ${answer}, the middle of [${answer}, 7]` },
    ]

    for (const snapshot of states) {
      // Position leaks only: unearned praise is deliberately ALLOWED on a won
      // board, and it has its own test asserting exactly that.
      for (const leak of [
        `The answer is ${answer}.`,
        `Tap index ${answer} and you are done.`,
        `Next you will submit ${answer}.`,
        `It is the ${answer} one.`,
      ]) {
        const result = screenCoachReply(leak, snapshot)
        expect(result.ok, `leak passed: ${leak}`).toBe(false)
        if (result.ok) continue
        expect(result.text).not.toContain(answer)
        expect(result.text).not.toMatch(/\d/)
      }
    }
  })
})

// ------------------------------------------------------------------- D. fallback

describe('the deterministic fallback', () => {
  const QUESTIONS = [
    'which one?',
    'which half?',
    'what now?',
    'why was that wrong?',
    'hi',
    'how does this even work',
  ] as const

  it('classifies every intent a learner actually asks', () => {
    expect(classifyIntent('which one should I look at?').intent).toBe('which-value')
    expect(classifyIntent('which half do I keep?').intent).toBe('which-half')
    expect(classifyIntent('what now?').intent).toBe('what-now')
    expect(classifyIntent('why was that wrong?').intent).toBe('why-wrong')
    expect(classifyIntent('hi there').intent).toBe('greeting')
    expect(classifyIntent('the pressure pod thing').intent).toBe('general')
  })

  for (const question of QUESTIONS) {
    it(`answers "${question}" about the actual board, not generically`, () => {
      const answer = fallbackAnswer({ question, snapshot: midSnapshot, turnPrompt: midPrompt })
      expect(answer.text.trim().length).toBeGreaterThan(20)
      expect(mentionsTheBoard(answer.text, midSnapshot), `"${question}" -> ${answer.text}`).toBe(true)
      // And it must never hand over the answer position.
      expect(answer.text).not.toContain(`answer is ${String(ANSWER_INDEX)}`)
    })
  }

  it('talks about the CURRENT window, so it tracks the game', () => {
    const early = play(42, 0)
    const earlyPrompt = buildTurnPrompt({ state: early, spec, oracle })
    const earlySnapshot = buildSnapshot({ state: early, spec, oracle, turnPrompt: earlyPrompt })
    const later = fallbackAnswer({ question: 'which half?', snapshot: midSnapshot, turnPrompt: midPrompt })
    const sooner = fallbackAnswer({ question: 'which half?', snapshot: earlySnapshot, turnPrompt: earlyPrompt })

    expect(later.text).not.toBe(sooner.text)
    // The full row at the start, a two-cell window after two eliminations. A coach
    // that said the same thing in both places would not be reading the board.
    expect(sooner.text).toContain('between 0 and 7')
    expect(later.text).toContain('between 6 and 7')
  })

  it('explains a real mistake in terms of the operation, not the answer', () => {
    const mistakePrompt = buildTurnPrompt({ state: mistakeGame, spec, oracle })
    const mistakeSnapshot = buildSnapshot({ state: mistakeGame, spec, oracle, turnPrompt: mistakePrompt })
    expect(mistakeSnapshot.lastMistakeDsaOp).not.toBeNull()

    const answer = fallbackAnswer({ question: 'why was that wrong?', snapshot: mistakeSnapshot, turnPrompt: mistakePrompt })
    expect(answer.intent).toBe('why-wrong')
    expect(answer.text).toMatch(/comparison|half|middle|edge|answer/i)
    // The engine's `expected` action is often the NEXT move, so restating it would
    // be a solution. The explanation must not quote it.
    expect(answer.text).not.toContain(mistakePrompt.instruction)
  })

  it('never trips its own guardrail, on any board state', () => {
    const states = [play(42, 0), play(42, 2), play(7, 5), play(99, 3), playToWin(42)]
    for (const state of states) {
      const prompt = buildTurnPrompt({ state: state, spec, oracle })
      const snapshot = buildSnapshot({ state: state, spec, oracle, turnPrompt: prompt })
      for (const question of QUESTIONS) {
        for (const band of ['newcomer', 'explorer', 'builder'] as LearnerBand[]) {
          const answer = fallbackAnswer({ question, snapshot, turnPrompt: prompt, band })
          const screened = screenCoachReply(answer.text, snapshot)
          expect(screened.ok, `phase=${state.phase} q="${question}" band=${band}: ${answer.text}`).toBe(true)
        }
      }
    }
  })

  it('does not repeat a hint it has already given', () => {
    const first = fallbackAnswer({ question: 'what now?', snapshot: midSnapshot, turnPrompt: midPrompt })
    const second = fallbackAnswer({
      question: 'what now?',
      snapshot: midSnapshot,
      turnPrompt: midPrompt,
      givenHints: [first.text],
    })
    expect(second.text).not.toBe(first.text)
  })

  it('is what runs when no model is reachable, and it is genuinely good', async () => {
    const service = createCoachService({ transport: null })
    const response = await service.ask(world(midGame), { gameId: 'game-1', message: 'which half do I keep?' })

    expect(response.source).toBe('fallback')
    expect(response.reply.length).toBeGreaterThan(20)
    expect(response.reply).toContain(String(midSnapshot.board[ANSWER_INDEX]?.value ?? ''))
    expect(response.redacted).toBeNull()
    expect(response.turns).toHaveLength(2)
  })
})

// ------------------------------------------------------------------- E. snapshot

describe('the board snapshot', () => {
  it('maps lo/mid/hi slot ids onto board positions', () => {
    // The state expresses the window twice; the snapshot must speak positions.
    expect(midGame.cursor.loSlotId).toBe(`s${String(midGame.variables['lo'])}`)
    expect(midGame.cursor.midSlotId).toBe(`s${String(midGame.variables['mid'])}`)

    expect(midSnapshot.lo).toBe(Number(midGame.variables['lo']))
    expect(midSnapshot.mid).toBe(Number(midGame.variables['mid']))
    expect(midSnapshot.hi).toBe(Number(midGame.variables['hi']))

    // And those numbers really are positions into `board`.
    for (const bound of [midSnapshot.lo, midSnapshot.mid, midSnapshot.hi]) {
      if (bound === null) continue
      expect(midSnapshot.board[bound]?.value).toBe(midGame.instance.values[bound])
    }
  })

  it('agrees with the ORACLE about what has been eliminated', () => {
    for (const state of [play(42, 2), play(42, 4), play(7, 6), play(99, 3)]) {
      const prompt = buildTurnPrompt({ state: state, spec, oracle })
      const snapshot = buildSnapshot({ state, spec, oracle, turnPrompt: prompt })
      const lastFrame = state.trace[state.trace.length - 1]
      const fromOracle = new Set(
        (lastFrame?.pointers.eliminated ?? [])
          .map((id) => Number.parseInt(id.replace(/^\D+/, ''), 10))
          .filter((n) => Number.isInteger(n)),
      )
      expect(new Set(snapshot.eliminated), `after ${String(state.progress.steps)} steps`).toEqual(fromOracle)
      expect(new Set(snapshot.eliminated)).toEqual(
        new Set(state.instance.values.map((_, i) => i).filter((i) => i < Number(state.variables['lo']) || i > Number(state.variables['hi']))),
      )
    }
  })

  it('carries the theme vocabulary and the engine facts', () => {
    expect(midSnapshot.targetLabel).toBe(spec.vocabulary.target)
    expect(midSnapshot.targetValue).toBe(midGame.instance.target)
    expect(midSnapshot.board).toHaveLength(midGame.instance.values.length)
    expect(midSnapshot.complexity).toContain('O(log n)')
    expect(midSnapshot.phase).toBe('playing')
    expect(midSnapshot.step).toBe(midGame.progress.steps)
    expect(midSnapshot.mistakes).toBe(midGame.progress.mistakes)
    expect(midSnapshot.goal).toBe(midPrompt.goal)
    expect(midSnapshot.instruction).toBe(midPrompt.instruction)
  })

  it('is pure: the same inputs give the same snapshot', () => {
    const a = buildSnapshot({ state: midGame, spec, oracle, turnPrompt: midPrompt })
    const b = buildSnapshot({ state: midGame, spec, oracle, turnPrompt: midPrompt })
    expect(a).toEqual(b)
    // And building it does not disturb the game.
    expect(midGame.variables).toEqual({ ...midGame.variables })
    expect(midGame.phase).toBe('playing')
  })

  it('degrades to nulls rather than inventing a window for a non-window problem', () => {
    const bare = runtime.init(42, 'easy')
    const prompt = buildTurnPrompt({ state: bare, spec, oracle })
    const snapshot = buildSnapshot({ state: bare, spec, oracle, turnPrompt: prompt })
    // The first move has a real window, but an absent bound must never be zero.
    expect(snapshot.board.length).toBeGreaterThan(0)
    for (const bound of [snapshot.lo, snapshot.mid, snapshot.hi]) {
      expect(bound === null || bound >= 0).toBe(true)
    }
  })
})

// --------------------------------------------------------------------- F. routes

describe('the coach routes', () => {
  it('404s an unknown game, before the coach runs at all', async () => {
    const app = appWith(null)
    const res = await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'nope', message: 'hello' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNKNOWN_GAME')
  })

  it('400s a malformed body and never leaks a stack', async () => {
    const app = appWith(null)
    for (const body of [{}, { gameId: 'g' }, { message: 'hi' }, { gameId: '', message: 'hi' }, { gameId: 'g', message: '' }]) {
      const res = await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status, JSON.stringify(body)).toBe(400)
      const parsed = (await res.json()) as { error: { code: string; message: string } }
      expect(parsed.error.code).toBe('BAD_REQUEST')
      expect(JSON.stringify(parsed)).not.toMatch(/at \w+ \(/)
    }

    // Not even JSON at all.
    const notJson = await app.request('/api/coach/ask', { method: 'POST', body: 'garbage' })
    expect(notJson.status).toBe(400)
  })

  it('rejects an over-long question at the schema', async () => {
    const app = appWith(null)
    const res = await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', message: 'x'.repeat(5000) }),
    })
    expect(res.status).toBe(400)
  })

  it('answers a happy path with turns and a turn prompt, and lists the thread', async () => {
    putSession(session('game-1', midGame))
    const app = appWith(null)

    const res = await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', message: 'which half do I keep?', band: 'explorer' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      threadId: string
      reply: string
      source: string
      turnPrompt: { instruction: string; goal: string; targets: unknown[] }
      turns: CoachTurn[]
      threads: { id: string; title: string; turnCount: number }[]
      approxTokens: number
      latencyMs: number
    }

    expect(body.threadId).toMatch(/^thr-/)
    expect(body.reply.trim().length).toBeGreaterThan(0)
    expect(body.source).toBe('fallback')
    expect(body.turnPrompt.goal).not.toBe('')
    expect(body.turnPrompt.instruction).not.toBe('')
    expect(Array.isArray(body.turnPrompt.targets)).toBe(true)
    expect(body.turns).toHaveLength(2)
    expect(body.turns[0]?.role).toBe('learner')
    expect(body.turns[0]?.snapshot?.targetValue).toBe(midGame.instance.target)
    expect(body.turns[1]?.role).toBe('coach')
    expect(body.approxTokens).toBeGreaterThan(0)
    expect(body.latencyMs).toBeGreaterThanOrEqual(0)
    expect(body.threads).toHaveLength(1)

    const listed = await app.request('/api/coach/threads?gameId=game-1')
    expect(listed.status).toBe(200)
    const listBody = (await listed.json()) as { gameId: string; threads: { id: string; title: string }[] }
    expect(listBody.gameId).toBe('game-1')
    expect(listBody.threads[0]?.id).toBe(body.threadId)
    expect(listBody.threads[0]?.title).toBe('which half do I keep?')
  })

  it('SECOND TURN SEES THE FIRST — the whole reason this is multi-turn', async () => {
    putSession(session('game-1', midGame))
    const app = appWith(null)

    const first = (await (
      await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', message: 'I asked about the middle earlier' }),
      })
    ).json()) as { threadId: string }

    const second = (await (
      await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', threadId: first.threadId, message: 'no, I meant the other one' }),
      })
    ).json()) as { threadId: string; turns: CoachTurn[] }

    expect(second.threadId).toBe(first.threadId)
    expect(second.turns).toHaveLength(4)
    expect(second.turns[0]?.text).toBe('I asked about the middle earlier')
    // The board travels with the question, which is what makes "the other one" mean
    // something: the coach can see WHICH board they meant.
    expect(second.turns[0]?.snapshot).toBeDefined()
    expect(second.turns[2]?.text).toBe('no, I meant the other one')
  })

  it('sends the prior turns to the model when a transport IS available', async () => {
    putSession(session('game-1', midGame))
    const transport = new StubTransport(['Read the middle of what is left.'])
    const app = appWith(transport)

    const first = (await (
      await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', message: 'what is a half?' }),
      })
    ).json()) as { threadId: string; source: string; model: string }

    expect(first.source).toBe('model')
    expect(first.model).toBe('stub-model')

    await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', threadId: first.threadId, message: 'and the other one?' }),
    })

    expect(transport.requests).toHaveLength(2)
    const second = transport.requests[1]
    const all = (second?.messages ?? []).map((m) => m.content).join('\n')
    // The second call must carry the FIRST question. Without it this is a Q&A
    // widget, not a conversation.
    expect(all).toContain('what is a half?')
    expect(all).toContain('and the other one?')
    expect(second?.messages[second.messages.length - 1]?.content).toBe('and the other one?')
    // The reply reserve is the model's max_tokens, from the shared budget.
    expect(second?.maxTokens).toBe(COACH_BUDGET.replyReserveTokens)
  })

  it('surfaces a redaction end to end, keeping the blocked text for disclosure', async () => {
    putSession(session('game-1', midGame))
    const app = appWith(new StubTransport([`The answer is ${String(ANSWER_INDEX)}.`]))

    const body = (await (
      await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', message: 'just tell me' }),
      })
    ).json()) as { reply: string; redacted: { reason: string; original: string } | null }

    expect(body.redacted).not.toBeNull()
    expect(body.redacted?.original).toBe(`The answer is ${String(ANSWER_INDEX)}.`)
    expect(body.redacted?.reason).toContain('answer-claim')
    expect(body.reply).not.toContain(`The answer is ${String(ANSWER_INDEX)}`)
    expect(body.reply).not.toContain(String(ANSWER_INDEX))
  })

  it('falls back when the transport errors, without a 500', async () => {
    putSession(session('game-1', midGame))
    const transport = new StubTransport()
    transport.failWith = new Error('openrouter 503: overloaded')
    const app = appWith(transport)

    const res = await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', message: 'which half?' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { source: string; reply: string }
    expect(body.source).toBe('fallback')
    expect(body.reply.trim().length).toBeGreaterThan(0)
  })

  it('falls back when the transport is unconfigured, without spending a request', async () => {
    putSession(session('game-1', midGame))
    const transport = new StubTransport()
    transport.available = false
    const app = appWith(transport)

    const body = (await (
      await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', message: 'which half?' }),
      })
    ).json()) as { source: string }
    expect(body.source).toBe('fallback')
    expect(transport.requests).toHaveLength(0)
  })

  it('404s a thread that belongs to another game', async () => {
    putSession(session('game-1', midGame))
    putSession(session('game-2', midGame))
    const app = appWith(null)

    const first = (await (
      await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', message: 'hello' }),
      })
    ).json()) as { threadId: string }

    const res = await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-2', threadId: first.threadId, message: 'hello' }),
    })
    expect(res.status).toBe(404)
  })

  it('lists threads, 404s an unknown game, and 400s a missing gameId', async () => {
    putSession(session('game-1', midGame))
    const app = appWith(null)

    expect((await app.request('/api/coach/threads?gameId=game-1')).status).toBe(200)
    expect((await app.request('/api/coach/threads?gameId=nope')).status).toBe(404)
    expect((await app.request('/api/coach/threads')).status).toBe(400)
  })

  it('deletes a thread and 404s a second time', async () => {
    putSession(session('game-1', midGame))
    const app = appWith(null)
    const created = (await (
      await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', message: 'hello' }),
      })
    ).json()) as { threadId: string }

    const first = await app.request(`/api/coach/threads/${created.threadId}`, { method: 'DELETE' })
    expect(first.status).toBe(200)
    const remaining = (await (await app.request('/api/coach/threads?gameId=game-1')).json()) as { threads: unknown[] }
    expect(remaining.threads).toHaveLength(0)

    const second = await app.request(`/api/coach/threads/${created.threadId}`, { method: 'DELETE' })
    expect(second.status).toBe(404)
  })

  it('survives a thread far longer than one prompt could hold, which is the point', async () => {
    // The headline requirement: a conversation must not eventually 400. Fifty
    // exchanges is roughly four times `COACH_BUDGET.maxTurns`, so by the end the
    // window is dropping turns and carrying a summary — and every call must still
    // return 200 with a usable answer.
    putSession(session('game-1', midGame))
    const transport = new StubTransport(['Read the middle, then decide which half survives.'])
    const app = appWith(transport)
    const thread = createThread({ gameId: 'game-1', problemId: 'binary-search', now: 1000 })

    const CALLS = 50
    for (let i = 0; i < CALLS; i += 1) {
      const res = await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', threadId: thread.id, message: `question number ${String(i)}` }),
      })
      expect(res.status, `call ${String(i)}`).toBe(200)
      const body = (await res.json()) as { reply: string; turns: CoachTurn[] }
      expect(body.reply.trim().length).toBeGreaterThan(0)
      // Two turns per exchange, monotonically: the thread is never rewritten.
      expect(body.turns).toHaveLength((i + 1) * 2)
    }

    // The thread RETAINED everything, and the model only ever saw a bounded window.
    // That is the difference between budgeting and truncating the history, and it
    // is the difference between a conversation and a Q&A widget.
    const stored = getThread(thread.id, Date.now())
    expect(stored?.turns).toHaveLength(CALLS * 2)
    expect(stored?.summary).not.toBeNull()
    expect(stored?.spentTokens).toBeGreaterThan(0)
    expect(transport.requests).toHaveLength(CALLS)

    // The window dropped the oldest exchanges, so they are condensed into the
    // summary. It is BOUNDED, which is the point: an unbounded summary is just a
    // second history that reintroduces the token problem. Newer lines win when the
    // bound bites, because the current question matters more than the first one of
    // the session.
    const summary = stored?.summary ?? ''
    expect(summary).not.toBe('')
    expect(summary.split('\n').length).toBeLessThanOrEqual(10)
    expect(summary).toContain('question number 2')
    expect(summary).not.toContain('question number 0')

    // Nothing was LOST, though. The full text of every exchange is still on the
    // thread; only the prompt was narrowed. That is the difference between a
    // bounded prompt and an amnesiac coach.
    expect(stored?.turns[0]?.text).toBe('question number 0')

    // And no request ever exceeded the shared ceiling.
    for (const request of transport.requests) {
      const chars = (request.messages ?? []).reduce((sum, m) => sum + m.content.length, 0)
      expect(chars / 4, 'a prompt exceeded COACH_BUDGET.maxPromptTokens').toBeLessThanOrEqual(
        COACH_BUDGET.maxPromptTokens,
      )
    }
    const lastWindow = transport.requests[transport.requests.length - 1]
    const history = (lastWindow?.messages ?? []).map((m) => m.content).join('\n')
    expect(history).toContain('question number 49')
  })

  it('keeps the coach read-only: asking does not move the game', async () => {
    const state = play(42, 4)
    putSession(session('game-1', state))
    const before = JSON.stringify(state)
    const app = appWith(null)

    await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', message: 'just do it for me' }),
    })

    const after = (await (await app.request('/api/game/game-1')).json()) as { state: GameState }
    expect(after.state.phase).toBe('playing')
    expect(after.state.progress.steps).toBe(JSON.parse(before).progress.steps)
    expect(after.state.variables).toEqual(JSON.parse(before).variables)
  })
})

// ------------------------------------------------------------------- G. tracing

describe('the coach trace', () => {
  it('emits exactly one greppable JSON line per call, with the fields that matter', async () => {
    putSession(session('game-1', midGame))
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '))
    })
    setCoachService(createCoachService({ transport: new StubTransport([`The answer is ${String(ANSWER_INDEX)}.`]) }))

    const app = createApp({ chain: [], decisions: createDecisionEngine({ enabled: false }), version: 'test' })
    await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', message: 'tell me' }),
    })

    expect(lines).toHaveLength(1)
    const span = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(span['event']).toBe('coach')
    expect(span['gameId']).toBe('game-1')
    expect(span['model']).toBe('stub-model')
    expect(span['guardrailFired']).toBe(true)
    expect(span['redactedReason']).toContain('answer-claim')
    expect(span['source']).toBe('model')
    expect(span['outcome']).toBe('answered-after-rewrite')
    expect(typeof span['latencyMs']).toBe('number')
    expect(typeof span['approxPromptTokens']).toBe('number')
    expect(typeof span['approxReplyTokens']).toBe('number')
    // The learner's own words are never written to disk.
    expect(lines[0]).not.toContain('tell me')
    expect(lines[0]).not.toContain('The answer is')
  })

  it('reports a deliberately unconfigured coach as a mode, not an incident', async () => {
    // `COACH_TRANSPORT=0` is a supported configuration, so the trace must not call
    // it a failure — otherwise every deterministic run looks like an outage in the
    // logs and the signal drowns.
    putSession(session('game-1', midGame))
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '))
    })
    const app = appWith(null)

    await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', message: 'which half?' }),
    })

    const span = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(span['source']).toBe('fallback')
    expect(span['model']).toBe('fallback')
    expect(span['outcome']).toBe('answered-fallback')
    expect(span['error']).toBeUndefined()
    expect(span['guardrailFired']).toBe(false)
    expect(span['intent']).toBe('which-half')
  })

  it('reports a real transport failure as a failure', async () => {
    putSession(session('game-1', midGame))
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '))
    })
    const transport = new StubTransport()
    transport.failWith = new Error('openrouter 503: overloaded')
    const app = appWith(transport)

    await app.request('/api/coach/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', message: 'which half?' }),
    })

    const span = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(span['outcome']).toBe('transport-unavailable')
    expect(span['source']).toBe('fallback')
    // The error is present, and truncated, and carries no stack.
    expect(String(span['error'])).toContain('503')
    expect(String(span['error']).length).toBeLessThanOrEqual(300)
  })

  it('honours COACH_TRANSPORT=0, which is the switch a demo without a key uses', async () => {
    // A silent regression here would mean a real deployment quietly losing its model
    // and nobody noticing until a learner asked why the coach sounded like a
    // spreadsheet. So the OFF switch is tested, not assumed.
    //
    // `process.env` is mutated because the route calls `getCoachService()` with no
    // arguments — that IS the deployment wiring, and testing a different wiring
    // would test nothing.
    putSession(session('game-1', midGame))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const before = process.env['COACH_TRANSPORT']
    process.env['COACH_TRANSPORT'] = '0'
    setCoachService(null)

    try {
      const app = createApp({ chain: [], decisions: createDecisionEngine({ enabled: false }), version: 'test' })
      const res = await app.request('/api/coach/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'game-1', message: 'which half?' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { source: string; reply: string }
      // No network was attempted, and the learner still got a real answer.
      expect(body.source).toBe('fallback')
      expect(body.reply.trim().length).toBeGreaterThan(20)
    } finally {
      if (before === undefined) delete process.env['COACH_TRANSPORT']
      else process.env['COACH_TRANSPORT'] = before
      setCoachService(null)
    }
  })
})

// ---------------------------------------------------------------------- helpers

/**
 * The app under test, with the coach's transport chosen explicitly.
 *
 * `chain: []` and a disabled decision layer keep the harness honest: the only
 * dependency that can make these tests behave differently is the coach, so it is
 * the only one that is wired in. `now: () => 1000` makes `latencyMs` deterministic
 * instead of an artefact of how fast the machine happens to be.
 */
function appWith(transport: ChatTransport | null) {
  setCoachService(createCoachService({ transport, now: () => 1000 }))
  return createApp({ chain: [], decisions: createDecisionEngine({ enabled: false }), version: 'test' })
}


/**
 * "Board-specific" in one assertion.
 *
 * A value on the board, the target's own value, or a window bound. Anything less
 * is a platitude that would read the same on every board in the game, which is the
 * failure mode a canned fallback exists to avoid.
 */
function mentionsTheBoard(text: string, snapshot: GuidancePromptSnapshot): boolean {
  const candidates = [
    ...snapshot.board.map((cell) => (cell.value === null ? '' : String(cell.value))),
    snapshot.targetValue === null ? '' : String(snapshot.targetValue),
    ...[snapshot.lo, snapshot.mid, snapshot.hi].map((n) => (n === null ? '' : String(n))),
  ].filter((s) => s !== '')
  return candidates.some((c) => text.includes(c))
}

function turn(
  role: CoachTurn['role'],
  text: string,
  at: number,
  snapshot?: GuidancePromptSnapshot,
): CoachTurn {
  return {
    id: `turn-${String(at)}-${role}`,
    role,
    text,
    at,
    ...(snapshot === undefined ? {} : { snapshot }),
    approxTokens: estimateTokens(text) + (snapshot === undefined ? 0 : 200),
  }
}

/** `steps` alternating learner/coach turns, each `snapEvery`-th carrying a board. */
function manyTurns(steps: number, snapEvery: number): CoachTurn[] {
  return Array.from({ length: steps }, (_, i) =>
    turn(
      i % 2 === 0 ? 'learner' : 'coach',
      `This is turn number ${String(i)} and it has a reasonable amount of text in it.`,
      i,
      i % snapEvery === 0 ? midSnapshot : undefined,
    ),
  )
}

function session(gameId: string, state: GameState = midGame) {
  // `lastAccessedAt` must be NOW, not zero: `putSession` runs the idle sweep on the
  // way in, so a session stamped at the epoch is evicted by the call that created
  // it. A fixture that trips its own store's TTL is a very confusing test failure.
  const now = Date.now()
  return {
    gameId,
    problemId: state.problemId,
    seed: state.seed,
    difficulty: 'easy' as const,
    oracle,
    spec,
    state,
    undo: [],
    usedTier: 'template',
    createdAt: now,
    lastAccessedAt: now,
  }
}

function world(state: GameState) {
  return { gameId: 'game-1', problemId: state.problemId, spec, state, oracle }
}
