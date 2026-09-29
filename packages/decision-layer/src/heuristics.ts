/**
 * Deterministic fallbacks for every `DecisionKind`.
 *
 * WHY this file is larger than the Laya path: Laya is a zero-shot 322M
 * classifier. On the typed-decisions benchmark it scores ~0.35 argmax accuracy
 * (0.766 only for the fine-tuned `typed-decisions` checkpoint, which is 421M
 * and out of budget on this hardware). These functions are the part that is
 * *never* wrong by omission: given the same inputs they always return the same
 * valid key, with no network, no model, and no chance of an exception.
 *
 * Every exported function is total: it returns a `DecisionOutcome` whose
 * `choice` is a member of the input label set whenever that set is non-empty.
 * With an empty label set there is no correct answer to give, so `choice` is
 * `''` and `confidence` is 0 — see the note on `emptyOutcome`.
 */

import {
  DIFFICULTIES,
  PROBLEMS,
  TOPIC_LABELS,
  isDsaOp,
  type DsaOp,
  type Difficulty,
  type DsaTopic,
  type ProblemMeta,
} from '@dsa/game-schema'
import type { DecisionOutcome } from './types.js'

// ------------------------------------------------------------- primitives

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  // 4dp: Laya's own answers are rounded to 4dp, so keeping the same precision
  // avoids a confidence of 0.8999999999999999 reaching a Flutter client.
  return Math.round(n * 10_000) / 10_000
}

function heuristic(choice: string, confidence: number, distribution?: Record<string, number>): DecisionOutcome {
  return {
    choice,
    confidence: clamp01(confidence),
    source: 'heuristic',
    ...(distribution ? { distribution } : {}),
  }
}

/** The only honest answer when the caller supplied no label set. */
function emptyOutcome(): DecisionOutcome {
  return heuristic('', 0)
}

/**
 * Split free text into lowercase word tokens. Hyphens and slashes are
 * separators, so `binary-search`, `push/pop` and `two_sum` all tokenise into
 * their parts — which is also what the keyword tables below are written in.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0)
}

/** Inflections we treat as the same word. Deliberately tiny and hand-listed. */
const INFLECTIONS: readonly string[] = ['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ger', 'iest', 'ly', 'ise', 'ize']

/** True when `token` is `word` or a simple inflection of it. */
function isWordForm(token: string, word: string): boolean {
  for (const suffix of INFLECTIONS) {
    if (token === word + suffix) return true
  }
  return false
}

/** Whole-token membership, inflection-tolerant. */
function hasWord(tokens: readonly string[], word: string): boolean {
  for (const t of tokens) if (isWordForm(t, word)) return true
  return false
}

