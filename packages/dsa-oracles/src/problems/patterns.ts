/**
 * Array patterns, hash tables, strings, and the missing single-topic games.
 *
 * Eleven problems that close the highest-yield gaps against the
 * awesome-leetcode-resources fundamentals list, reusing only mechanics and
 * board shapes the clients already render (linear boards, token boards, node
 * boards, one stack container). No new mechanic, no new container kind, no
 * engine change — that is the whole point: these are the games the current
 * renderer could already play, with oracles it did not have.
 *
 * STRUCTURE. Same small runner as `remaining.ts`: `actionsFor` computes the
 * exact expected action sequence from the instance, and `applyAction` requires
 * an exact match or rejects with guidance. A wrong-but-legal claim is illegal
 * here (it never advances the plan), exactly like the move-zeroes and
 * two-sum oracles — the sorts are the exception, not the rule.
 *
 * RELATION CONVENTIONS, per problem, because `comparePair` names two objects
 * but the algorithm compares two IDEAS:
 *
 *   two-pointers-pair  pair-sum REL target (the pair is named, target implicit)
 *   kadane             extend REL restart, i.e. (cur + a[i]) REL a[i]
 *   merge-intervals    next-start REL running-end
 *   rotated-search     probed REL target (same as array-max-min probe-vs-best)
 *   everything else    direct aId REL bId on board values / char codes
 *
 * Each convention is restated in the legal-action label at the moment it is
 * used, so the learner is never asked to guess which reading applies.
 */
import type {
  Action,
  ActionOutcome,
  BuildInstanceInput,
  Complexity,
  GameObject,
  GameState,
  LegalActionDescriptor,
  Oracle,
  ProblemInstance,
  Relation,
  TraceFrame,
} from '@dsa/game-schema'
import {
  buildListSpec,
  cloneState,
  dsaOpForAction,
  getProblem,
  linearSlots,
  makeRng,
  randInt,
} from '@dsa/game-schema'
import { buildBoard, finishIllegal, indexOf, num, oid, sid, type CodeLang } from '../shared/kernel.js'

type PatternId =
  | 'sliding-window-max-sum'
  | 'two-pointers-pair'
  | 'prefix-sum-range'
  | 'kadane-max-subarray'
  | 'merge-intervals'
  | 'next-greater-element'
  | 'rotated-search'
  | 'linked-list-cycle'
  | 'frequency-count'
  | 'valid-anagram'
  | 'valid-palindrome'

const IDS: readonly PatternId[] = [
  'sliding-window-max-sum',
  'two-pointers-pair',
  'prefix-sum-range',
  'kadane-max-subarray',
  'merge-intervals',
  'next-greater-element',
  'rotated-search',
  'linked-list-cycle',
  'frequency-count',
  'valid-anagram',
  'valid-palindrome',
]

const LETTERS = ['a', 'b', 'c', 'd', 'e'] as const

