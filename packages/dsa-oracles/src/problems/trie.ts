/**
 * Prefix search on a static trie: shared prefixes share nodes.
 *
 * The trie is prebuilt (insertion is a construction lesson of its own and
 * would double the game): the player walks the query letter by letter with
 * `traverseNode` — falling off means no completions — then `selectObject`s
 * every word-end in the landed subtree in DFS order and submits the count.
 * Word-ends are visible from the start as `end_*` variables, the way terminal
 * markers are stored on real trie nodes.
 *
 * Nodes render in the clients' existing node lane (the linked-list lane:
 * `hasListShape` is satisfied by the links, the walk from the root covers one
 * path and the rest is appended). No new renderer.
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
  TraceFrame,
} from '@dsa/game-schema'
import {
  cloneState,
  dsaOpForAction,
  getProblem,
  linearSlots,
  makeRng,
  randInt,
  PROBLEM_IDS,
} from '@dsa/game-schema'
import { finishIllegal, num, type CodeLang } from '../shared/kernel.js'

const PROBLEM_ID = 'trie-prefix-search' as const

const LETTERS = ['a', 'b', 'c', 'd', 'e'] as const

interface TrieNodeSpec {
  id: string
  ch: string
}

interface TrieLinkSpec {
  from: string
  to: string
}

interface BuiltTrie {
  nodes: TrieNodeSpec[]
  links: TrieLinkSpec[]
  /** parent id -> sorted [(char, child id)]. */
  children: Map<string, Array<{ ch: string; id: string }>>
  ends: Set<string>
}

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

function randomWord(rng: () => number, minLen: number, maxLen: number): string {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1))
  return Array.from({ length: len }, () => LETTERS[Math.floor(rng() * LETTERS.length)]!).join('')
}

function buildTrie(words: readonly string[]): BuiltTrie {
  const nodes: TrieNodeSpec[] = [{ id: 't0', ch: '' }]
  const links: TrieLinkSpec[] = []
  const childKey = new Map<string, string>()
  const ends = new Set<string>()
  for (const word of [...words].sort()) {
    let cur = 't0'
    for (const ch of word) {
      const key = `${cur}:${ch}`
      let next = childKey.get(key)
      if (next === undefined) {
        next = `t${nodes.length}`
        nodes.push({ id: next, ch })
        links.push({ from: cur, to: next })
        childKey.set(key, next)
      }
      cur = next
    }
    ends.add(cur)
  }
  const children = new Map<string, Array<{ ch: string; id: string }>>()
  for (const node of nodes) children.set(node.id, [])
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const link of links) {
    const child = byId.get(link.to)
    if (child) children.get(link.from)?.push({ ch: child.ch, id: child.id })
  }
  for (const list of children.values()) list.sort((a, b) => (a.ch < b.ch ? -1 : a.ch > b.ch ? 1 : a.id < b.id ? -1 : 1))
  return { nodes, links, children, ends }
}

function childOf(trie: BuiltTrie, parent: string, ch: string): string | undefined {
  return trie.children.get(parent)?.find((c) => c.ch === ch)?.id
}

/** Completion end-nodes under `root` in DFS order (children sorted). */
function completionsUnder(trie: BuiltTrie, root: string): string[] {
  const out: string[] = []
  const dfs = (id: string): void => {
    if (trie.ends.has(id)) out.push(id)
    for (const c of trie.children.get(id) ?? []) dfs(c.id)
  }
  dfs(root)
  return out
}

function readTrie(instance: ProblemInstance): BuiltTrie {
  const rawNodes = (instance.extras?.['trieNodes'] as Array<{ id: string; ch: string }> | undefined) ?? []
  const rawLinks = (instance.extras?.['trieLinks'] as Array<{ from: string; to: string }> | undefined) ?? []
  const rawEnds = (instance.extras?.['ends'] as string[] | undefined) ?? []
  const nodes: TrieNodeSpec[] = rawNodes.map((n) => ({ id: String(n.id), ch: String(n.ch) }))
  const links: TrieLinkSpec[] = rawLinks.map((l) => ({ from: String(l.from), to: String(l.to) }))
  const ends = new Set(rawEnds.map(String))
  const children = new Map<string, Array<{ ch: string; id: string }>>()
  for (const node of nodes) children.set(node.id, [])
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const link of links) {
    const child = byId.get(link.to)
    if (child) children.get(link.from)?.push({ ch: child.ch, id: child.id })
  }
  for (const list of children.values()) list.sort((a, b) => (a.ch < b.ch ? -1 : a.ch > b.ch ? 1 : a.id < b.id ? -1 : 1))
  return { nodes, links, children, ends }
}

// ------------------------------------------------------------------ instance