/** Contiguous multi-word match, inflection-tolerant on every word. */
function hasPhrase(tokens: readonly string[], phrase: string): boolean {
  const words = tokenize(phrase)
  if (words.length === 0) return false
  if (words.length === 1) return hasWord(tokens, words[0] as string)
  for (let i = 0; i + words.length <= tokens.length; i++) {
    let ok = true
    for (let j = 0; j < words.length; j++) {
      const token = tokens[i + j]
      const word = words[j]
      if (token === undefined || word === undefined || !isWordForm(token, word)) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

function hasAny(tokens: readonly string[], keywords: readonly string[]): boolean {
  for (const k of keywords) if (hasPhrase(tokens, k)) return true
  return false
}

/** FNV-1a, 32-bit. Stable across runs and platforms (unlike `String.hashCode` w/e). */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ------------------------------------------------------------ routeProblem

/**
 * Vocabulary, hand-written from the problem titles, learning objectives, topic
 * labels and canonical algorithms in `game-schema`.
 *
 * `specific` = distinctive algorithm vocabulary, weighted 4. A hit here is
 * strong evidence.
 * `topic` = vocabulary shared by every problem in a topic, weighted 2. A hit
 * distinguishes the topic but usually not which problem inside it, so ties are
 * expected and are resolved by the topic's entry problem (see `TOPIC_ENTRY`).
 *
 * A third, weaker signal is derived at runtime from the registry text itself
 * (title, learningObjective, canonicalAlgorithm) at weight 1, so adding a
 * problem to `game-schema` needs no edit here to become routable.
 */
const KEYWORDS: Readonly<Record<string, { specific: readonly string[]; topic: readonly string[] }>> = {
  'binary-search': {
    specific: [
      'binary',
      'binary search',
      'halve',
      'halving',
      'midpoint',
      'mid point',
      'logarithmic',
      'log n',
      'bisect',
    ],
    topic: ['search', 'lookup', 'sorted', 'target', 'find', 'index of'],
  },
  'array-max-min': {
    specific: [
      'max',
      'maximum',
      'min',
      'minimum',
      'biggest',
      'largest',
      'smallest',
      'highest',
      'lowest',
      'greatest',
      'running best',
      'max value',
      'min value',
      'biggest number',
      'largest number',
    ],
    topic: ['scan', 'array', 'value', 'running', 'best', 'find'],
  },
  'two-sum': {
    specific: [
      'two sum',
      'pair sum',
      'two numbers',
      'complement',
      'hash set',
      'hash map',
      'hashmap',
      'seen set',
      'add up to',
      'sum to',
      'target sum',
    ],
    topic: ['sum', 'pair', 'add', 'target', 'numbers', 'complement'],
  },
  'move-zeroes': {
    specific: [
      'zeroes',
      'zeros',
      'move zero',
      'move zeros',
      'non zero',
      'nonzero',
      'write pointer',
      'read pointer',
      'two pointer',
      'to the end',
      'partition',
      'in place',
    ],
    topic: ['move', 'relocate', 'shift', 'compact', 'tail', 'stable'],
  },
  'bubble-sort': {
    specific: ['bubble', 'bubble sort', 'adjacent', 'adjacent pair', 'inversion', 'bubbles up'],
    topic: ['sort', 'sorting', 'sorted', 'order', 'ascending', 'descending'],
  },
  'selection-sort': {
    specific: [
      'selection sort',
      'selection',
      'unsorted suffix',
      'n 1 swaps',
      'min into place',
      'smallest into',
      'select the min',
      'select the minimum',
      'select the smallest',
      'scan for the min',
    ],
    topic: ['sort', 'sorting', 'sorted', 'order', 'ascending', 'descending'],
  },
  'valid-parentheses': {
    specific: [
      'parentheses',
      'parenthesis',
      'brackets',
      'bracket',
      'balanced',
      'balance',
      'matching pairs',
      'matching pair',
      'nesting',
      'mismatched',
      'opening bracket',
      'closing bracket',
      'braces',
      'curly',
      'square bracket',
    ],
    topic: ['stack', 'pop', 'push', 'lifo', 'last in first out', 'pairs'],
  },
  'stack-push-pop': {
    specific: [
      'stack push',
      'stack pop',
      'push pop',
      'push and pop',
      'pushes and pops',
      'underflow',
      'overflow',
      'stack operation',
      'stack simulation',
      'capacity',
      'top of the stack',
    ],
    topic: ['stack', 'pop', 'push', 'lifo', 'last in', 'pushes', 'pops'],
  },
  'queue-operations': {
    specific: [
      'queue',
      'fifo',
      'first in first out',
      'enqueue',
      'dequeue',
      'circular buffer',
      'circular queue',
      'rear pointer',
      'front pointer',
      'rear',
      'enqueue dequeue',
    ],
    topic: ['queue', 'fifo', 'order', 'wrap', 'buffer'],
  },
  'linked-list-traversal': {
    specific: [
      'traversal',
      'traverse',
      'traversing',
      'walk the list',
      'next pointer',
      'follow pointers',
      'no indexing',
      'reach position',
      'from the head',
    ],
    topic: ['linked list', 'list', 'node', 'pointer', 'head', 'position'],
  },
  'reverse-linked-list': {
    specific: [
      'reverse a linked list',
      'reverse the list',
      'reverse linked list',
      'reverse the linked list',
      'reverse',
      'reversing',
      'flipping pointers',
      'rewire',
      'new head',
      'prev and next',
    ],
    topic: ['linked list', 'list', 'node', 'pointer', 'reverse', 'head'],
  },
  'sliding-window-max-sum': {
    specific: [
      'sliding window',
      'window sum',
      'window of size k',
      'maximum sum subarray of size k',
      'fixed window',
      'slide the window',
    ],
    topic: ['window', 'subarray', 'contiguous', 'sum', 'slide'],
  },
  'two-pointers-pair': {
    specific: [
      'two pointers',
      'two pointers pair',
      'sorted array pair',
      'two sum sorted',
      'converging pointers',
      'opposite ends',
    ],
    topic: ['pair', 'sorted', 'sum', 'target', 'pointers'],
  },
  'prefix-sum-range': {
    specific: [
      'prefix sum',
      'prefix array',
      'range sum',
      'range query',
      'cumulative sum',
      'subarray sum query',
    ],
    topic: ['prefix', 'range', 'sum', 'query', 'cumulative'],
  },
  'kadane-max-subarray': {
    specific: [
      'kadane',
      'maximum subarray',
      'max subarray',
      'extend or restart',
      'maximum subarray sum',
    ],
    topic: ['subarray', 'maximum', 'contiguous', 'sum'],
  },
  'merge-intervals': {
    specific: [
      'merge intervals',
      'overlapping intervals',
      'interval overlap',
      'meeting rooms',
      'insert interval',
    ],
    topic: ['interval', 'overlap', 'merge', 'schedule'],
  },
  'next-greater-element': {
    specific: [
      'next greater',
      'next greater element',
      'monotonic stack',
      'monotone stack',
      'decreasing stack',
      'daily temperatures',
    ],
    topic: ['greater', 'stack', 'monotonic', 'next'],
  },
  'rotated-search': {
    specific: [
      'rotated',
      'rotated array',
      'rotated sorted',
      'search in rotated',
      'pivot',
      'find minimum in rotated',
    ],
    topic: ['search', 'rotated', 'sorted', 'target', 'pivot'],
  },
  'linked-list-cycle': {
    specific: [
      'cycle detection',
      'linked list cycle',
      'tortoise and hare',
      'fast and slow pointers',
      'floyd',
      'cycle in linked list',
      'has cycle',
    ],
    topic: ['cycle', 'linked list', 'node', 'pointer', 'slow', 'fast'],
  },
  'frequency-count': {
    specific: [
      'frequency',
      'frequency count',
      'most frequent',
      'count occurrences',
      'hash map count',
      'top k frequent',
    ],
    topic: ['frequency', 'count', 'hash', 'map', 'occurrences'],
  },
  'valid-anagram': {
    specific: ['anagram', 'valid anagram', 'group anagrams', 'letter counts match', 'same letters'],
    topic: ['anagram', 'letters', 'string', 'count', 'characters'],
  },
  'valid-palindrome': {
    specific: ['palindrome', 'valid palindrome', 'symmetric string', 'reads the same', 'outside in'],
    topic: ['palindrome', 'string', 'symmetric', 'mirror'],
  },
  'tree-traversals': {
    specific: [
      'tree traversal',
      'traverse a tree',
      'preorder',
      'pre order',
      'inorder',
      'in order traversal',
      'postorder',
      'post order',
      'dfs tree',
      'visit left',
    ],
    topic: ['tree', 'traversal', 'binary tree', 'root', 'child', 'subtree'],
  },
  'bst-validate': {
    specific: [
      'validate bst',
      'validate binary search tree',
      'is bst',
      'is valid bst',
      'inorder sorted',
      'bst property',
      'kth smallest',
    ],
    topic: ['bst', 'binary search tree', 'valid', 'sorted', 'inorder'],
  },
  'tree-level-order': {
    specific: [
      'level order',
      'level order traversal',
      'breadth first',
      'breadth first search',
      'bfs',
      'bfs tree',
      'queue traversal',
      'level by level',
    ],
    topic: ['level', 'breadth', 'queue', 'tree', 'levels'],
  },
  'bst-search': {
    specific: [
      'search bst',
      'search binary search tree',
      'bst search',
      'bst lookup',
      'find in bst',
      'search a tree',
    ],
    topic: ['search', 'bst', 'tree', 'target', 'descend'],
  },
  'kth-largest-heap': {
    specific: [
      'kth largest',
      'k largest',
      'min heap',
      'size k heap',
      'top k',
      'heap',
      'heapify',
      'sift down',
    ],
    topic: ['heap', 'largest', 'kth', 'top', 'minimum'],
  },
}

const W_TOPIC = 2
const W_SPECIFIC = 4
const W_WEAK = 1

/**
 * Words too common to carry routing signal. Used only to filter the weak
 * signal derived from the registry prose, so "For each token" does not make
 * every stack problem look like the token problem.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'both', 'by', 'can', 'did', 'does',
  'each', 'every', 'for', 'from', 'get', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'keep', 'let', 'like', 'make', 'makes', 'me', 'more', 'most', 'my', 'need', 'new', 'no',
  'not', 'now', 'of', 'off', 'on', 'one', 'only', 'or', 'other', 'our', 'out', 'over', 'per', 'read',
  'repeat', 'report', 'set', 'so', 'start', 'stop', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'up', 'us', 'use', 'used', 'using', 'via', 'want',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with',
  'would', 'you', 'your',
])

interface WeakIndex {
  /** problem id -> derived weak keywords */
  byProblem: ReadonlyMap<string, readonly string[]>
  /** problem id -> topic label words */
  topicWords: ReadonlyMap<string, readonly string[]>
}

let weakIndexCache: WeakIndex | null = null

function weakIndex(): WeakIndex {
  if (weakIndexCache) return weakIndexCache
  const byProblem = new Map<string, readonly string[]>()
  const topicWords = new Map<string, readonly string[]>()
  for (const p of PROBLEMS) {
    const words = new Set<string>()
    // Stopwords are filtered everywhere, titles included: "Find the target in a
    // sorted array" contributes `find/target/sorted/array`, not `the`, which
    // would otherwise score 1 against literally any sentence.
    for (const field of [p.title, p.learningObjective, p.canonicalAlgorithm]) {
      for (const t of tokenize(field)) {
        if (t.length > 2 && !STOPWORDS.has(t)) words.add(t)
      }
    }
    byProblem.set(p.id, [...words])
    topicWords.set(p.id, tokenize(TOPIC_LABELS[p.topic]))
  }
  weakIndexCache = { byProblem, topicWords }
  return weakIndexCache
}

export interface ProblemScore {
  id: string
  topic: DsaTopic
  score: number
  /** Best keyword hit, for debuggability and for the "how strong is this" factor. */
  bestKeyword: string | null
}

/** Full ranking. Exported so the API can log why a route was chosen. */
export function scoreProblems(freeText: string, allowedIds?: readonly string[]): ProblemScore[] {
  const tokens = tokenize(freeText)
  const idx = weakIndex()
  const allow = allowedIds ? new Set(allowedIds) : null
  const rows: ProblemScore[] = []
  for (const p of PROBLEMS) {
    if (allow && !allow.has(p.id)) continue
    const keywords = KEYWORDS[p.id]
    let score = 0
    let bestKeyword: string | null = null
    if (keywords) {
      for (const k of keywords.specific) {
        if (hasPhrase(tokens, k)) {
          score += W_SPECIFIC
          bestKeyword = bestKeyword ?? k
        }
      }
      // The topic label words are always part of the topic signal, so a problem
      // becomes routable from its topic alone even if the table drifts.
      for (const k of [...keywords.topic, ...(idx.topicWords.get(p.id) ?? [])]) {
        if (hasPhrase(tokens, k)) score += W_TOPIC
      }
    }
    for (const k of idx.byProblem.get(p.id) ?? []) {
      if (hasPhrase(tokens, k)) {
        score += W_WEAK
        bestKeyword = bestKeyword ?? k
      }
    }
    rows.push({ id: p.id, topic: p.topic, score, bestKeyword })
  }
  rows.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
  return rows
}

/**
 * The problem a topic-level request resolves to when nothing distinguishes its
 * members: the entry-level problem a learner would meet first. This is what
 * makes "I want to practice sorting" deterministic instead of an arbitrary
 * registry-order tie-break.
 */
const TOPIC_ENTRY: Readonly<Record<DsaTopic, string>> = {
  'binary-search': 'binary-search',
  arrays: 'array-max-min',
  sorting: 'bubble-sort',
  stack: 'valid-parentheses',
  queue: 'queue-operations',
  'linked-list': 'linked-list-traversal',
  'hash-table': 'frequency-count',
  strings: 'valid-palindrome',
  trees: 'tree-traversals',
  heap: 'kth-largest-heap',
}

/** Score at which a match is considered as strong as it plausibly gets. */
const SCORE_SATURATION = 6

/**
 * Route free text to a problem id.
 *
 * Confidence combines the *margin* over the runner-up with the *absolute*
 * strength of the winning match. Margin alone would be dangerous: a request
 * matching exactly one weak word would show margin 1.0 and look certain, when
 * in truth it barely matched at all. Both are needed for the number to mean
 * something.
 */
export function routeProblem(freeText: string, allowedIds?: readonly string[]): DecisionOutcome {
  const ranked = scoreProblems(freeText, allowedIds)
  const first = ranked[0]
  if (!first) return emptyOutcome()
  if (first.score === 0) {
    // No evidence at all. Fall back to the first *allowed* problem in registry
    // order (not PROBLEMS[0], which may be outside the caller's option set) and
    // say so loudly in the confidence so the API can ask for clarification.
    const pool = allowedIds && allowedIds.length > 0 ? PROBLEMS.filter((p) => allowedIds.includes(p.id)) : PROBLEMS
    const fallback = pool[0]
    return fallback ? heuristic(fallback.id, 0.15) : emptyOutcome()
  }

  // A topic-level request ties inside its topic. Prefer that topic's entry
  // problem, which is a real choice, not an arbitrary one.
  let best = first
  const tied = ranked.filter((r) => r.score === first.score)
  if (tied.length > 1) {
    const entry = tied.find((r) => TOPIC_ENTRY[r.topic] === r.id)
    if (entry) best = entry
  }

  const second = ranked.find((r) => r !== best)
  const runnerUp = second?.score ?? 0
  const margin = (best.score - runnerUp) / best.score
  const strength = Math.min(1, best.score / SCORE_SATURATION)
  const confidence = 0.4 + 0.6 * margin * strength
  return heuristic(best.id, confidence)
}

// -------------------------------------------------------------- pickTheme

/**
 * Deterministic theme selection.
 *
 * Without a steer it is a pure rotation over the candidates, seeded by hashing
 * the candidate list together with the free text. Same inputs, same theme —
 * required, because "Retry with New Game" must not reshuffle the theme of an
 * unchanged request, and because tests must be reproducible.
 *
 * A free-text token overlap with a candidate name overrides the rotation: if
 * the player said "neon", they get the neon theme. The override is a nudge, not
 * a veto, so an unrelated candidate list still gets a stable answer.
 */
export function pickTheme(candidates: readonly string[], freeText?: string): DecisionOutcome {
  if (candidates.length === 0) return emptyOutcome()
  // Length-prefixed so the seed is unambiguous even if a candidate key
  // contains the separators. All printable ASCII: a NUL separator would be
  // tidier but makes the source file read as binary to grep and `file`.
  const seed = `${candidates.length}:${candidates.join(',')}|${freeText ?? ''}`
  const rotation = hashString(seed) % candidates.length

  if (!freeText) return heuristic(candidates[rotation] ?? '', 0.5)

  const textTokens = tokenize(freeText)
  if (textTokens.length === 0) return heuristic(candidates[rotation] ?? '', 0.5)

  let bestIndex = -1
  let bestOverlap = 0
  const overlap: number[] = []
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i] ?? ''
    const nameTokens = tokenize(candidate)
    let hits = 0
    for (const nameToken of nameTokens) {
      if (nameToken.length < 3) continue
      if (hasWord(textTokens, nameToken)) hits += 1
    }
    overlap.push(hits)
    if (hits > bestOverlap) {
      bestOverlap = hits
      bestIndex = i
    }
  }

  if (bestIndex < 0 || bestOverlap === 0) {
    // Nothing matched: fall back to the rotation, but bias it by the stable
    // hash so we are not simply handing back candidate 0 every time.
    return heuristic(candidates[rotation] ?? '', 0.5)
  }
  const shares: Record<string, number> = {}
  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i]
    if (key !== undefined) shares[key] = overlap[i] ?? 0
  }
  const confidence = 0.6 + 0.3 * Math.min(1, bestOverlap / Math.max(1, overlap[bestIndex] ?? 1))
  return heuristic(candidates[bestIndex] ?? '', confidence, shares)
}

