/**
 * The hint screen.
 *
 * The regression that motivated this file is specific and was reproduced on the
 * default tier with no API key configured:
 *
 *     HINT1: "First move: Set lo=0, hi=n-1."
 *     HINT2: "Then: While lo<=hi compute mid=(lo+hi)/2."
 *     HINT3: "Then: If a[mid]==target stop."
 *
 * The first test below is that exact case. The rest exist because a screen that
 * only catches one known string is a lookup table, not a guarantee.
 */

import { describe, expect, it } from 'vitest'
import type { GameState } from '@dsa/game-schema'

import { describeSearchWindow, findHintViolation, screenHint } from './hint-safety.js'

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    problemId: 'binary-search',
    variables: { lo: 2, hi: 5, mid: 3 },
    instance: { problemId: 'binary-search', seed: 1, values: [3, 1, 4, 1, 5, 9, 2, 6], slots: [], target: 9 },
    progress: { steps: 3, mistakes: 0, hintsUsed: 1 },
    ...overrides,
  } as unknown as GameState
}

describe('findHintViolation', () => {
  it('rejects the canonical-algorithm hint that actually shipped', () => {
    // The three strings the default tier served, verbatim.
    for (const hint of [
      'First move: Set lo=0, hi=n-1.',
      'Then: While lo<=hi compute mid=(lo+hi)/2.',
      'Then: If a[mid]==target stop.',
      'Then: If a[mid]<target set lo=mid+1 else set hi=mid-1.',
      'Then: If lo>hi the target is absent.',
    ]) {
      expect(findHintViolation(hint), hint).not.toBeNull()
    }
  })

  it('rejects the notation in other spellings', () => {
    for (const hint of [
      'Set idx = 4',
      'Use left=0 and right=7',
      'Check arr[i] first',
      'while (lo <= hi) compute the middle',
      'return mid',
      'const mid = Math.floor((lo + hi) / 2)',
      'a[mid] < target',
    ]) {
      expect(findHintViolation(hint), hint).not.toBeNull()
    }
  })

  it('rejects a position, in digit and word form', () => {
    for (const hint of [
      'Choose index 5',
      'Look at position 3',
      'It is in slot 4',
      'Take the fifth one',
      'The third cell holds it',
    ]) {
      const hit = findHintViolation(hint)
      expect(hit, hint).not.toBeNull()
      expect(hit?.id, hint).toBe('position')
    }
  })

  it('rejects an asserted result, with or without the word "answer"', () => {
    for (const hint of [
      'The answer is 5',
      "It's number 5",
      '5 is the answer',
      'It is the index 5',
      'Submit 4 as the answer',
    ]) {
      const hit = findHintViolation(hint)
      expect(hit, hint).not.toBeNull()
      // A resolution and a position are the same defect for a windowed
      // problem; either id is an honest report.
      expect(['resolution', 'position'], hint).toContain(hit?.id)
    }
  })

  it('rejects source code', () => {
    for (const hint of [
      '```js\nlet lo = 0\n```',
      'function binarySearch(a, target) {\n  return 3;\n}',
      'while (lo <= hi) {\n  mid = 3;\n}',
    ]) {
      const hit = findHintViolation(hint)
      expect(hit, hint).not.toBeNull()
      expect(hit?.id, hint).toBe('pasted-code')
    }
  })

  it('rejects praise the engine has not earned', () => {
    for (const hint of ['That is correct.', "You're right.", 'Nice work!', 'Spot on.']) {
      const hit = findHintViolation(hint)
      expect(hit, hint).not.toBeNull()
      expect(hit?.id, hint).toBe('unearned-praise')
    }
  })

  /**
   * The counter-test that decides whether the screen is usable.
   *
   * A screen that fires on helpful prose trains the team to disable it. These
   * are real hint lines from the shipped tiers and from `guidance.ts`, and every
   * one of them must survive.
   */
  it('admits good hints, including ones that mention the target', () => {
    for (const hint of [
      'Everything in the west wing is in order, so order is the tool here.',
      'Hold your lantern next to the vault and ask which is bigger.',
      'Throw away the side that cannot hold the vault. Keep the side that might.',
      'Say which of the two is the smaller one. That single word is the whole decision.',
      'A stack hands values back in the opposite order to the one they went in.',
      'Finishing is a result, not a guess.',
      // A threshold is not a position. "at least half" is the invariant.
      'Every comparison should leave roughly half of what is left still in play.',
      'An ordered row means you can rule out a whole side at once.',
      // The words `while`/`for`/`if` in PROSE are not source code.
      'Moving a value is not the same as copying it.',
      'Put it where the algorithm expects to find it next.',
    ]) {
      expect(findHintViolation(hint), hint).toBeNull()
    }
  })

  it('does not flag an empty or non-string hint', () => {
    expect(findHintViolation('')).toBeNull()
    expect(findHintViolation('   ')).toBeNull()
    expect(findHintViolation(undefined as unknown as string)).toBeNull()
  })
})

describe('screenHint', () => {
  it('passes a clean hint through verbatim', () => {
    const hint = 'Hold your lantern next to the vault and ask which is bigger.'
    expect(screenHint(hint, state())).toBe(hint)
  })

  it('substitutes a window description for the canonical algorithm', () => {
    const out = screenHint('Then: While lo<=hi compute mid=(lo+hi)/2.', state())
    // Word-bounded: "rule the other one out" contains the letters l-o.
    expect(out).not.toMatch(/\b(?:lo|hi|mid)\b/i)
    expect(out).not.toMatch(/[<>=]/)
    expect(out).toContain('still in play')
  })

  it('always returns something non-empty, whatever it is handed', () => {
    for (const candidate of ['', '   ', 'lo=0', 'index 5', '```', undefined, 42]) {
      const out = screenHint(candidate as unknown as string, state())
      expect(out.trim(), String(candidate)).not.toBe('')
      expect(findHintViolation(out), `replacement for ${String(candidate)}: ${out}`).toBeNull()
    }
  })

  it('produces a replacement that is itself clean, even for a broken state', () => {
    // The screen must not be able to fall back to something it would reject.
    for (const broken of [{} as GameState, { variables: null } as unknown as GameState, state({ variables: { lo: 'x' } as never })]) {
      const out = screenHint('lo=0, hi=7', broken)
      expect(out.trim()).not.toBe('')
      expect(findHintViolation(out), out).toBeNull()
    }
  })
})

describe('describeSearchWindow', () => {
  it('counts what is left, in words, with no positions', () => {
    const out = describeSearchWindow(state())
    expect(out).toContain('Four of the eight values are still in play')
    expect(out).not.toMatch(/\d/)
  })

  it('handles a single survivor and an empty window', () => {
    const one = describeSearchWindow(state({ variables: { lo: 3, hi: 3 } } as Partial<GameState>))
    expect(one).toContain('Only one value is still in play')

    const none = describeSearchWindow(state({ variables: { lo: 2, hi: 1 } } as Partial<GameState>))
    expect(none).toContain('Nothing is left to check')
  })

  it('falls back to the whole board when there is no window yet', () => {
    const out = describeSearchWindow(state({ variables: {} } as Partial<GameState>))
    expect(out).toContain('still in play')
    expect(out).not.toMatch(/\d/)
  })

  it('never throws on a malformed state', () => {
    for (const broken of [{} as GameState, { instance: null } as unknown as GameState, { variables: { lo: NaN, hi: Infinity } } as unknown as GameState]) {
      expect(describeSearchWindow(broken).trim()).not.toBe('')
    }
  })
})