function buildInstance(input: BuildInstanceInput): ProblemInstance {
  const meta = getProblem(PROBLEM_ID)
  if (!meta) throw new Error(`${PROBLEM_ID} is missing from the catalogue`)
  const rng = makeRng(input.seed)

  // Two cores with different first letters guarantee shared prefixes — the
  // whole point of a trie — rather than a forest of singletons.
  const core1 = LETTERS[Math.floor(rng() * LETTERS.length)]!
  let core2 = LETTERS[Math.floor(rng() * LETTERS.length)]!
  while (core2 === core1) core2 = LETTERS[Math.floor(rng() * LETTERS.length)]!
  const words = new Set<string>()
  const want1 = 2 + Math.floor(rng() * 2)
  const want2 = 2 + Math.floor(rng() * 2)
  let guard = 0
  while ([...words].filter((w) => w.startsWith(core1)).length < want1 && guard++ < 60) {
    const word = (core1 + randomWord(rng, 1, 3)).slice(0, 4)
    if (word.length >= 2) words.add(word)
  }
  guard = 0
  while ([...words].filter((w) => w.startsWith(core2)).length < want2 && guard++ < 60) {
    const word = (core2 + randomWord(rng, 1, 3)).slice(0, 4)
    if (word.length >= 2) words.add(word)
  }
  const wordList = [...words].sort()
  const trie = buildTrie(wordList)

  // Query: a proper prefix with completions, preferring one shared by 2+.
  const prefixCounts = new Map<string, number>()
  for (const w of wordList) {
    for (let p = 1; p < w.length; p++) {
      const prefix = w.slice(0, p)
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1)
    }
  }
  const shared = [...prefixCounts.entries()].filter(([, c]) => c >= 2).map(([p]) => p).sort()
  const pool = shared.length > 0 ? shared : [...prefixCounts.keys()].sort()
  const query = pool[Math.floor(rng() * pool.length)] ?? wordList[0]!.slice(0, 1)
  const completions = wordList.filter((w) => w.startsWith(query))

  return {
    problemId: PROBLEM_ID,
    seed: input.seed,
    values: trie.nodes.map((n) => (n.ch === '' ? 0 : n.ch.charCodeAt(0))),
    slots: linearSlots(trie.nodes.length),
    tokens: trie.nodes.map((n) => (n.ch === '' ? '·' : n.ch)),
    extras: {
      difficulty: input.difficulty,
      trieNodes: trie.nodes,
      trieLinks: trie.links,
      ends: [...trie.ends],
      words: wordList,
      query,
      completions,
    },
  }
}

function initState(instance: ProblemInstance): GameState {
  const trie = readTrie(instance)
  const objects: Record<string, GameObject> = {}
  trie.nodes.forEach((node, index) => {
    objects[node.id] = {
      id: node.id,
      kind: 'node',
      label: node.ch === '' ? 'root' : node.ch,
      value: node.ch === '' ? 0 : node.ch.charCodeAt(0),
      visual: { kind: 'text', text: node.ch === '' ? '·' : node.ch },
      state: 'idle',
      tags: { index },
    }
  })
  const variables: GameState['variables'] = { matched: 0, found: 0, n: trie.nodes.length }
  for (const id of trie.ends) variables[`end_${id}`] = 1
  return {
    problemId: instance.problemId,
    seed: instance.seed,
    instance,
    objects,
    slots: {},
    containers: {},
    links: trie.links.map((l) => ({ from: l.from, to: l.to, kind: 'next' as const })),
    selection: [],
    cursor: { nodeId: 't0' },
    variables,
    progress: emptyProgress(),
    phase: 'playing',
    trace: [],
    internal: { planIndex: 0 },
  }
}

// ---------------------------------------------------------------------- plan

function actionsFor(instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const trie = readTrie(instance)
  const query = String(instance.extras?.['query'] ?? '')
  let cur = 't0'
  for (const ch of query) {
    const next = childOf(trie, cur, ch)
    if (next === undefined) break
    actions.push({ type: 'traverseNode', fromNodeId: cur, toNodeId: next })
    cur = next
  }
  const completions = completionsUnder(trie, cur)
  for (const id of completions) actions.push({ type: 'selectObject', objectId: id })
  actions.push({ type: 'submitAnswer', targetId: completions[completions.length - 1] ?? cur, value: String(completions.length) })
  return actions
}

// ------------------------------------------------------------------ metadata

function codeLine(action: Action): number {
  if (action.type === 'submitAnswer') return 7
  if (action.type === 'traverseNode') return 4
  if (action.type === 'selectObject') return 7
  return 1
}

const LISTING: readonly string[] = [
  'function prefixSearch(root, query) {', // 1
  '  let node = root', // 2
  '  for (const ch of query) {', // 3
  '    node = node.children[ch]', // 4
  '    if (!node) return []', // 5
  '  }', // 6
  '  return collectWords(node)', // 7
  '}', // 8
]