// ---------------------------------------------------------------- pickHint

/** How a hint is judged to be on-topic for the player's most recent mistake. */
const DSA_OP_HINT_WORDS: Readonly<Record<DsaOp, readonly string[]>> = {
  compare: ['compare', 'comparison', 'less', 'greater', 'bigger', 'smaller', 'lt', 'gt'],
  'choose-path': ['half', 'left', 'right', 'mid', 'discard', 'narrow', 'search space'],
  swap: ['swap', 'exchange', 'positions', 'order'],
  move: ['move', 'relocate', 'write pointer', 'read pointer', 'shift'],
  insert: ['insert', 'add', 'inserted'],
  push: ['push', 'stack', 'top'],
  pop: ['pop', 'stack', 'top', 'underflow'],
  traverse: ['next', 'node', 'traverse', 'head', 'pointer'],
  link: ['next', 'prev', 'link', 'pointer', 'rewire'],
  unlink: ['next', 'prev', 'unlink', 'cut', 'pointer'],
  assign: ['assign', 'write', 'value', 'complement', 'best', 'max', 'sum'],
  read: ['read', 'index', 'value', 'position', 'inspect'],
  terminate: ['answer', 'submit', 'final', 'result', 'report'],
}

/**
 * The next hint.
 *
 * Contract: the pool is consumed in order and index `hintsUsed` is served, so
 * the first hint is always the most general one and the last is the most
 * specific. `hintsUsed` beyond the end of the pool clamps to the last entry
 * rather than returning undefined — the player asked for a hint and gets the
 * most specific one we have.
 *
 * `lastMistakeDsaOp` may advance the index *within* the still-unused suffix
 * towards the first hint that talks about the operation they just got wrong.
 * It never moves the index backwards past `hintsUsed`, so nothing is served
 * twice out of order.
 */