function sized(metaId: PatternId, input: BuildInstanceInput): number {
  const meta = getProblem(metaId)
  if (!meta) throw new Error(`${metaId} is missing from the catalogue`)
  const { minLength, maxLength } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  return Math.max(minLength, Math.min(maxLength, Math.trunc(input.length ?? defaultLength)))
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function uniqueValues(n: number, rng: () => number, min = 10, max = 89): number[] {
  const values = new Set<number>()
  while (values.size < n) values.add(randInt(rng, min, max))
  return [...values]
}

function relation(a: number, b: number): Relation {
  return a < b ? 'lt' : a > b ? 'gt' : 'eq'
}

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

// ------------------------------------------------------------------ instances

function buildInstance(id: PatternId, input: BuildInstanceInput): ProblemInstance {
  const n = sized(id, input)
  const rng = makeRng(input.seed)
  const slotsFor = (values: number[]) => linearSlots(values.length)

  if (id === 'sliding-window-max-sum') {
    const values = Array.from({ length: n }, () => randInt(rng, 1, 20))
    const want = input.difficulty === 'easy' ? 2 : input.difficulty === 'hard' ? 4 : 3
    const k = Math.max(2, Math.min(n - 1, want))
    return { problemId: id, seed: input.seed, values, slots: slotsFor(values), extras: { difficulty: input.difficulty, k } }
  }

  if (id === 'two-pointers-pair') {
    // Same construction as two-sum: the small pair is the unique answer and
    // every other value exceeds the target, so the converging pointers walk
    // the right edge down to index 1 deterministically.
    const a = randInt(rng, 2, 9)
    const b = randInt(rng, 11, 19)
    const target = a + b
    const bigs = Array.from({ length: Math.max(0, n - 2) }, (_, i) => target + 4 + i)
    const values = [a, b, ...bigs].sort((x, y) => x - y)
    return {
      problemId: id, seed: input.seed, values, target, slots: slotsFor(values),
      extras: { difficulty: input.difficulty, answerIndices: [values.indexOf(a), values.indexOf(b)] },
    }
  }

  if (id === 'prefix-sum-range') {
    const values = Array.from({ length: n }, () => randInt(rng, 1, 20))
    const l = randInt(rng, 0, n - 3)
    const r = randInt(rng, l + 1, n - 1)
    let run = 0
    const prefix = values.map((v) => (run += v))
    return {
      problemId: id, seed: input.seed, values, slots: slotsFor(values),
      extras: { difficulty: input.difficulty, l, r, rangeSum: prefix[r]! - (l > 0 ? prefix[l - 1]! : 0) },
    }
  }

  if (id === 'kadane-max-subarray') {
    const values = Array.from({ length: n }, () => randInt(rng, -9, 20))
    // At least one clearly positive value, or every game is an exercise in
    // picking the least-bad negative and the lesson (extend vs restart) never
    // shows both branches.
    values[randInt(rng, 0, n - 1)] = randInt(rng, 10, 20)
    return { problemId: id, seed: input.seed, values, slots: slotsFor(values), extras: { difficulty: input.difficulty } }
  }

  if (id === 'merge-intervals') {
    const m = Math.max(3, n)
    const starts: number[] = [randInt(rng, 1, 5)]
    for (let i = 1; i < m; i++) starts.push(starts[i - 1]! + randInt(rng, 1, 5))
    const ends = starts.map((s) => s + randInt(rng, 1, 6))
    // Guarantee at least one overlap so the merge branch is always exercised.
    if (starts[1]! > ends[0]!) ends[0] = starts[1]! + 1
    const values = starts.flatMap((s, i) => [s, ends[i]!])
    return {
      problemId: id, seed: input.seed, values, slots: slotsFor(values),
      extras: { difficulty: input.difficulty, starts, ends },
    }
  }

  if (id === 'next-greater-element') {
    const values = shuffle(uniqueValues(n, rng), rng)
    return { problemId: id, seed: input.seed, values, slots: slotsFor(values), extras: { difficulty: input.difficulty } }
  }

  if (id === 'rotated-search') {
    const len = Math.max(3, n)
    const sorted = uniqueValues(len, rng, 1, 99).sort((x, y) => x - y)
    const pivot = randInt(rng, 1, len - 2)
    const values = [...sorted.slice(pivot), ...sorted.slice(0, pivot)]
    const answerIndex = randInt(rng, 0, len - 1)
    return {
      problemId: id, seed: input.seed, values, target: values[answerIndex], slots: slotsFor(values),
      extras: { difficulty: input.difficulty, answerIndex },
    }
  }

  if (id === 'linked-list-cycle') {
    const values = uniqueValues(n, rng)
    const hasCycle = rng() >= 0.4
    const cycleIndex = hasCycle ? randInt(rng, 0, n - 1) : -1
    return {
      problemId: id, seed: input.seed, values, list: buildListSpec(n, values), slots: linearSlots(n),
      extras: { difficulty: input.difficulty, hasCycle, cycleIndex },
    }
  }

  if (id === 'frequency-count') {
    const mode = randInt(rng, 1, 9)
    const values = Array.from({ length: n }, () => randInt(rng, 1, 9))
    values[0] = mode
    values[1] = mode
    values[2 % n] = mode
    const counts = new Map<number, number>()
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
    // The mode must be unique, or the final submit is ambiguous.
    for (const [v, c] of counts) {
      if (v !== mode && c >= (counts.get(mode) ?? 0)) {
        const spot = values.indexOf(v)
        values[spot] = mode
        counts.set(v, c - 1)
        counts.set(mode, (counts.get(mode) ?? 0) + 1)
      }
    }
    return {
      problemId: id, seed: input.seed, values: shuffle(values, rng), slots: slotsFor(values),
      extras: { difficulty: input.difficulty, mode },
    }
  }

  if (id === 'valid-anagram') {
    const L = Math.max(4, Math.min(8, n))
    const s = Array.from({ length: L }, () => LETTERS[Math.floor(rng() * LETTERS.length)]!)
    const valid = rng() >= 0.45
    let t: string[]
    if (valid) {
      t = shuffle(s, rng)
    } else {
      // A single substitution always changes the count vector (one letter down,
      // another up), so the result is never accidentally still an anagram.
      t = [...s]
      const other = LETTERS.find((c) => c !== t[0])!
      t[0] = other
    }
    const tokens = [...s, ...t]
    return {
      problemId: id, seed: input.seed,
      values: tokens.map((c) => c.charCodeAt(0)),
      tokens, slots: linearSlots(tokens.length),
      extras: { difficulty: input.difficulty, split: L, valid },
    }
  }

  // valid-palindrome
  const L = Math.max(4, Math.min(8, n))
  const h = Math.floor(L / 2)
  const left = Array.from({ length: h }, () => LETTERS[Math.floor(rng() * LETTERS.length)]!)
  const mid = L % 2 === 1 ? LETTERS[Math.floor(rng() * LETTERS.length)]! : ''
  const palindrome = [...left, ...mid, ...left.slice().reverse()].join('')
  const valid = rng() >= 0.35
  let chars = palindrome.split('')
  if (!valid) {
    // Break the outer pair: the first character differs from the last, so the
    // game ends on the very first comparison with real evidence.
    const last = chars[L - 1]!
    chars[0] = LETTERS.find((c) => c !== last)!
  }
  void rng
  return {
    problemId: id, seed: input.seed,
    values: chars.map((c) => c.charCodeAt(0)),
    tokens: chars, slots: linearSlots(chars.length),
    extras: { difficulty: input.difficulty, valid },
  }
}

// --------------------------------------------------------------------- states

function cycleState(instance: ProblemInstance): GameState {
  const nodes = instance.list ?? []
  const hasCycle = instance.extras?.['hasCycle'] === true
  const cycleIndex = num(instance.extras?.['cycleIndex'], -1)
  const objects: Record<string, GameObject> = {}
  for (const node of nodes) {
    objects[node.id] = {
      id: node.id, kind: 'node', label: String(node.value), value: node.value,
      visual: { kind: 'text', text: String(node.value) }, state: 'idle',
      tags: { index: Number(node.id.slice(1)) },
    }
  }
  objects['null'] = { id: 'null', kind: 'node', label: 'NULL', visual: { kind: 'text', text: '∅' }, state: 'idle' }
  const links = nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1]!.id, kind: 'next' as const }))
  if (hasCycle && nodes.length > 0 && cycleIndex >= 0 && cycleIndex < nodes.length) {
    links.push({ from: nodes[nodes.length - 1]!.id, to: nodes[cycleIndex]!.id, kind: 'next' as const })
  }
  return {
    problemId: instance.problemId, seed: instance.seed, instance,
    objects, slots: {}, containers: {}, links,
    selection: [], cursor: { nodeId: nodes[0]?.id },
    variables: { slow: 0, fast: 0, n: nodes.length },
    progress: emptyProgress(), phase: 'playing', trace: [],
    internal: { planIndex: 0, step: 0, slow: 0, fast: 0 },
  }
}

