/**
 * Tests for the local decision layer.
 *
 * Two things these tests exist to protect:
 *
 *  1. **The heuristics are never wrong by omission.** They run on every request
 *     whenever the sidecar is down, so each is tested directly against realistic
 *     input, not just through `decide()`.
 *  2. **`decide()` cannot be broken from the outside.** A dead sidecar, a
 *     sidecar that answers with garbage, one that hallucinates a label outside
 *     the option set, one that is confidently wrong — all must degrade to a
 *     heuristic, silently and without throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROBLEMS,
  PROBLEM_IDS,
  type DecideRequest,
  type DecisionKind,
  type TraceFrame,
} from '@dsa/game-schema'
import { createDecisionEngine, parseTraceOps } from './engine.js'
import {
  MISCONCEPTION_LABELS,
  difficulty,
  pickHint,
  pickTheme,
  routeProblem,
  tagMisconception,
  tagMisconceptionDetailed,
} from './heuristics.js'
import { answerConfidence, parseSystemOneResponse, readLayaEnv } from './laya-client.js'
import { MIN_CONFIDENCE } from './types.js'

// ------------------------------------------------------------- fixtures

function frame(dsaOp: TraceFrame['dsaOp'], correct: boolean, index = 0): TraceFrame {
  return {
    index,
    action:
      dsaOp === 'compare'
        ? { type: 'comparePair', aId: 'a', bId: 'b', relation: 'lt' }
        : { type: 'selectObject', objectId: 'a' },
    codeLine: 1,
    codeLineText: '// frame',
    variables: {},
    pointers: {},
    dsaOp,
    correct,
    note: '',
  }
}

const THEME_OPTIONS: Record<string, string> = {
  'neon-city': 'a rain-slick cyberpunk skyline',
  desert: 'sun-bleached sand and heat haze',
  arctic: 'blue-white ice and drifting snow',
  jungle: 'dense green canopy and fireflies',
}

const MISCONCEPTION_OPTIONS: Record<string, string> = Object.fromEntries(
  MISCONCEPTION_LABELS.map((l) => [l, `the player's dominant mistake looks like ${l}`]),
)

const DIFFICULTY_OPTIONS: Record<string, string> = {
  easy: 'the player is struggling; scaffold down',
  medium: 'the player is coping; keep the current level',
  hard: 'the player is coping well; let them try harder',
}

const PROBLEM_OPTIONS: Record<string, string> = Object.fromEntries(
  PROBLEMS.map((p) => [p.id, `${p.title} — ${p.learningObjective}`]),
)

/** A realistic DecideRequest per kind, with the option set a caller would send. */
function requestFor(kind: DecisionKind, stateText: string): DecideRequest {
  switch (kind) {
    case 'route-problem':
      return {
        kind,
        stateText,
        options: PROBLEM_OPTIONS,
        instructions: 'Which problem should this player play next?',
      }
    case 'pick-theme':
      return { kind, stateText, options: THEME_OPTIONS, instructions: 'Which visual theme fits the player request?' }
    case 'pick-hint':
      return {
        kind,
        stateText,
        options: {
          '0': 'Start from the invariant every correct run shares.',
          '1': 'Narrow it down: which half can you rule out right now?',
          '2': 'Check the boundary condition before you commit.',
        },
        instructions: 'Which hint should be revealed next?',
      }
    case 'tag-misconception':
      return {
        kind,
        stateText,
        options: MISCONCEPTION_OPTIONS,
        instructions: 'Which single misconception best explains this trace?',
      }
    case 'difficulty':
      return { kind, stateText, options: DIFFICULTY_OPTIONS, instructions: 'How hard should the next game be?' }
  }
}

const ALL_KINDS: readonly DecisionKind[] = [
  'route-problem',
  'pick-theme',
  'pick-hint',
  'tag-misconception',
  'difficulty',
]

// ---------------------------------------------------------- offline path