export function pickHint(
  hintPool: readonly string[],
  hintsUsed: number,
  lastMistakeDsaOp?: string,
): DecisionOutcome {
  if (hintPool.length === 0) return emptyOutcome()
  const used = Number.isFinite(hintsUsed) ? Math.max(0, Math.trunc(hintsUsed)) : 0
  const clamped = Math.min(used, hintPool.length - 1)
  const exhausted = used >= hintPool.length

  let index = clamped
  let aligned = false
  if (lastMistakeDsaOp && isDsaOp(lastMistakeDsaOp) && !exhausted) {
    const words = DSA_OP_HINT_WORDS[lastMistakeDsaOp]
    for (let i = used; i < hintPool.length; i++) {
      const hint = hintPool[i]
      if (hint !== undefined && hasAny(tokenize(hint), words)) {
        index = i
        aligned = true
        break
      }
    }
  }

  const hint = hintPool[index] ?? ''
  const remaining = hintPool.length - index
  let confidence: number
  if (exhausted) {
    // Repeating the final hint: we are out of things to offer, and saying so
    // with high confidence would be a lie about the hint's specificity.
    confidence = 0.3
  } else {
    // More general hints are safer to hand over, and the pool still has room to
    // get more specific: 0.7 .. 0.95.
    confidence = 0.7 + 0.25 * (remaining / hintPool.length)
    if (aligned) confidence = Math.min(0.98, confidence + 0.03)
  }
  return heuristic(hint, confidence)
}