function initState(id: PatternId, instance: ProblemInstance): GameState {
  if (id === 'linked-list-cycle') return cycleState(instance)
  const extraObjects: GameObject[] = []
  const containers: GameState['containers'] = {}
  let kind: 'number' | 'token' = 'number'
  let variables: GameState['variables'] = { i: 0, n: instance.values.length }

  if (id === 'sliding-window-max-sum') {
    const k = num(instance.extras?.['k'], 3)
    extraObjects.push({ id: 'k-guide', kind: 'target', label: `window ${k}`, value: k, state: 'locked' })
    variables = { i: 0, k, best: null, window: 0, n: instance.values.length }
  } else if (id === 'two-pointers-pair' || id === 'rotated-search') {
    extraObjects.push({ id: 'target', kind: 'target', label: `target ${instance.target}`, value: instance.target, state: 'idle' })
    variables =
      id === 'two-pointers-pair'
        ? { L: 0, R: instance.values.length - 1, target: instance.target ?? 0, n: instance.values.length }
        : { lo: 0, hi: instance.values.length - 1, mid: 0, target: instance.target ?? 0, n: instance.values.length }
  } else if (id === 'prefix-sum-range') {
    const l = num(instance.extras?.['l'], 0)
    const r = num(instance.extras?.['r'], 0)
    extraObjects.push({ id: 'query', kind: 'target', label: `sum [${l}..${r}]`, state: 'locked' })
    variables = { i: 0, l, r, n: instance.values.length }
  } else if (id === 'kadane-max-subarray') {
    variables = { i: 1, cur: instance.values[0] ?? 0, best: instance.values[0] ?? 0, n: instance.values.length }
  } else if (id === 'merge-intervals') {
    const starts = (instance.extras?.['starts'] as number[] | undefined) ?? []
    const ends = (instance.extras?.['ends'] as number[] | undefined) ?? []
    variables = { i: 1, curStart: starts[0] ?? 0, curEnd: ends[0] ?? 0, n: instance.values.length }
  } else if (id === 'next-greater-element') {
    containers['stack'] = { id: 'stack', kind: 'stack', label: 'decreasing stack', order: [], capacity: instance.values.length }
    variables = { i: 0, n: instance.values.length }
  } else if (id === 'frequency-count') {
    variables = { i: 0, n: instance.values.length }
  } else {
    kind = 'token'
    variables = { i: 0, n: instance.values.length }
    if (id === 'valid-palindrome') {
      variables = { left: 0, right: instance.values.length - 1, n: instance.values.length }
    }
  }

  const state = buildBoard({ problemId: id, instance, kind, extras: extraObjects, containers, variables })
  state.internal = { planIndex: 0 }
  return state
}

// ---------------------------------------------------------------------- plans

function nodeId(i: number): string {
  return `n${i}`
}