const PSEUDOCODE: readonly string[] = [
  'FUNCTION prefixSearch(root, query)',
  '    node <- root',
  '    FOR each letter of query',
  '        FOLLOW the link for that letter (missing: no completions)',
  '    END FOR',
  '    RETURN every word-end in the landed subtree',
  'END FUNCTION',
]

function complexity(): Complexity {
  const meta = getProblem(PROBLEM_ID)!
  return { ...meta.complexity }
}

function answerSummary(state: GameState) {
  // Brute force over the word list: completions of the query.
  const words = (state.instance.extras?.['words'] as string[] | undefined) ?? []
  const query = String(state.instance.extras?.['query'] ?? '')
  const count = words.filter((w) => w.startsWith(query)).length
  return { text: `"${query}" matches ${count} word${count === 1 ? '' : 's'}`, value: count }
}

function legalActions(state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'traverseNode') return [{ type: next.type, label: 'Follow the link for the next letter', options: { objectIds: [next.fromNodeId, next.toNodeId] } }]
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Count this word completion', options: { objectIds: [next.objectId] } }]
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Submit the completion count', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function ctx() {
  return {
    codeLineText: (line: number) => LISTING[line - 1] ?? '',
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

function applyAction(state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const step = num(state.internal['planIndex'], 0)
  const expected = actionsFor(state.instance)[step]
  if (state.phase !== 'playing' || !expected || !sameAction(action, expected)) {
    return finishIllegal(state, action, {
      feedback: expected ? `The next algorithm step is ${expected.type}; follow the highlighted node and try that operation.` : 'This game is already complete.',
      dsaOp: dsaOpForAction(action),
      codeLine: expected ? codeLine(expected) : 1,
      note: 'This action is not legal for the current algorithm step.',
      ...ctx(),
    })
  }

  const next = cloneState(state)
  next.internal['planIndex'] = step + 1
  let feedback = 'That is the next step in the algorithm.'
  let note = `${action.type} advances the algorithm.`
  let current: string | undefined
  const dsaOp = dsaOpForAction(action)

  switch (action.type) {
    case 'traverseNode': {
      next.cursor.prevNodeId = action.fromNodeId
      next.cursor.nodeId = action.toNodeId
      next.variables['matched'] = num(next.variables['matched'], 0) + 1
      current = action.toNodeId
      feedback = `Follow the link to ${next.objects[action.toNodeId]?.label ?? action.toNodeId}.`
      note = 'One query letter matched.'
      break
    }
    case 'selectObject': {
      next.selection = [action.objectId]
      if (next.objects[action.objectId]) next.objects[action.objectId]!.state = 'current'
      next.variables['found'] = num(next.variables['found'], 0) + 1
      current = action.objectId
      note = `Count ${next.objects[action.objectId]?.label ?? action.objectId} as a completion.`
      break
    }
    case 'submitAnswer': {
      next.phase = 'won'
      next.variables['answer'] = action.value
      feedback = 'Correct. The prefix search is complete.'
      note = 'Commit the result.'
      break
    }
    default:
      return finishIllegal(state, action, { feedback: 'This problem does not use that operation.', dsaOp: dsaOpForAction(action), codeLine: 1, note: 'Unsupported operation.', ...ctx() })
  }

  next.progress.steps += 1
  const code = codeLine(action)
  const frame: TraceFrame = {
    index: next.trace.length,
    action,
    codeLine: code,
    codeLineText: LISTING[code - 1] ?? '',
    variables: { ...next.variables },
    pointers: { ...(current ? { current } : {}) },
    dsaOp,
    correct: true,
    note,
  }
  next.trace.push(frame)
  return { nextState: next, outcome: { correct: true, feedback, dsaOp, traceStep: frame.index, ...(next.phase === 'won' ? { won: true } : {}) } }
}

function canonicalTrace(state: GameState): TraceFrame[] {
  let current = initState(state.instance)
  const frames: TraceFrame[] = []
  for (const action of actionsFor(state.instance)) {
    const result = applyAction(current, action)
    if (result.outcome.illegal) break
    current = result.nextState
    const frame = current.trace[current.trace.length - 1]
    if (frame) frames.push(frame)
  }
  return frames
}

export function createTriePrefixSearchOracle(): Oracle {
  return {
    problemId: PROBLEM_ID,
    buildInstance,
    initState,
    legalActions,
    applyAction,
    isWin: (state) => state.phase === 'won',
    canonicalTrace,
    pseudocode: () => [...PSEUDOCODE],
    code: (_language: CodeLang) => [...LISTING],
    complexity,
    answerSummary,
  }
}

/** Guard used by the registry test: the id must be in the catalogue. */
if (!PROBLEM_IDS.includes(PROBLEM_ID)) throw new Error(`${PROBLEM_ID} is not in PROBLEM_IDS`)