describe('decide() with offline: true', () => {
  const engine = createDecisionEngine({ offline: true, enabled: true })

  it('reports itself unavailable and disabled', async () => {
    expect(engine.isEnabled()).toBe(false)
    await expect(engine.isAvailable()).resolves.toBe(false)
  })

  it('answers every DecisionKind with a valid key, a bounded confidence and source=heuristic', async () => {
    const states: Record<DecisionKind, string> = {
      'route-problem': 'I want to practice sorting',
      'pick-theme': 'something cold and blue please',
      'pick-hint': 'hintsUsed=1',
      'tag-misconception': 'compare mistake\ncompare mistake\nswap mistake',
      difficulty: 'steps=18 mistakes=3 hintsUsed=1',
    }
    for (const kind of ALL_KINDS) {
      const req = requestFor(kind, states[kind])
      const out = await engine.decide(req)
      const options = Object.keys(req.options)

      expect(out.choice, `${kind} choice`).not.toBe('')
      expect(options, `${kind} choice must be a key of options`).toContain(out.choice)
      expect(out.confidence, `${kind} confidence`).toBeGreaterThanOrEqual(0)
      expect(out.confidence, `${kind} confidence`).toBeLessThanOrEqual(1)
      expect(out.source, `${kind} source`).toBe('heuristic')
    }
  })

  it('never touches the network', async () => {
    const spy = vi.fn(() => Promise.reject(new Error('network must not be used')))
    vi.stubGlobal('fetch', spy)
    try {
      const e = createDecisionEngine({ offline: true, baseUrl: 'http://192.0.2.1:9' })
      await e.decide(requestFor('route-problem', 'binary search'))
      await e.isAvailable()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('constrains to the caller-supplied option set even for a nonsense request', async () => {
    const out = await engine.decide({
      kind: 'route-problem',
      stateText: 'something completely unrelated to data structures',
      options: { 'move-zeroes': 'Move zeroes to the end' },
      instructions: 'Which problem?',
    })
    expect(out.choice).toBe('move-zeroes')
    expect(out.source).toBe('heuristic')
  })
})

// ---------------------------------------------------------- routeProblem

describe('routeProblem', () => {
  // Every one of these is phrased the way a player actually types, not the way
  // the registry titles are written.
  const CASES: readonly (readonly [string, string])[] = [
    ['I want to practice sorting', 'bubble-sort'],
    ['how do I find the biggest number', 'array-max-min'],
    ['teach me stacks and parentheses', 'valid-parentheses'],
    ['reverse a linked list', 'reverse-linked-list'],
    ['binary search', 'binary-search'],
    ['help me with two sum pairs', 'two-sum'],
    ['move the zeros to the end of the array', 'move-zeroes'],
    ['what is a queue, enqueue and dequeue', 'queue-operations'],
    ['bubble sort please', 'bubble-sort'],
    ['selection sort tutorial', 'selection-sort'],
    ['traverse a linked list from the head', 'linked-list-traversal'],
    ['push and pop on a stack until underflow', 'stack-push-pop'],
    ['find the target in a sorted array', 'binary-search'],
    ['which array element is the largest', 'array-max-min'],
    ['check whether the brackets are balanced', 'valid-parentheses'],
  ]

  it.each(CASES)('routes %j to %s', (text, expected) => {
    const out = routeProblem(text)
    expect(out.choice).toBe(expected)
    expect(PROBLEM_IDS).toContain(out.choice)
    expect(out.source).toBe('heuristic')
    expect(out.confidence).toBeGreaterThan(0)
    expect(out.confidence).toBeLessThanOrEqual(1)
  })

  it('always returns a real problem id, even for empty or nonsense input', () => {
    for (const text of ['', '   ', 'tell me about quantum chromodynamics', '\n\n', '!!! ???']) {
      const out = routeProblem(text)
      expect(PROBLEM_IDS, `input ${JSON.stringify(text)}`).toContain(out.choice)
      expect(out.confidence).toBeGreaterThanOrEqual(0)
      expect(out.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('reports low confidence when nothing matched and high when something did', () => {
    expect(routeProblem('tell me about quantum chromodynamics').confidence).toBeLessThan(0.35)
    expect(routeProblem('reverse a linked list').confidence).toBeGreaterThan(0.35)
  })

  it('is a pure function of its input', () => {
    const first = routeProblem('find the biggest number in a list')
    for (let i = 0; i < 5; i++) expect(routeProblem('find the biggest number in a list')).toEqual(first)
  })

  it('only routes into the allowed id set when one is given', () => {
    const allowed = ['two-sum', 'move-zeroes'] as const
    for (let i = 0; i < 10; i++) {
      const text = ['reverse a linked list', 'binary search', 'totally unrelated', 'sorting'][i % 4] as string
      expect(allowed).toContain(routeProblem(text, allowed).choice)
    }
  })

  it('returns no choice when the allowed set is empty', () => {
    const out = routeProblem('binary search', [])
    expect(out.choice).toBe('')
    expect(out.confidence).toBe(0)
  })
})

// -------------------------------------------------------------- pickTheme

describe('pickTheme', () => {
  const CANDIDATES = Object.keys(THEME_OPTIONS)

  it('returns a candidate key', () => {
    for (const c of CANDIDATES) {
      const out = pickTheme(CANDIDATES, `give me the ${c.replace('-', ' ')} one`)
      expect(CANDIDATES).toContain(out.choice)
      expect(out.confidence).toBeGreaterThan(0.6)
    }
  })

  it('is a deterministic rotation for the same candidate list and free text', () => {
    const a = pickTheme(CANDIDATES)
    const b = pickTheme(CANDIDATES)
    expect(a.choice).toBe(b.choice)
    expect(a.confidence).toBe(b.confidence)
  })

  it('changes with the free text, and stays inside the candidate set', () => {
    const seen = new Set<string>()
    for (const c of CANDIDATES) seen.add(pickTheme(CANDIDATES, c).choice)
    expect(seen.size).toBeGreaterThan(1)
    for (const s of seen) expect(CANDIDATES).toContain(s)
  })

  it('nudges towards a candidate named in the free text, overriding the rotation', () => {
    const rotated = pickTheme(CANDIDATES).choice
    let overrides = 0
    for (const c of CANDIDATES) {
      const nudged = pickTheme(CANDIDATES, `please, the ${c.replace('-', ' ')} one`).choice
      expect(nudged, `free text naming '${c}'`).toBe(c)
      if (nudged !== rotated) overrides++
    }
    // The rotation alone picks exactly one candidate, so naming the other three
    // has to move the answer. Proves the nudge has teeth.
    expect(overrides).toBe(CANDIDATES.length - 1)
  })

  it('does not nudge on vocabulary that only appears in a description', () => {
    // `pickTheme` matches against candidate KEYS only — the signature takes no
    // descriptions — so a word like "tundra" that only appears in prose is not
    // evidence, and the stable rotation stands.
    expect(pickTheme(CANDIDATES, 'make it feel like a cold blue tundra').confidence).toBe(0.5)
  })

  it('falls back to the rotation when nothing overlaps', () => {
    const out = pickTheme(CANDIDATES, 'zzz qqq')
    expect(CANDIDATES).toContain(out.choice)
    expect(out.confidence).toBe(0.5)
  })

  it('returns no choice for an empty candidate list', () => {
    expect(pickTheme([]).choice).toBe('')
    expect(pickTheme([]).confidence).toBe(0)
  })
})

// --------------------------------------------------------------- pickHint

describe('pickHint', () => {
  const POOL = ['general nudge', 'narrow it down', 'check the boundary'] as const

  it('walks the pool in order and clamps at the end, never returning undefined', () => {
    for (let used = 0; used <= POOL.length + 5; used++) {
      const out = pickHint(POOL, used)
      expect(out.choice, `hintsUsed=${used}`).toBeDefined()
      expect(POOL, `hintsUsed=${used}`).toContain(out.choice)
      expect(out.source).toBe('heuristic')
      expect(out.confidence).toBeGreaterThan(0)
      expect(out.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('serves the clamped index', () => {
    expect(pickHint(POOL, 0).choice).toBe(POOL[0])
    expect(pickHint(POOL, 1).choice).toBe(POOL[1])
    expect(pickHint(POOL, 2).choice).toBe(POOL[2])
    expect(pickHint(POOL, 99).choice).toBe(POOL[POOL.length - 1])
  })

  it('is more confident while unused hints remain than once the pool is exhausted', () => {
    const early = pickHint(POOL, 0).confidence
    const exhausted = pickHint(POOL, POOL.length).confidence
    expect(early).toBeGreaterThan(exhausted)
  })

  it('tolerates a negative and a non-finite hintsUsed', () => {
    expect(pickHint(POOL, -5).choice).toBe(POOL[0])
    expect(pickHint(POOL, Number.NaN).choice).toBe(POOL[0])
  })

  it('prefers an on-topic hint within the still-unused suffix, never going backwards', () => {
    const pool = ['Look at the top of the stack', 'swap the two positions', 'Recheck the boundary']
    const out = pickHint(pool, 1, 'swap')
    expect(out.choice).toBe('swap the two positions')
    // From index 1 the only unused hint IS the on-topic one, so the clamp holds.
    expect(pickHint(pool, 2, 'swap').choice).toBe(pool[2])
    // An exhausted pool ignores the op entirely.
    expect(pickHint(pool, 3, 'swap').choice).toBe(pool[2])
  })

  it('returns no choice for an empty pool', () => {
    expect(pickHint([], 0).choice).toBe('')
    expect(pickHint([], 0).confidence).toBe(0)
  })
})

// ------------------------------------------------------ tagMisconception

describe('tagMisconception', () => {
  it('tags a compare-heavy trace as wrong-comparison and reports the count', () => {
    const trace = [
      frame('compare', false, 0),
      frame('compare', false, 1),
      frame('compare', false, 2),
      frame('read', true, 3),
      frame('swap', false, 4),
    ]
    const detailed = tagMisconceptionDetailed(trace)
    expect(detailed.label).toBe('wrong-comparison')
    expect(detailed.count).toBe(3)
    expect(detailed.totalMistakes).toBe(4)
    expect(detailed.distribution['wrong-comparison']).toBe(3)
    expect(tagMisconception(trace).choice).toBe('wrong-comparison')
  })

  it('tags an empty trace as no-mistakes', () => {
    expect(tagMisconceptionDetailed([]).label).toBe('no-mistakes')
    expect(tagMisconception([]).choice).toBe('no-mistakes')
    expect(tagMisconception([]).confidence).toBe(1)
  })

  it('tags a mistake-free trace as no-mistakes', () => {
    const trace = [frame('compare', true, 0), frame('read', true, 1), frame('assign', true, 2)]
    expect(tagMisconception(trace).choice).toBe('no-mistakes')
    expect(tagMisconceptionDetailed(trace).totalMistakes).toBe(0)
  })

  it('maps every dsaOp to a label in the fixed set', () => {
    const ops: TraceFrame['dsaOp'][] = [
      'compare', 'traverse', 'move', 'insert', 'swap', 'push', 'pop',
      'choose-path', 'read', 'assign', 'terminate', 'link', 'unlink',
    ]
    const expected: Record<string, string> = {
      'choose-path': 'off-by-one-halving',
      compare: 'wrong-comparison',
      swap: 'unstable-ordering',
      move: 'unstable-ordering',
      push: 'stack-discipline',
      pop: 'stack-discipline',
      traverse: 'pointer-confusion',
      link: 'pointer-confusion',
      assign: 'value-vs-index',
      terminate: 'value-vs-index',
    }
    for (const op of ops) {
      const out = tagMisconception([frame(op, false, 0)])
      expect(MISCONCEPTION_LABELS, `op ${op}`).toContain(out.choice)
      if (expected[op] !== undefined) expect(out.choice, `op ${op}`).toBe(expected[op])
    }
  })

  it('breaks a tie deterministically', () => {
    const trace = [frame('compare', false, 0), frame('swap', false, 1)]
    const first = tagMisconception(trace).choice
    for (let i = 0; i < 5; i++) expect(tagMisconception(trace).choice).toBe(first)
  })

  it('prefers the dominant mistake', () => {
    const trace = [
      frame('pop', false, 0),
      frame('pop', false, 1),
      frame('pop', false, 2),
      frame('link', false, 3),
    ]
    expect(tagMisconception(trace).choice).toBe('stack-discipline')
  })
})

// ------------------------------------------------------------- difficulty

describe('difficulty', () => {
  const ORDER: Readonly<Record<string, number>> = { easy: 0, medium: 1, hard: 2 }

  it('always returns a valid difficulty with a bounded confidence', () => {
    for (const steps of [0, 1, 5, 40, 1000]) {
      for (const mistakes of [0, 1, 3, 7, 50]) {
        for (const hints of [0, 1, 5, 20]) {
          const out = difficulty(steps, mistakes, hints)
          expect(['easy', 'medium', 'hard']).toContain(out.choice)
          expect(out.confidence).toBeGreaterThanOrEqual(0)
          expect(out.confidence).toBeLessThanOrEqual(1)
          expect(out.source).toBe('heuristic')
        }
      }
    }
  })

  // Direction, per the heuristics' own docs: more mistakes => a LOWER label.
  // 'hard' means "let the player try harder", so difficulty is non-INCREASING
  // in mistakes. Non-increasing rather than strictly decreasing because a
  // threshold is a step function.
  it('is monotonic (non-increasing) in mistakes', () => {
    let previous = Infinity
    for (let mistakes = 0; mistakes <= 10; mistakes++) {
      const choice = difficulty(20, mistakes, 0).choice
      const rank = ORDER[choice] ?? -1
      expect(rank, `mistakes=${mistakes} produced ${choice}`).toBeLessThanOrEqual(previous)
      previous = rank
    }
  })

  it('is monotonic (non-increasing) in hints used', () => {
    let previous = Infinity
    for (let hints = 0; hints <= 10; hints++) {
      const rank = ORDER[difficulty(20, 1, hints).choice] ?? -1
      expect(rank).toBeLessThanOrEqual(previous)
      previous = rank
    }
  })

  it('rewards a long clean run and punishes a short messy one', () => {
    expect(difficulty(80, 0, 0).choice).toBe('hard')
    expect(difficulty(4, 6, 3).choice).toBe('easy')
  })

  it('tolerates junk numbers', () => {
    for (const out of [difficulty(Number.NaN, Number.NaN, Number.NaN), difficulty(-1, -1, -1), difficulty(1e9, 0, 0)]) {
      expect(['easy', 'medium', 'hard']).toContain(out.choice)
      expect(out.confidence).toBeGreaterThanOrEqual(0)
      expect(out.confidence).toBeLessThanOrEqual(1)
    }
  })
})

// ------------------------------------------ laya client parsing, defensively

describe('laya response parsing', () => {
  it('rejects anything that is not an answers document', () => {
    for (const raw of [null, undefined, 42, 'text', [], { answers: null }, { answers: [] }, { answers: 'x' }]) {
      expect(parseSystemOneResponse(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  it('keeps only the answer entries that are objects', () => {
    const parsed = parseSystemOneResponse({
      answers: { a: { type: 'choice', choice: 'x' }, b: 'nope', c: 7 },
      routing: { model: 'multilingual' },
    })
    expect(parsed).not.toBeNull()
    expect(Object.keys(parsed?.answers ?? {})).toEqual(['a'])
  })

  it('prefers answer_confidence, then confidence, then max(probabilities)', () => {
    expect(
      answerConfidence({ answer_confidence: 0.71, confidence: 0.99, probabilities: { a: 0.1 } }),
    ).toBe(0.71)
    expect(answerConfidence({ confidence: 0.42 })).toBe(0.42)
    expect(answerConfidence({ probabilities: { a: 0.2, b: 0.6 } })).toBe(0.6)
    expect(answerConfidence({})).toBeNull()
    expect(answerConfidence(undefined)).toBeNull()
  })

  it('clamps and rejects non-finite confidences', () => {
    expect(answerConfidence({ answer_confidence: 5 })).toBe(1)
    expect(answerConfidence({ answer_confidence: -2 })).toBe(0)
    expect(answerConfidence({ answer_confidence: Number.NaN })).toBeNull()
  })

  it('reads LAYA_* env vars with the documented defaults', () => {
    expect(readLayaEnv({})).toMatchObject({
      baseUrl: 'http://127.0.0.1:8000',
      enabled: true,
      // The fine-tuned checkpoint: every question this package asks is a typed
      // decision, which is what it was trained for.
      model: 'typed-decisions',
      timeoutMs: 1500,
    })
    expect(
      readLayaEnv({
        LAYA_BASE_URL: 'http://box:9000',
        LAYA_ENABLED: '0',
        LAYA_MODEL: 'typed-decisions',
        LAYA_TIMEOUT_MS: '250',
      }),
    ).toMatchObject({
      baseUrl: 'http://box:9000',
      enabled: false,
      model: 'typed-decisions',
      timeoutMs: 250,
    })
  })
})

// ---------------------------------------------- decide(): failure handling

/** `lib` is ES2022 with no DOM, so take the fetch argument type from fetch. */
type FetchArg = Parameters<typeof fetch>[0]
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>

/** A Response-like object good enough for the client. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Health OK, then whatever `onSystemOne` returns for the inference call. */
function stubSidecar(onSystemOne: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn((input: FetchArg): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/health')) return Promise.resolve(jsonResponse({ status: 'ok' }))
    return Promise.resolve(onSystemOne(url))
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

const GOOD_ANSWER = {
  answers: {
    'route-problem': {
      type: 'choice',
      choice: 'reverse-linked-list',
      probabilities: { 'reverse-linked-list': 0.82, 'linked-list-traversal': 0.18 },
      confidence: 0.55,
      answer_confidence: 0.82,
    },
  },
  routing: { model: 'multilingual', repo: 'convaiinnovations/laya/multilingual', reason: 'pinned' },
}

describe('decide() network failure handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses a confident, in-set Laya answer when there is one', async () => {
    const spy = stubSidecar(() => jsonResponse(GOOD_ANSWER))
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    const out = await engine.decide(requestFor('route-problem', 'reverse a linked list'))

    expect(out.source).toBe('laya')
    expect(out.choice).toBe('reverse-linked-list')
    expect(out.confidence).toBe(0.82)
    expect(out.distribution?.['reverse-linked-list']).toBe(0.82)
    expect(spy).toHaveBeenCalled()
  })

  it('falls back when fetch is never called at all (enabled: false, unroutable baseUrl)', async () => {
    const spy = vi.fn(() => Promise.reject(new Error('fetch must not be called')))
    vi.stubGlobal('fetch', spy)
    const engine = createDecisionEngine({
      enabled: false,
      // RFC 5737 TEST-NET-1: guaranteed non-routable, so any real request would
      // hang rather than fail fast.
      baseUrl: 'http://192.0.2.1:9',
    })
    const started = Date.now()
    const out = await engine.decide(requestFor('route-problem', 'binary search'))
    const elapsed = Date.now() - started

    expect(spy).not.toHaveBeenCalled()
    expect(out.source).toBe('heuristic')
    expect(PROBLEM_IDS).toContain(out.choice)
    expect(out.confidence).toBeGreaterThanOrEqual(0)
    expect(out.confidence).toBeLessThanOrEqual(1)
    // A real request to a black hole cannot come back this fast.
    expect(elapsed).toBeLessThan(500)
  })

  it('falls back when the sidecar is unreachable, and probes health only once per TTL', async () => {
    const spy = vi.fn((_input: FetchArg) => Promise.reject(new Error('ECONNREFUSED')))
    vi.stubGlobal('fetch', spy)
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:1' })

    const first = await engine.decide(requestFor('route-problem', 'binary search'))
    const second = await engine.decide(requestFor('pick-theme', 'arctic please'))
    const third = await engine.decide(requestFor('difficulty', 'steps=9 mistakes=4'))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toContain('/health')
    for (const out of [first, second, third]) {
      expect(out.source).toBe('heuristic')
      expect(out.choice).not.toBe('')
      expect(out.confidence).toBeGreaterThanOrEqual(0)
      expect(out.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('logs the failure once, not once per decision', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))))
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:1' })
    await engine.decide(requestFor('route-problem', 'binary search'))
    await engine.decide(requestFor('route-problem', 'binary search'))
    await engine.decide(requestFor('route-problem', 'binary search'))
    const warn = vi.mocked(console.warn).mock.calls.filter((c) =>
      String(c[0]).includes('decision-layer'),
    )
    expect(warn.length).toBeLessThanOrEqual(1)
    expect(warn.length).toBeGreaterThanOrEqual(1)
  })

  it.each([
    ['a non-JSON body', () => new Response('<html>502 Bad Gateway</html>', { status: 200 })],
    ['an HTML error page', () => new Response('<html>nope</html>', { status: 502 })],
    ['a body with no answers key', () => jsonResponse({ routing: { model: 'multilingual' } })],
    ['answers of the wrong shape', () => jsonResponse({ answers: { 'route-problem': 'bubble-sort' } })],
    ['an answer with no choice', () => jsonResponse({ answers: { 'route-problem': { type: 'score', score: 2 } } })],
    ['a JSON null body', () => jsonResponse('null')],
  ])('falls back without throwing on %s', async (_label, responder) => {
    stubSidecar(responder)
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    const out = await engine.decide(requestFor('route-problem', 'I want to practice sorting'))
    expect(out.source).toBe('heuristic')
    expect(out.choice).toBe('bubble-sort')
  })

  it('never invents a label: a choice outside the option set is discarded', async () => {
    stubSidecar(() =>
      jsonResponse({
        answers: {
          'route-problem': {
            type: 'choice',
            choice: 'quantum-annealing',
            confidence: 1,
            answer_confidence: 0.99,
          },
        },
      }),
    )
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    const out = await engine.decide(requestFor('route-problem', 'I want to practice sorting'))
    expect(out.source).toBe('heuristic')
    // The hallucinated label was discarded, not passed through and not snapped
    // onto a near-miss key of the option set.
    expect(out.choice).not.toBe('quantum-annealing')
    expect(PROBLEM_IDS).toContain(out.choice)
    expect(Object.keys(PROBLEM_OPTIONS)).toContain(out.choice)
  })

  it('applies the confidence gate to a low-confidence in-set answer', async () => {
    stubSidecar(() =>
      jsonResponse({
        answers: {
          'route-problem': { type: 'choice', choice: 'two-sum', answer_confidence: 0.01 },
        },
      }),
    )
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    const out = await engine.decide(requestFor('route-problem', 'I want to practice sorting'))
    expect(out.source).toBe('heuristic')
    // Laya said two-sum with 0.01 confidence; the heuristic says bubble-sort.
    expect(out.choice).toBe('bubble-sort')
  })

  it('applies the confidence gate to the uncalibrated confidence field too', async () => {
    stubSidecar(() =>
      jsonResponse({
        answers: {
          // No answer_confidence, and the distribution is flat: gate must fire.
          'route-problem': {
            type: 'choice',
            choice: 'two-sum',
            confidence: 0.01,
            probabilities: { 'two-sum': 0.4, 'bubble-sort': 0.35, 'array-max-min': 0.25 },
          },
        },
      }),
    )
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    const out = await engine.decide(requestFor('route-problem', 'I want to practice sorting'))
    expect(out.source).toBe('heuristic')
  })

  it('gates a flat distribution that only reports a peaked `confidence`', async () => {
    // confidence is 1 - normalised entropy, so a 3-way tie is 0.0 and a
    // decisive answer is ~1.0. A mid-range value must not pass the gate.
    stubSidecar(() =>
      jsonResponse({
        answers: {
          'route-problem': {
            type: 'choice',
            choice: 'two-sum',
            probabilities: { 'two-sum': 0.34, 'bubble-sort': 0.33, 'array-max-min': 0.33 },
            confidence: 0.02,
          },
        },
      }),
    )
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    expect((await engine.decide(requestFor('route-problem', 'sorting'))).source).toBe('heuristic')
  })

  it('honours a retuned gate', async () => {
    stubSidecar(() =>
      jsonResponse({
        answers: { 'route-problem': { type: 'choice', choice: 'two-sum', answer_confidence: 0.5 } },
      }),
    )
    // 0.5 passes the 0.35 default...
    const permissive = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    expect((await permissive.decide(requestFor('route-problem', 'sorting'))).source).toBe('laya')
    // ...and fails a gate raised to 0.8.
    const strict = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000', minConfidence: 0.8 })
    expect((await strict.decide(requestFor('route-problem', 'sorting'))).source).toBe('heuristic')
  })

  it('gives up on Laya after dispose()', async () => {
    const spy = stubSidecar(() => jsonResponse(GOOD_ANSWER))
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000' })
    expect((await engine.decide(requestFor('route-problem', 'sorting'))).source).toBe('laya')
    await engine.dispose?.()
    expect(engine.isEnabled()).toBe(true)
    expect(await engine.isAvailable()).toBe(false)
    const after = await engine.decide(requestFor('route-problem', 'sorting'))
    expect(after.source).toBe('heuristic')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('sends exactly one question, named after the kind, with an object criteria', async () => {
    let body: unknown = null
    stubSidecar(() => jsonResponse(GOOD_ANSWER))
    vi.stubGlobal(
      'fetch',
      vi.fn((input: FetchArg, init?: FetchInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.endsWith('/health')) return Promise.resolve(jsonResponse({ status: 'ok' }))
        body = JSON.parse(String(init?.body))
        return Promise.resolve(jsonResponse(GOOD_ANSWER))
      }),
    )
    const engine = createDecisionEngine({ enabled: true, baseUrl: 'http://127.0.0.1:8000', model: 'multilingual' })
    await engine.decide(requestFor('route-problem', 'reverse a linked list'))

    expect(body).not.toBeNull()
    const parsed = body as { state: unknown; model: string; questions: Record<string, unknown> }
    expect(parsed.state).toBe('reverse a linked list')
    expect(parsed.model).toBe('multilingual')
    expect(Object.keys(parsed.questions)).toEqual(['route-problem'])
    const question = parsed.questions['route-problem'] as { type: string; criteria: unknown }
    expect(question.type).toBe('choice')
    // A choice question's criteria is `{ key: description }`, not an array.
    expect(Array.isArray(question.criteria)).toBe(false)
    expect(Object.keys(question.criteria as Record<string, string>)).toEqual(Object.keys(PROBLEM_OPTIONS))
  })
})

// --------------------------------------- heuristic stateText conventions

describe('parseTraceOps', () => {
  it('reads mistake lines and ignores correct ones', () => {
    expect(parseTraceOps('compare mistake\nread ok\nswap wrong\npush x\npop !\nchoose-path correct')).toEqual([
      'compare',
      'swap',
      'push',
      'pop',
    ])
  })

  it('ignores lines that are not op + verdict', () => {
    expect(parseTraceOps('the player is stuck\n\nhello world')).toEqual([])
  })
})