function actionsFor(id: PatternId, instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const v = instance.values

  if (id === 'sliding-window-max-sum') {
    const k = num(instance.extras?.['k'], 3)
    let best = Number.NEGATIVE_INFINITY
    for (let s = 0; s + k <= v.length; s++) {
      let sum = 0
      for (let t = s; t < s + k; t++) sum += v[t]!
      best = Math.max(best, sum)
      actions.push({ type: 'selectObject', objectId: `v${s}` })
      actions.push({ type: 'assignValue', targetId: `w_${s}`, value: String(sum) })
    }
    actions.push({ type: 'submitAnswer', targetId: `v${Math.max(0, v.length - k)}`, value: String(best) })
    return actions
  }

  if (id === 'two-pointers-pair') {
    const target = instance.target ?? 0
    let L = 0
    let R = v.length - 1
    for (let guard = 0; guard < 2 * v.length + 4 && L < R; guard++) {
      const sum = v[L]! + v[R]!
      actions.push({ type: 'selectObject', objectId: `v${L}` })
      actions.push({ type: 'selectObject', objectId: `v${R}` })
      const rel = relation(sum, target)
      actions.push({ type: 'comparePair', aId: `v${L}`, bId: `v${R}`, relation: rel })
      if (rel === 'eq') {
        actions.push({ type: 'submitAnswer', targetId: `v${R}`, value: [L, R].sort((x, y) => x - y).join(',') })
        return actions
      }
      if (rel === 'lt') L++
      else R--
    }
    actions.push({ type: 'submitAnswer', targetId: 'v0', value: '0,1' })
    return actions
  }

  if (id === 'prefix-sum-range') {
    const l = num(instance.extras?.['l'], 0)
    const r = num(instance.extras?.['r'], 0)
    let run = 0
    for (let i = 0; i < v.length; i++) {
      run += v[i]!
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'assignValue', targetId: `p_${i + 1}`, value: String(run) })
    }
    let total = 0
    for (let i = l; i <= r; i++) total += v[i]!
    actions.push({ type: 'submitAnswer', targetId: `v${r}`, value: String(total) })
    return actions
  }

  if (id === 'kadane-max-subarray') {
    let cur = v[0]!
    let best = v[0]!
    for (let i = 1; i < v.length; i++) {
      const extend = cur + v[i]!
      const rel = relation(extend, v[i]!)
      const next = extend >= v[i]! ? extend : v[i]!
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'comparePair', aId: `v${i}`, bId: `v${i - 1}`, relation: rel })
      actions.push({ type: 'assignValue', targetId: 'cur', value: String(next) })
      cur = next
      best = Math.max(best, cur)
    }
    actions.push({ type: 'submitAnswer', targetId: `v${v.length - 1}`, value: String(best) })
    return actions
  }

  if (id === 'merge-intervals') {
    const starts = (instance.extras?.['starts'] as number[] | undefined) ?? []
    const ends = (instance.extras?.['ends'] as number[] | undefined) ?? []
    const m = starts.length
    const out: Array<[number, number]> = []
    let curS = starts[0]!
    let curE = ends[0]!
    for (let i = 1; i < m; i++) {
      actions.push({ type: 'selectObject', objectId: `v${2 * i}` })
      const rel = relation(starts[i]!, curE)
      actions.push({ type: 'comparePair', aId: `v${2 * i}`, bId: `v${2 * (i - 1)}`, relation: rel })
      if (starts[i]! <= curE) {
        curE = Math.max(curE, ends[i]!)
        actions.push({ type: 'assignValue', targetId: 'curEnd', value: String(curE) })
      } else {
        out.push([curS, curE])
        curS = starts[i]!
        curE = ends[i]!
        actions.push({ type: 'assignValue', targetId: 'curStart', value: String(curS) })
        actions.push({ type: 'assignValue', targetId: 'curEnd', value: String(curE) })
      }
    }
    out.push([curS, curE])
    actions.push({ type: 'submitAnswer', targetId: `v${2 * (m - 1)}`, value: out.map(([s, e]) => `${s}-${e}`).join(',') })
    return actions
  }

  if (id === 'next-greater-element') {
    const stack: number[] = []
    const ans = new Array<number>(v.length).fill(-1)
    for (let i = 0; i < v.length; i++) {
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      while (stack.length > 0 && v[stack[stack.length - 1]!]! < v[i]!) {
        const top = stack.pop()!
        actions.push({ type: 'comparePair', aId: `v${top}`, bId: `v${i}`, relation: 'lt' })
        actions.push({ type: 'pushPop', containerId: 'stack', op: 'pop' })
        ans[top] = v[i]!
      }
      actions.push({ type: 'pushPop', containerId: 'stack', op: 'push', objectId: `v${i}` })
      stack.push(i)
    }
    actions.push({ type: 'submitAnswer', targetId: 'v0', value: ans.join(',') })
    return actions
  }

  if (id === 'rotated-search') {
    const target = instance.target ?? 0
    let lo = 0
    let hi = v.length - 1
    for (let guard = 0; guard < 64 && lo <= hi; guard++) {
      const mid = Math.floor((lo + hi) / 2)
      actions.push({ type: 'selectObject', objectId: `v${mid}` })
      const rel = relation(v[mid]!, target)
      actions.push({ type: 'comparePair', aId: `v${mid}`, bId: 'target', relation: rel })
      if (rel === 'eq') {
        actions.push({ type: 'choosePath', fromId: `v${mid}`, pathId: 'found' })
        actions.push({ type: 'submitAnswer', targetId: `v${mid}`, value: String(mid) })
        return actions
      }
      let goLeft: boolean
      if (v[lo]! <= v[mid]!) goLeft = target >= v[lo]! && target < v[mid]!
      else goLeft = !(target > v[mid]! && target <= v[hi]!)
      actions.push({ type: 'choosePath', fromId: `v${mid}`, pathId: goLeft ? 'left' : 'right' })
      if (goLeft) hi = mid - 1
      else lo = mid + 1
    }
    const answerIndex = num(instance.extras?.['answerIndex'], 0)
    actions.push({ type: 'submitAnswer', targetId: `v${answerIndex}`, value: String(answerIndex) })
    return actions
  }

  if (id === 'linked-list-cycle') {
    const hasCycle = instance.extras?.['hasCycle'] === true
    const cycleIndex = num(instance.extras?.['cycleIndex'], -1)
    const ncount = instance.list?.length ?? v.length
    const nextIdx = (i: number): number => (i + 1 < ncount ? i + 1 : hasCycle ? cycleIndex : -1)
    const dest = (i: number): string => (i === -1 ? 'null' : nodeId(i))
    let slow = 0
    let fast = 0
    for (let guard = 0; guard < 4 * ncount + 8; guard++) {
      const s1 = nextIdx(slow)
      actions.push({ type: 'traverseNode', fromNodeId: nodeId(slow), toNodeId: dest(s1) })
      slow = s1
      const f1 = nextIdx(fast)
      actions.push({ type: 'traverseNode', fromNodeId: nodeId(fast), toNodeId: dest(f1) })
      if (f1 === -1) {
        actions.push({ type: 'submitAnswer', targetId: 'null', value: 'acyclic' })
        return actions
      }
      fast = f1
      const f2 = nextIdx(fast)
      actions.push({ type: 'traverseNode', fromNodeId: nodeId(fast), toNodeId: dest(f2) })
      if (f2 === -1) {
        actions.push({ type: 'submitAnswer', targetId: 'null', value: 'acyclic' })
        return actions
      }
      fast = f2
      if (slow === fast) {
        actions.push({ type: 'submitAnswer', targetId: nodeId(slow), value: 'cycle' })
        return actions
      }
    }
    actions.push({ type: 'submitAnswer', targetId: 'null', value: hasCycle ? 'cycle' : 'acyclic' })
    return actions
  }

  if (id === 'frequency-count') {
    const running = new Map<number, number>()
    let mode = v[0]!
    let modeCount = 0
    for (let i = 0; i < v.length; i++) {
      const c = (running.get(v[i]!) ?? 0) + 1
      running.set(v[i]!, c)
      if (c > modeCount) {
        modeCount = c
        mode = v[i]!
      }
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'assignValue', targetId: `freq_${v[i]!}`, value: String(c) })
    }
    actions.push({ type: 'submitAnswer', targetId: `v${v.indexOf(mode)}`, value: String(mode) })
    return actions
  }

  if (id === 'valid-anagram') {
    const L = num(instance.extras?.['split'], Math.floor(v.length / 2))
    const valid = instance.extras?.['valid'] === true
    const counts = new Map<string, number>()
    for (let i = 0; i < L; i++) {
      const ch = instance.tokens?.[i] ?? ''
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'assignValue', targetId: `cnt_${ch}`, value: String(counts.get(ch)) })
    }
    for (let j = 0; j < L; j++) {
      const ch = instance.tokens?.[L + j] ?? ''
      counts.set(ch, (counts.get(ch) ?? 0) - 1)
      actions.push({ type: 'selectObject', objectId: `v${L + j}` })
      actions.push({ type: 'assignValue', targetId: `cnt_${ch}`, value: String(counts.get(ch)) })
    }
    actions.push({ type: 'submitAnswer', targetId: `v${2 * L - 1}`, value: valid ? 'valid' : 'invalid' })
    return actions
  }

  // valid-palindrome
  const L = v.length
  const h = Math.floor(L / 2)
  const valid = instance.extras?.['valid'] === true
  for (let k = 0; k < h; k++) {
    const l = k
    const r = L - 1 - k
    actions.push({ type: 'selectObject', objectId: `v${l}` })
    const rel = relation(v[l]!, v[r]!)
    actions.push({ type: 'comparePair', aId: `v${l}`, bId: `v${r}`, relation: rel })
    if (rel !== 'eq') {
      actions.push({ type: 'submitAnswer', targetId: `v${l}`, value: 'invalid' })
      return actions
    }
  }
  actions.push({ type: 'submitAnswer', targetId: `v${L - 1}`, value: valid ? 'valid' : 'invalid' })
  return actions
}