// ------------------------------------------------------- tagMisconception

/**
 * Fixed label set. Deliberately six labels for thirteen `DsaOp`s: the debrief
 * screen has room for one short sentence, so the labels describe the *shape of
 * the thinking error*, not the mechanic that was misused.
 */
export const MISCONCEPTION_LABELS = [
  'off-by-one-halving',
  'wrong-comparison',
  'unstable-ordering',
  'stack-discipline',
  'pointer-confusion',
  'value-vs-index',
  'no-mistakes',
] as const

export type MisconceptionLabel = (typeof MISCONCEPTION_LABELS)[number]

const OP_TO_LABEL: Readonly<Record<DsaOp, MisconceptionLabel>> = {
  // Discarding the wrong half of the window: the classic half-open-vs-closed
  // interval bug, which in binary search wears a choose-path costume.
  'choose-path': 'off-by-one-halving',
  compare: 'wrong-comparison',
  swap: 'unstable-ordering',
  move: 'unstable-ordering',
  insert: 'unstable-ordering',
  push: 'stack-discipline',
  pop: 'stack-discipline',
  traverse: 'pointer-confusion',
  link: 'pointer-confusion',
  unlink: 'pointer-confusion',
  assign: 'value-vs-index',
  terminate: 'value-vs-index',
  read: 'value-vs-index',
}