// ------------------------------------------------------------------ metadata

function codeLine(id: PatternId, action: Action): number {
  if (action.type === 'submitAnswer') {
    if (id === 'linked-list-cycle') return action.value === 'cycle' ? 6 : 8
    if (id === 'valid-anagram') return action.value === 'valid' ? 9 : 7
    return 8
  }
  if (action.type === 'selectObject') return 3
  if (action.type === 'comparePair') return 4
  if (action.type === 'assignValue') return 5
  if (action.type === 'pushPop') return 5
  if (action.type === 'choosePath') return 8
  if (action.type === 'traverseNode') return 4
  return 1
}

function source(id: PatternId): string[] {
  switch (id) {
    case 'sliding-window-max-sum': return ['function maxWindowSum(a, k) {', '  let best = -Infinity', '  for (let s = 0; s + k <= a.length; s++) {', '    let sum = 0', '    for (let t = s; t < s + k; t++) sum += a[t]', '    if (sum > best) best = sum', '  }', '  return best', '}']
    case 'two-pointers-pair': return ['function twoSumSorted(a, target) {', '  let L = 0, R = a.length - 1', '  while (L < R) {', '    const sum = a[L] + a[R]', '    if (sum === target) return [L, R]', '    if (sum < target) L++', '    else R--', '  }', '}']
    case 'prefix-sum-range': return ['function rangeSum(a, l, r) {', '  const prefix = [0]', '  for (let i = 0; i < a.length; i++) prefix.push(prefix[i] + a[i])', '  return prefix[r + 1] - prefix[l]', '}']
    case 'kadane-max-subarray': return ['function maxSubarray(a) {', '  let cur = a[0], best = a[0]', '  for (let i = 1; i < a.length; i++) {', '    const extend = cur + a[i]', '    cur = extend > a[i] ? extend : a[i]', '    if (cur > best) best = cur', '  }', '  return best', '}']
    case 'merge-intervals': return ['function merge(intervals) {', '  intervals.sort((x, y) => x[0] - y[0])', '  const out = []', '  let [curS, curE] = intervals[0]', '  for (let i = 1; i < intervals.length; i++) {', '    if (intervals[i][0] <= curE) curE = Math.max(curE, intervals[i][1])', '    else { out.push([curS, curE]); [curS, curE] = intervals[i] }', '  }', '  out.push([curS, curE])', '  return out', '}']
    case 'next-greater-element': return ['function nextGreater(a) {', '  const ans = new Array(a.length).fill(-1)', '  const stack = []', '  for (let i = 0; i < a.length; i++) {', '    while (stack.length && a[stack.at(-1)] < a[i]) ans[stack.pop()] = a[i]', '    stack.push(i)', '  }', '  return ans', '}']
    case 'rotated-search': return ['function rotatedSearch(a, target) {', '  let lo = 0, hi = a.length - 1', '  while (lo <= hi) {', '    const mid = (lo + hi) >> 1', '    if (a[mid] === target) return mid', '    if (a[lo] <= a[mid]) {', '      if (a[lo] <= target && target < a[mid]) hi = mid - 1', '      else lo = mid + 1', '    } else {', '      if (a[mid] < target && target <= a[hi]) lo = mid + 1', '      else hi = mid - 1', '    }', '  }', '  return -1', '}']
    case 'linked-list-cycle': return ['function hasCycle(head) {', '  let slow = head, fast = head', '  while (fast !== null && fast.next !== null) {', '    slow = slow.next', '    fast = fast.next.next', '    if (slow === fast) return true', '  }', '  return false', '}']
    case 'frequency-count': return ['function mostFrequent(a) {', '  const count = new Map()', '  for (const v of a) count.set(v, (count.get(v) ?? 0) + 1)', '  let best = a[0], bestN = 0', '  for (const [v, n] of count) if (n > bestN) { best = v; bestN = n }', '  return best', '}']
    case 'valid-anagram': return ['function isAnagram(s, t) {', '  if (s.length !== t.length) return false', '  const count = {}', '  for (const c of s) count[c] = (count[c] ?? 0) + 1', '  for (const c of t) {', '    count[c]--', '    if (count[c] < 0) return false', '  }', '  return true', '}']
    case 'valid-palindrome': return ['function isPalindrome(s) {', '  let l = 0, r = s.length - 1', '  while (l < r) {', '    if (s[l] !== s[r]) return false', '    l++; r--', '  }', '  return true', '}']
  }
}

function pseudocode(id: PatternId): string[] {
  switch (id) {
    case 'sliding-window-max-sum': return ['FUNCTION maxWindowSum(a, k)', '    best <- -INFINITY', '    FOR s FROM 0 WHILE s + k <= LENGTH(a)', '        sum <- a[s] + ... + a[s+k-1]', '        best <- max(best, sum)', '    END FOR', '    RETURN best', 'END FUNCTION']
    case 'two-pointers-pair': return ['FUNCTION twoSumSorted(a, target)', '    L <- 0, R <- LENGTH(a) - 1', '    WHILE L < R', '        sum <- a[L] + a[R]', '        IF sum = target: RETURN [L, R]', '        IF sum < target: L <- L + 1 ELSE R <- R - 1', '    END WHILE', 'END FUNCTION']
    case 'prefix-sum-range': return ['FUNCTION rangeSum(a, l, r)', '    prefix[0] <- 0', '    FOR i FROM 0 TO LENGTH(a) - 1', '        prefix[i+1] <- prefix[i] + a[i]', '    END FOR', '    RETURN prefix[r+1] - prefix[l]', 'END FUNCTION']
    case 'kadane-max-subarray': return ['FUNCTION maxSubarray(a)', '    cur <- a[0], best <- a[0]', '    FOR i FROM 1 TO LENGTH(a) - 1', '        extend <- cur + a[i]', '        cur <- max(extend, a[i])', '        best <- max(best, cur)', '    END FOR', '    RETURN best']
    case 'merge-intervals': return ['FUNCTION merge(intervals)', '    SORT by start', '    cur <- intervals[0], out <- empty', '    FOR each next interval', '        IF start <= curEnd: curEnd <- max(curEnd, end)', '        ELSE emit cur and start the next one', '    END FOR', '    RETURN out + cur']
    case 'next-greater-element': return ['FUNCTION nextGreater(a)', '    ans <- [-1, ...], stack <- empty', '    FOR i FROM 0 TO LENGTH(a) - 1', '        WHILE stack top holds a smaller value', '            POP it and record a[i] as its answer', '        PUSH i', '    END FOR', '    RETURN ans']
    case 'rotated-search': return ['FUNCTION rotatedSearch(a, target)', '    lo <- 0, hi <- LENGTH(a) - 1', '    WHILE lo <= hi', '        mid <- (lo + hi) / 2', '        IF a[mid] = target: RETURN mid', '        IF one half is sorted AND holds target: search it', '        ELSE search the other half', '    END WHILE', 'END FUNCTION']
    case 'linked-list-cycle': return ['FUNCTION hasCycle(head)', '    slow <- head, fast <- head', '    WHILE fast AND fast.next exist', '        slow <- slow.next', '        fast <- fast.next.next', '        IF slow = fast: RETURN true', '    END WHILE', '    RETURN false']
    case 'frequency-count': return ['FUNCTION mostFrequent(a)', '    count <- empty map', '    FOR each value: count[value] <- count[value] + 1', '    RETURN the value with the largest count', 'END FUNCTION']
    case 'valid-anagram': return ['FUNCTION isAnagram(s, t)', '    count <- empty map', '    FOR each letter of s: count[letter] + 1', '    FOR each letter of t: count[letter] - 1', '    RETURN every count is zero', 'END FUNCTION']
    case 'valid-palindrome': return ['FUNCTION isPalindrome(s)', '    l <- 0, r <- LENGTH(s) - 1', '    WHILE l < r', '        IF s[l] != s[r]: RETURN false', '        l <- l + 1, r <- r - 1', '    END WHILE', '    RETURN true']
  }
}

function complexity(id: PatternId): Complexity {
  const meta = getProblem(id)!
  return { ...meta.complexity }
}

function answerText(id: PatternId, instance: ProblemInstance): { text: string; value: string | number } {
  const v = instance.values
  if (id === 'sliding-window-max-sum') {
    const k = num(instance.extras?.['k'], 3)
    let best = Number.NEGATIVE_INFINITY
    for (let s = 0; s + k <= v.length; s++) {
      let sum = 0
      for (let t = s; t < s + k; t++) sum += v[t]!
      best = Math.max(best, sum)
    }
    return { text: `max window sum ${best}`, value: best }
  }
  if (id === 'two-pointers-pair') {
    const [a, b] = (instance.extras?.['answerIndices'] as number[] | undefined) ?? [0, 1]
    return { text: `indices ${a} and ${b} sum to ${instance.target}`, value: `${a},${b}` }
  }
  if (id === 'prefix-sum-range') {
    const sum = num(instance.extras?.['rangeSum'], 0)
    return { text: `range sum ${sum}`, value: sum }
  }
  if (id === 'kadane-max-subarray') {
    let cur = v[0]!
    let best = v[0]!
    for (let i = 1; i < v.length; i++) {
      cur = Math.max(v[i]!, cur + v[i]!)
      best = Math.max(best, cur)
    }
    return { text: `max subarray sum ${best}`, value: best }
  }
  if (id === 'merge-intervals') {
    const starts = (instance.extras?.['starts'] as number[] | undefined) ?? []
    const ends = (instance.extras?.['ends'] as number[] | undefined) ?? []
    const out: Array<[number, number]> = []
    let curS = starts[0]!
    let curE = ends[0]!
    for (let i = 1; i < starts.length; i++) {
      if (starts[i]! <= curE) curE = Math.max(curE, ends[i]!)
      else {
        out.push([curS, curE])
        curS = starts[i]!
        curE = ends[i]!
      }
    }
    out.push([curS, curE])
    const text = out.map(([s, e]) => `${s}-${e}`).join(',')
    return { text: `merged: ${text}`, value: text }
  }
  if (id === 'next-greater-element') {
    const stack: number[] = []
    const ans = new Array<number>(v.length).fill(-1)
    for (let i = 0; i < v.length; i++) {
      while (stack.length > 0 && v[stack[stack.length - 1]!]! < v[i]!) ans[stack.pop()!] = v[i]!
      stack.push(i)
    }
    return { text: `next greater: ${ans.join(',')}`, value: ans.join(',') }
  }
  if (id === 'rotated-search') {
    const answerIndex = num(instance.extras?.['answerIndex'], 0)
    return { text: `target ${instance.target} at index ${answerIndex}`, value: answerIndex }
  }
  if (id === 'linked-list-cycle') {
    const hasCycle = instance.extras?.['hasCycle'] === true
    return hasCycle ? { text: 'the list has a cycle', value: 'cycle' } : { text: 'the list has no cycle', value: 'acyclic' }
  }
  if (id === 'frequency-count') {
    const counts = new Map<number, number>()
    for (const value of v) counts.set(value, (counts.get(value) ?? 0) + 1)
    let mode = v[0]!
    let modeCount = 0
    for (const [value, c] of counts) {
      if (c > modeCount) {
        modeCount = c
        mode = value
      }
    }
    return { text: `value ${mode} appears ${modeCount} times`, value: mode }
  }
  if (id === 'valid-anagram') {
    const valid = instance.extras?.['valid'] === true
    return valid ? { text: 'the strings are anagrams', value: 'valid' } : { text: 'the strings are not anagrams', value: 'invalid' }
  }
  const valid = instance.extras?.['valid'] === true
  return valid ? { text: 'the string is a palindrome', value: 'valid' } : { text: 'the string is not a palindrome', value: 'invalid' }
}