/** Labels in debrief-priority order, used to rank tied mistake groups. */
const LABEL_PRIORITY: Readonly<Record<MisconceptionLabel, number>> = {
  'no-mistakes': 0,
  'wrong-comparison': 1,
  'value-vs-index': 2,
  'off-by-one-halving': 3,
  'stack-discipline': 4,
  'unstable-ordering': 5,
  'pointer-confusion': 6,
}

export interface MisconceptionTag {
  label: MisconceptionLabel
  /** How many mistakes drove the label. 0 when there were no mistakes. */
  count: number
  totalMistakes: number
  /** Per-label mistake counts. Sums to `totalMistakes`. */
  distribution: Record<string, number>
}

/**
 * The only two fields the tagger reads off a frame. Declared structurally
 * rather than as `TraceFrame` so callers that have an op list instead of a
 * replayed game do not have to fabricate actions, code lines and variables in
 * order to count mistakes. `TraceFrame` satisfies it.
 */
export interface MistakeSource {
  readonly dsaOp: DsaOp
  readonly correct: boolean
}

export function tagMisconceptionDetailed(trace: readonly MistakeSource[]): MisconceptionTag {
  const counts = new Map<MisconceptionLabel, number>()
  let total = 0
  for (const frame of trace) {
    if (frame.correct) continue
    if (!isDsaOp(frame.dsaOp)) continue
    const label = OP_TO_LABEL[frame.dsaOp]
    counts.set(label, (counts.get(label) ?? 0) + 1)
    total += 1
  }
  const distribution: Record<string, number> = {}
  for (const [label, n] of counts) distribution[label] = n

  if (total === 0) {
    return { label: 'no-mistakes', count: 0, totalMistakes: 0, distribution: {} }
  }

  let best: MisconceptionLabel = 'no-mistakes'
  let bestCount = -1
  for (const label of MISCONCEPTION_LABELS) {
    if (label === 'no-mistakes') continue
    const n = counts.get(label) ?? 0
    if (n === 0) continue
    // More mistakes wins; equal counts are broken by label priority so a
    // 1-and-1 trace still tags deterministically.
    if (n > bestCount || (n === bestCount && LABEL_PRIORITY[label] < LABEL_PRIORITY[best])) {
      best = label
      bestCount = n
    }
  }
  return { label: best, count: Math.max(0, bestCount), totalMistakes: total, distribution }
}