// ------------------------------------------------------------------ gameplay

function legalActions(id: PatternId, state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(id, state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Read the next item', options: { objectIds: [next.objectId] } }]
  if (next.type === 'comparePair') {
    const label =
      id === 'two-pointers-pair'
        ? 'Is the pair sum below, equal to, or above the target?'
        : id === 'kadane-max-subarray'
          ? 'Extending gives cur + value, restarting gives just the value — which is larger?'
          : id === 'merge-intervals'
            ? 'Does the next interval start inside the running merged interval?'
            : 'Compare these two items'
    return [{ type: next.type, label, options: { objectIds: [next.aId, next.bId] }, expects: 'relation' }]
  }
  if (next.type === 'pushPop')
    return [{ type: next.type, label: next.op === 'push' ? 'Push the current item onto the stack' : 'Pop every smaller item — the current value is their answer', options: { objectIds: next.objectId ? [next.objectId] : [], containerIds: [next.containerId] } }]
  if (next.type === 'assignValue') return [{ type: next.type, label: 'Record the value', expects: 'value' }]
  if (next.type === 'choosePath') return [{ type: next.type, label: 'Keep the half that can still hold the target', options: { objectIds: [next.fromId] } }]
  if (next.type === 'traverseNode') return [{ type: next.type, label: 'Advance the pointer one link', options: { objectIds: [next.fromNodeId, next.toNodeId] } }]
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Submit the result', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function context(id: PatternId) {
  return {
    codeLineText: (line: number) => source(id)[line - 1] ?? '',
    variables: (state: GameState) => ({ ...state.variables }),
    write: (_state: GameState) => {},
  }
}

function sameAction(a: Action, b: Action): boolean {
  const clean = (action: Action) => {
    const { actionId: _id, ...rest } = action
    return rest
  }
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b))
}

function parseNodeIndex(nodeId: string): number {
  if (nodeId === 'null') return -1
  const n = Number.parseInt(nodeId.slice(1), 10)
  return Number.isInteger(n) ? n : -1
}

function rotatedChoice(
  values: number[],
  target: number,
  lo: number,
  hi: number,
  mid: number,
  path: string,
): { lo: number; hi: number } {
  if (path === 'found') return { lo, hi }
  const goLeft = path === 'left'
  return goLeft ? { lo, hi: mid - 1 } : { lo: mid + 1, hi }
}