/**
 * The misconception tag. `distribution` carries the per-label mistake shares
 * (summing to 1) rather than the raw counts, so it is a real distribution; use
 * `tagMisconceptionDetailed` when the raw count is needed.
 */
export function tagMisconception(trace: readonly MistakeSource[]): DecisionOutcome {
  const tag = tagMisconceptionDetailed(trace)
  if (tag.totalMistakes === 0) {
    // We are certain there were no mistakes: that is a checkable fact about the
    // trace, not a prediction.
    return heuristic(tag.label, 1, { 'no-mistakes': 1 })
  }
  const shares: Record<string, number> = {}
  for (const [label, n] of Object.entries(tag.distribution)) shares[label] = n / tag.totalMistakes
  const share = tag.count / tag.totalMistakes
  // A dominant error is a confident diagnosis; a 50/50 trace is a coin flip.
  return heuristic(tag.label, 0.6 + 0.35 * share, shares)
}

// -------------------------------------------------------------- difficulty

/** Boundaries of the `challenge` scale; see `difficulty`. */
const DIFF_EASY_MAX = 35
const DIFF_MEDIUM_MAX = 65
/** The widest possible distance from a boundary is half a band. */
const DIFF_HALF_BAND = (DIFF_MEDIUM_MAX - DIFF_EASY_MAX) / 2