function applyAction(id: PatternId, state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const step = num(state.internal['planIndex'], 0)
  const expected = actionsFor(id, state.instance)[step]
  const ctx = context(id)
  if (state.phase !== 'playing' || !expected || !sameAction(action, expected)) {
    return finishIllegal(state, action, {
      feedback: expected ? `The next algorithm step is ${expected.type}; follow the highlighted item and try that operation.` : 'This game is already complete.',
      dsaOp: action.type === 'pushPop' && action.op === 'pop' ? 'pop' : dsaOpForAction(action),
      codeLine: expected ? codeLine(id, expected) : 1,
      note: 'This action is not legal for the current algorithm step.',
      ...ctx,
    })
  }

  const next = cloneState(state)
  next.internal['planIndex'] = step + 1
  let feedback = 'That is the next step in the algorithm.'
  let note = `${action.type} advances the algorithm.`
  let compare: string[] | undefined
  let current: string | undefined
  let dsaOp = action.type === 'pushPop' && action.op === 'pop' ? 'pop' : dsaOpForAction(action)

  switch (action.type) {
    case 'selectObject': {
      next.selection = [action.objectId]
      if (next.objects[action.objectId]) next.objects[action.objectId]!.state = 'current'
      const position = indexOf(next, action.objectId)
      if (position >= 0) {
        next.variables['i'] = position
        if (next.slots[`s${position}`]) next.cursor.iSlotId = `s${position}`
      }
      if (id === 'rotated-search' && position >= 0) next.variables['mid'] = position
      current = action.objectId
      note = `Read ${next.objects[action.objectId]?.label ?? action.objectId}.`
      break
    }
    case 'assignValue': {
      const numeric = Number(action.value)
      next.variables[action.targetId] = Number.isFinite(numeric) ? numeric : action.value
      if (id === 'sliding-window-max-sum' && action.targetId.startsWith('w_') && Number.isFinite(numeric)) {
        const best = next.variables['best']
        next.variables['best'] = typeof best === 'number' ? Math.max(best, numeric) : numeric
      }
      if (id === 'kadane-max-subarray' && action.targetId === 'cur' && Number.isFinite(numeric)) {
        const best = next.variables['best']
        if (typeof best !== 'number' || numeric > best) next.variables['best'] = numeric
      }
      feedback = `${action.targetId} now records ${action.value}.`
      note = `Store ${action.value} in ${action.targetId}.`
      break
    }
    case 'comparePair': {
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
      if (id === 'two-pointers-pair') {
        if (action.relation === 'lt') next.variables['L'] = num(next.variables['L'], 0) + 1
        else if (action.relation === 'gt') next.variables['R'] = num(next.variables['R'], 0) - 1
      }
      if (id === 'valid-palindrome') {
        next.variables['left'] = num(next.variables['left'], 0) + 1
        next.variables['right'] = num(next.variables['right'], 0) - 1
      }
      note = action.relation === 'eq' ? 'The values match.' : `The relation is ${action.relation}.`
      break
    }
    case 'pushPop': {
      const container = next.containers[action.containerId]!
      if (action.op === 'push' && action.objectId) {
        container.order.push(action.objectId)
        const object = next.objects[action.objectId]
        if (object?.slotId) {
          const slot = next.slots[object.slotId]
          if (slot) delete slot.occupantId
          delete object.slotId
        }
        if (object) object.state = 'visited'
        feedback = `${object?.label ?? 'That item'} goes on the top of the stack.`
        note = `Push ${object?.label ?? action.objectId}.`
      } else {
        const removed = container.order.pop()
        if (removed && next.objects[removed]) next.objects[removed]!.state = 'visited'
        feedback = `${removed ? next.objects[removed]?.label : 'The item'} is resolved — the current value is its next greater element.`
        note = `Pop ${removed ?? 'the top'}: it is smaller, so it is answered.`
      }
      break
    }
    case 'choosePath': {
      const lo = num(next.variables['lo'], 0)
      const hi = num(next.variables['hi'], 0)
      const mid = num(next.variables['mid'], 0)
      const target = num(next.instance.target, 0)
      const { lo: nlo, hi: nhi } = rotatedChoice(next.instance.values, target, lo, hi, mid, action.pathId)
      next.variables['lo'] = nlo
      next.variables['hi'] = nhi
      if (nlo <= nhi) next.variables['mid'] = Math.floor((nlo + nhi) / 2)
      next.selection = [action.fromId]
      current = action.fromId
      feedback = action.pathId === 'found' ? 'The target is at this position.' : `The ${action.pathId} half can still hold the target; the other half is discarded.`
      note = `Keep the ${action.pathId} half.`
      dsaOp = 'choose-path'
      break
    }
    case 'traverseNode': {
      next.cursor.nodeId = action.toNodeId
      const stepCount = num(next.internal['step'], 0)
      const parsed = parseNodeIndex(action.toNodeId)
      if (stepCount % 3 === 0) {
        next.internal['slow'] = parsed
        next.variables['slow'] = parsed
      } else {
        next.internal['fast'] = parsed
        next.variables['fast'] = parsed
      }
      next.internal['step'] = stepCount + 1
      current = action.toNodeId
      feedback = action.toNodeId === 'null' ? 'The fast pointer ran off the end — there is no cycle.' : `Follow one link to ${next.objects[action.toNodeId]?.label ?? action.toNodeId}.`
      note = 'Advance one link.'
      break
    }
    case 'submitAnswer': {
      next.phase = 'won'
      next.variables['answer'] = action.value
      feedback = 'Correct. The algorithm is complete.'
      note = 'Commit the result.'
      dsaOp = 'terminate'
      break
    }
    default:
      return finishIllegal(state, action, { feedback: 'This problem does not use that operation.', dsaOp: dsaOpForAction(action), codeLine: 1, note: 'Unsupported operation.', ...ctx })
  }

  next.progress.steps += 1
  const code = codeLine(id, action)
  const frame: TraceFrame = {
    index: next.trace.length,
    action,
    codeLine: code,
    codeLineText: source(id)[code - 1] ?? '',
    variables: { ...next.variables },
    pointers: { ...(current ? { current } : {}), ...(compare ? { compare } : {}) },
    dsaOp,
    correct: true,
    note,
  }
  next.trace.push(frame)
  return { nextState: next, outcome: { correct: true, feedback, dsaOp, traceStep: frame.index, ...(next.phase === 'won' ? { won: true } : {}) } }
}

function canonicalTrace(id: PatternId, state: GameState): TraceFrame[] {
  let current = initState(id, state.instance)
  const frames: TraceFrame[] = []
  for (const action of actionsFor(id, state.instance)) {
    const result = applyAction(id, current, action)
    if (result.outcome.illegal) break
    current = result.nextState
    const frame = current.trace[current.trace.length - 1]
    if (frame) frames.push(frame)
  }
  return frames
}

export function createPatternOracle(id: PatternId): Oracle {
  if (!IDS.includes(id)) throw new Error(`No pattern oracle for ${id}`)
  return {
    problemId: id,
    buildInstance: (input) => buildInstance(id, input),
    initState: (instance) => initState(id, instance),
    legalActions: (state) => legalActions(id, state),
    applyAction: (state, action) => applyAction(id, state, action),
    isWin: (state) => state.phase === 'won',
    canonicalTrace: (state) => canonicalTrace(id, state),
    pseudocode: () => pseudocode(id),
    code: () => source(id),
    complexity: () => complexity(id),
    answerSummary: (state) => {
      const answer = answerText(id, state.instance)
      return { text: answer.text, value: answer.value }
    },
  }
}

export const createSlidingWindowMaxSumOracle = (): Oracle => createPatternOracle('sliding-window-max-sum')
export const createTwoPointersPairOracle = (): Oracle => createPatternOracle('two-pointers-pair')
export const createPrefixSumRangeOracle = (): Oracle => createPatternOracle('prefix-sum-range')
export const createKadaneMaxSubarrayOracle = (): Oracle => createPatternOracle('kadane-max-subarray')
export const createMergeIntervalsOracle = (): Oracle => createPatternOracle('merge-intervals')
export const createNextGreaterElementOracle = (): Oracle => createPatternOracle('next-greater-element')
export const createRotatedSearchOracle = (): Oracle => createPatternOracle('rotated-search')
export const createLinkedListCycleOracle = (): Oracle => createPatternOracle('linked-list-cycle')
export const createFrequencyCountOracle = (): Oracle => createPatternOracle('frequency-count')
export const createValidAnagramOracle = (): Oracle => createPatternOracle('valid-anagram')
export const createValidPalindromeOracle = (): Oracle => createPatternOracle('valid-palindrome')