/**
 * Adaptive difficulty from how the player is doing.
 *
 * DIRECTION — the one thing not to get wrong reading this:
 *
 *   more mistakes, more hints  =>  a LOWER label
 *   fewer mistakes, long clean run  =>  a HIGHER label
 *
 * So `difficulty(...)` returning `'hard'` means **"let the player try harder"**:
 * they are coping, so hand them the harder variant. Returning `'easy'` means
 * they are drowning, so scaffold them down. The label names the *task*
 * difficulty assigned, which is the opposite direction to the player's
 * experience of it.
 *
 * Consequence, and the reason this is monotone **decreasing** in mistakes: the
 * output is non-increasing as `mistakes` grows. `difficulty` is a fixed function
 * of `(steps, mistakes, hintsUsed)` with no memory, so it cannot flip direction
 * on later calls.
 *
 * `steps` gets only a small, capped bonus: a struggling player also takes a lot
 * of steps, so step count alone is weak evidence of competence. It is scaled
 * against a reference of 40 steps and capped at +15.
 */
export function difficulty(steps: number, mistakes: number, hintsUsed: number): DecisionOutcome {
  const s = finite(steps)
  const m = finite(mistakes)
  const h = finite(hintsUsed)

  let challenge = 50
  challenge -= Math.min(50, m * 8)
  challenge -= Math.min(25, h * 5)
  challenge += Math.min(15, Math.max(0, s) / 40) * 15
  challenge = Math.max(0, Math.min(100, challenge))

  const choice: Difficulty =
    challenge < DIFF_EASY_MAX ? 'easy' : challenge < DIFF_MEDIUM_MAX ? 'medium' : 'hard'

  // How far the score sits from the nearest boundary. On a boundary the call is
  // a coin flip; in the middle of a band it is not.
  const distance = Math.min(
    Math.abs(challenge - DIFF_EASY_MAX),
    Math.abs(challenge - DIFF_MEDIUM_MAX),
  )
  const confidence = 0.55 + 0.4 * Math.min(1, distance / DIFF_HALF_BAND)
  return heuristic(choice, confidence, { [choice]: 1 })
}

function finite(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

// -------------------------------------------------------------- label sets

/**
 * Force a choice to be a key of `options`, or return `null` when that is
 * impossible. The engine uses this to honour the api-types promise that
 * `DecideResponse.choice` is always a key of the request's `options` — a label
 * is never invented, and a Laya answer outside the set is discarded rather
 * than snapped onto something plausible.
 */
export function constrainToKeys(
  choice: string,
  options: Readonly<Record<string, string>>,
  preference: readonly string[] = [],
): string | null {
  if (Object.prototype.hasOwnProperty.call(options, choice)) return choice
  for (const key of preference) {
    if (Object.prototype.hasOwnProperty.call(options, key)) return key
  }
  const first = Object.keys(options)[0]
  return first ?? null
}

/** Options ordered easy -> medium -> hard, so a missing band degrades sensibly. */
export const DIFFICULTY_PREFERENCE: readonly string[] = DIFFICULTIES

export type { ProblemMeta }
