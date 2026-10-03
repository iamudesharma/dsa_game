/**
 * Deterministic, seedable games for the remaining catalogue problems.
 *
 * The small shared runner keeps the rules, the board state, the legal action
 * offered to the client, and the reference trace on one path. Each problem
 * still has its own data generator and algorithm-specific action plan.
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
import { buildBoard, finishIllegal, indexOf, num, swapSlots, type CodeLang } from '../shared/kernel.js'

type RemainingId =
  | 'two-sum'
  | 'move-zeroes'
  | 'valid-parentheses'
  | 'stack-push-pop'
  | 'queue-operations'
  | 'linked-list-traversal'
  | 'reverse-linked-list'

const IDS: readonly RemainingId[] = [
  'two-sum', 'move-zeroes', 'valid-parentheses', 'stack-push-pop',
  'queue-operations', 'linked-list-traversal', 'reverse-linked-list',
]

const OPEN: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' }
const CLOSE: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }
const BRACKET_RANK: Readonly<Record<string, number>> = { '(': 0, ')': 0, '[': 1, ']': 1, '{': 2, '}': 2 }

function sized(metaId: RemainingId, input: BuildInstanceInput): number {
  const meta = getProblem(metaId)
  if (!meta) throw new Error(`${metaId} is missing from the catalogue`)
  const { minLength, maxLength } = meta.instanceHints
  const defaultLength = input.difficulty === 'easy'
    ? minLength
    : input.difficulty === 'hard'
      ? maxLength
      : Math.round((minLength + maxLength) / 2)
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

function uniqueValues(n: number, rng: () => number): number[] {
  const values = new Set<number>()
  while (values.size < n) values.add(randInt(rng, 10, 89))
  return [...values]
}

function buildInstance(id: RemainingId, input: BuildInstanceInput): ProblemInstance {
  const n = sized(id, input)
  const rng = makeRng(input.seed)
  const slots = linearSlots(n)

  if (id === 'two-sum') {
    // Exactly one pair can reach target: the two small values are the answer;
    // every other value is greater than the target.
    const a = randInt(rng, 2, 9)
    const b = randInt(rng, 11, 19)
    const target = a + b
    const values = shuffle([a, b, ...Array.from({ length: n - 2 }, (_, i) => target + 4 + i)], rng)
    const first = values.indexOf(a)
    const second = values.indexOf(b)
    return {
      problemId: id,
      seed: input.seed,
      values,
      target,
      slots,
      extras: { difficulty: input.difficulty, answerIndices: [first, second] },
    }
  }

  if (id === 'move-zeroes') {
    const values = uniqueValues(n - 2, rng)
    const withZeroes = shuffle([...values, 0, 0], rng)
    return { problemId: id, seed: input.seed, values: withZeroes, target: 0, slots, extras: { difficulty: input.difficulty } }
  }

  if (id === 'valid-parentheses') {
    const pairs = Math.floor(n / 2)
    const types = Array.from({ length: pairs }, (_, i) => ['(', '[', '{'][i % 3]!)
    const tokens = [...types, ...types.slice().reverse().map((open) => OPEN[open]!)]
    const valid = rng() >= 0.35
    if (!valid && tokens.length > 0) {
      const last = tokens.length - 1
      const wrongType = (BRACKET_RANK[tokens[last]!]! + 1) % 3
      tokens[last] = [')', ']', '}'][wrongType]!
    }
    return {
      problemId: id,
      seed: input.seed,
      values: tokens.map((token) => BRACKET_RANK[token] ?? 0),
      tokens,
      slots: linearSlots(tokens.length),
      extras: { difficulty: input.difficulty, valid },
    }
  }

  if (id === 'stack-push-pop' || id === 'queue-operations') {
    return { problemId: id, seed: input.seed, values: uniqueValues(n, rng), slots, extras: { difficulty: input.difficulty } }
  }

  const values = uniqueValues(n, rng)
  return {
    problemId: id,
    seed: input.seed,
    values,
    list: buildListSpec(n, values),
    slots,
    extras: { difficulty: input.difficulty },
  }
}

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

function nodeState(id: RemainingId, instance: ProblemInstance): GameState {
  const nodes = instance.list ?? []
  const objects: Record<string, GameObject> = {}
  for (const node of nodes) {
    objects[node.id] = {
      id: node.id,
      kind: 'node',
      label: String(node.value),
      value: node.value,
      visual: { kind: 'text', text: String(node.value) },
      state: 'idle',
      tags: { index: Number(node.id.slice(1)) },
    }
  }
  if (id === 'reverse-linked-list') {
    objects.null = { id: 'null', kind: 'node', label: 'NULL', visual: { kind: 'text', text: '∅' }, state: 'idle' }
  }
  const links = nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1]!.id, kind: 'next' as const }))
  return {
    problemId: id,
    seed: instance.seed,
    instance,
    objects,
    // Linked objects are displayed in the node lane, while `instance.slots`
    // retains the common wire shape and item count used by catalogue clients.
    slots: {},
    containers: {},
    links,
    selection: [],
    cursor: { nodeId: nodes[0]?.id },
    variables: { i: 0, count: nodes.length ? 1 : 0, n: nodes.length },
    progress: emptyProgress(),
    phase: 'playing',
    trace: [],
    internal: { planIndex: 0 },
  }
}

function initState(id: RemainingId, instance: ProblemInstance): GameState {
  if (id === 'linked-list-traversal' || id === 'reverse-linked-list') return nodeState(id, instance)
  const extraObjects: GameObject[] = []
  const containers: GameState['containers'] = {}
  let kind: 'number' | 'token' = 'number'
  let variables: GameState['variables'] = { i: 0, n: instance.values.length }

  if (id === 'two-sum') {
    extraObjects.push({ id: 'target', kind: 'target', label: `target ${instance.target}`, value: instance.target, state: 'idle' })
      variables = {
        i: 0,
        need: null,
        target: instance.target ?? 0,
        ...Object.fromEntries(instance.values.map((_, index) => [`seen_${index}`, null])),
      }
  } else if (id === 'move-zeroes') {
    extraObjects.push({ id: 'zero-guide', kind: 'target', label: 'zero', value: 0, state: 'locked' })
    variables = { read: 0, write: 0, n: instance.values.length }
  } else if (id === 'valid-parentheses') {
    kind = 'token'
    containers['stack'] = { id: 'stack', kind: 'stack', label: 'matching openers', order: [], capacity: instance.values.length }
    variables = { i: 0, depth: 0, pairs: 0 }
  } else {
    const queue = id === 'queue-operations'
    containers['main'] = {
      id: 'main',
      kind: queue ? 'queue' : 'stack',
      label: queue ? 'queue' : 'stack',
      order: [],
      capacity: instance.values.length,
    }
    variables = { i: 0, size: 0, n: instance.values.length }
  }

  const state = buildBoard({ problemId: id, instance, kind, extras: extraObjects, containers, variables })
  state.internal = { planIndex: 0 }
  return state
}

function relation(a: number, b: number): Relation {
  return a < b ? 'lt' : a > b ? 'gt' : 'eq'
}

function actionsFor(id: RemainingId, instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  if (id === 'two-sum') {
    const seen = new Map<number, number>()
    let seenCount = 0
    for (let i = 0; i < instance.values.length; i++) {
      const value = instance.values[i]!
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'assignValue', targetId: 'need', value: String((instance.target ?? 0) - value) })
      const other = seen.get((instance.target ?? 0) - value)
      if (other !== undefined) {
        actions.push({ type: 'submitAnswer', targetId: `v${i}`, value: [other, i].sort((x, y) => x - y).join(',') })
        return actions
      }
      actions.push({ type: 'assignValue', targetId: `seen_${seenCount}`, value: String(value) })
      seen.set(value, i)
      seenCount++
    }
    return actions
  }

  if (id === 'move-zeroes') {
    const cells = instance.values.map((value, index) => ({ id: `v${index}`, value }))
    let write = 0
    for (let read = 0; read < cells.length; read++) {
      const current = cells[read]!
      actions.push({ type: 'selectObject', objectId: current.id })
      actions.push({ type: 'comparePair', aId: current.id, bId: 'zero-guide', relation: relation(current.value, 0) })
      if (current.value !== 0) {
        if (read !== write) {
          const destination = cells[write]!
          actions.push({ type: 'swapPair', aId: current.id, bId: destination.id })
          cells[read] = destination
          cells[write] = current
        }
        write++
      }
    }
    actions.push({ type: 'submitAnswer', targetId: cells[0]?.id ?? 'answer', value: 'done' })
    return actions
  }

  if (id === 'stack-push-pop' || id === 'queue-operations') {
    const containerId = 'main'
    for (let i = 0; i < instance.values.length; i++) {
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'pushPop', containerId, op: 'push', objectId: `v${i}` })
    }
    const popped = id === 'stack-push-pop' ? instance.values.map((_, i) => instance.values.length - 1 - i) : instance.values.map((_, i) => i)
    for (const index of popped) actions.push({ type: 'pushPop', containerId, op: 'pop' })
    const answer = popped.map((index) => instance.values[index]).join(',')
    actions.push({ type: 'submitAnswer', targetId: 'v0', value: answer })
    return actions
  }

  if (id === 'valid-parentheses') {
    const tokens = instance.tokens ?? []
    const stack: number[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      if (OPEN[token]) {
        actions.push({ type: 'selectObject', objectId: `v${i}` })
        actions.push({ type: 'pushPop', containerId: 'stack', op: 'push', objectId: `v${i}` })
        stack.push(i)
        continue
      }
      const openerIndex = stack[stack.length - 1]
      const opener = openerIndex === undefined ? '' : tokens[openerIndex]!
      const samePair = CLOSE[token] === opener
      const leftRank = BRACKET_RANK[opener] ?? -1
      const rightRank = BRACKET_RANK[token] ?? -1
      actions.push({
        type: 'comparePair',
        aId: openerIndex === undefined ? 'v0' : `v${openerIndex}`,
        bId: `v${i}`,
        relation: samePair ? 'eq' : relation(leftRank, rightRank),
      })
      if (!samePair) {
        actions.push({ type: 'submitAnswer', targetId: `v${i}`, value: 'invalid' })
        return actions
      }
      actions.push({ type: 'pushPop', containerId: 'stack', op: 'pop' })
      stack.pop()
    }
    actions.push({ type: 'submitAnswer', targetId: 'v0', value: stack.length === 0 ? 'valid' : 'invalid' })
    return actions
  }

  if (id === 'linked-list-traversal') {
    const nodes = instance.list ?? []
    for (let i = 0; i + 1 < nodes.length; i++) {
      actions.push({ type: 'traverseNode', fromNodeId: nodes[i]!.id, toNodeId: nodes[i + 1]!.id })
    }
    actions.push({ type: 'submitAnswer', targetId: nodes[0]?.id ?? 'answer', value: `length ${nodes.length}` })
    return actions
  }

  const nodes = instance.list ?? []
  for (let i = 0; i < nodes.length; i++) {
    actions.push({
      type: 'connectNodes',
      fromNodeId: nodes[i]!.id,
      toNodeId: i === 0 ? 'null' : nodes[i - 1]!.id,
      linkKind: 'next',
    })
  }
  actions.push({ type: 'submitAnswer', targetId: nodes[nodes.length - 1]?.id ?? 'answer', value: String(nodes[nodes.length - 1]?.value ?? '') })
  return actions
}

function codeLine(id: RemainingId, action: Action): number {
  if (id === 'two-sum') {
    if (action.type === 'selectObject') return 3
    if (action.type === 'assignValue') return action.targetId === 'need' ? 4 : 6
    return 5
  }
  if (id === 'move-zeroes') {
    if (action.type === 'selectObject') return 3
    if (action.type === 'comparePair') return 4
    if (action.type === 'swapPair') return 5
    return 9
  }
  if (id === 'valid-parentheses') {
    if (action.type === 'selectObject') return 4
    if (action.type === 'comparePair') return 5
    if (action.type === 'pushPop') return action.op === 'push' ? 4 : 5
    return 7
  }
  if (id === 'stack-push-pop' || id === 'queue-operations') {
    if (action.type === 'selectObject') return 3
    if (action.type === 'pushPop') return action.op === 'push' ? 3 : 5
    return 6
  }
  if (id === 'linked-list-traversal') return action.type === 'traverseNode' ? 6 : 8
  return action.type === 'connectNodes' ? 6 : 10
}

function linkedListSource(id: 'linked-list-traversal' | 'reverse-linked-list', language: CodeLang): string[] {
  if (id === 'linked-list-traversal') {
    const byLanguage: Record<CodeLang, string[]> = {
      javascript: ['function length(head) {', '  let count = 0', '  let current = head', '  while (current !== null) {', '    count++', '    current = current.next', '  }', '  return count', '}'],
      typescript: ['function length<T>(head: Node<T> | null): number {', '  let count = 0', '  let current = head', '  while (current !== null) {', '    count++', '    current = current.next', '  }', '  return count', '}'],
      python: ['def length(head):', '    count = 0', '    current = head', '    while current is not None:', '        count += 1', '        current = current.next', '        # continue until the cursor reaches None', '    return count', '# the function returns one count'],
      java: ['int length(Node head) {', '  int count = 0;', '  Node current = head;', '  while (current != null) {', '    count++;', '    current = current.next;', '  }', '  return count;', '}'],
      cpp: ['int length(Node* head) {', '  int count = 0;', '  Node* current = head;', '  while (current != nullptr) {', '    ++count;', '    current = current->next;', '  }', '  return count;', '}'],
    }
    return byLanguage[language]
  }

  const byLanguage: Record<CodeLang, string[]> = {
    javascript: ['function reverseList(head) {', '  let previous = null', '  let current = head', '  while (current !== null) {', '    const next = current.next', '    current.next = previous', '    previous = current', '    current = next', '  }', '  return previous', '}'],
    typescript: ['function reverseList<T>(head: Node<T> | null): Node<T> | null {', '  let previous: Node<T> | null = null', '  let current = head', '  while (current !== null) {', '    const next = current.next', '    current.next = previous', '    previous = current', '    current = next', '  }', '  return previous', '}'],
    python: ['def reverse_list(head):', '    previous = None', '    current = head', '    while current is not None:', '        next_node = current.next', '        current.next = previous', '        previous = current', '        current = next_node', '        # keep walking through the unvisited suffix', '    return previous', '# previous is the new head'],
    java: ['Node reverseList(Node head) {', '  Node previous = null;', '  Node current = head;', '  while (current != null) {', '    Node next = current.next;', '    current.next = previous;', '    previous = current;', '    current = next;', '  }', '  return previous;', '}'],
    cpp: ['Node* reverseList(Node* head) {', '  Node* previous = nullptr;', '  Node* current = head;', '  while (current != nullptr) {', '    Node* next = current->next;', '    current->next = previous;', '    previous = current;', '    current = next;', '  }', '  return previous;', '}'],
  }
  return byLanguage[language]
}

function source(id: RemainingId, language: CodeLang = 'javascript'): string[] {
  if (id === 'linked-list-traversal' || id === 'reverse-linked-list') {
    return linkedListSource(id, language)
  }
  switch (id) {
    case 'two-sum': return ['function twoSum(a, target) {', '  const seen = new Map()', '  for (let i = 0; i < a.length; i++) {', '    const need = target - a[i]', '    if (seen.has(need)) return [seen.get(need), i]', '    seen.set(a[i], i)', '  }', '}']
    case 'move-zeroes': return ['function moveZeroes(a) {', '  let write = 0', '  for (let read = 0; read < a.length; read++) {', '    if (a[read] !== 0) {', '      ;[a[write], a[read]] = [a[read], a[write]]', '      write++', '    }', '  }', '  return a', '}']
    case 'valid-parentheses': return ['function isValid(tokens) {', '  const stack = []', '  for (const token of tokens) {', '    if (isOpening(token)) stack.push(token)', '    else if (!matches(stack.pop(), token)) return false', '  }', '  return stack.length === 0', '}']
    case 'stack-push-pop': return ['function reverseWithStack(values) {', '  const stack = []', '  for (const value of values) stack.push(value)', '  const output = []', '  while (stack.length) output.push(stack.pop())', '  return output', '}']
    case 'queue-operations': return ['function drainQueue(values) {', '  const queue = []', '  for (const value of values) queue.push(value)', '  const output = []', '  while (queue.length) output.push(queue.shift())', '  return output', '}']
  }
}

function pseudocode(id: RemainingId): string[] {
  switch (id) {
    case 'two-sum': return ['FUNCTION twoSum(a, target)', '    seen <- empty map', '    FOR each value at index i', '        need <- target - value', '        IF seen contains need: RETURN its index and i', '        store value with index i', '    END FOR', 'END FUNCTION']
    case 'move-zeroes': return ['FUNCTION moveZeroes(a)', '    write <- 0', '    FOR read FROM 0 TO LENGTH(a) - 1', '        IF a[read] is nonzero', '            swap a[write] and a[read]', '            write <- write + 1', '        END IF', '    END FOR', 'END FUNCTION']
    case 'valid-parentheses': return ['FUNCTION isValid(tokens)', '    stack <- empty', '    FOR each token', '        IF token opens: PUSH it', '        ELSE compare it with the top and POP the match', '        IF the pair does not match: RETURN false', '    END FOR', '    RETURN stack is empty']
    case 'stack-push-pop': return ['FUNCTION reverseWithStack(values)', '    stack <- empty', '    PUSH each value in order', '    output <- empty', '    POP each value into output', '    RETURN output']
    case 'queue-operations': return ['FUNCTION drainQueue(values)', '    queue <- empty', '    ENQUEUE each value in order', '    output <- empty', '    DEQUEUE each value into output', '    RETURN output']
    case 'linked-list-traversal': return ['FUNCTION length(head)', '    count <- 0', '    current <- head', '    WHILE current is not null', '        count <- count + 1', '        current <- current.next', '    END WHILE', '    RETURN count']
    case 'reverse-linked-list': return ['FUNCTION reverseList(head)', '    previous <- null', '    current <- head', '    WHILE current is not null', '        next <- current.next', '        current.next <- previous', '        previous <- current', '        current <- next', '    END WHILE', '    RETURN previous']
  }
}

function complexity(id: RemainingId): Complexity {
  const meta = getProblem(id)!
  return { ...meta.complexity }
}

function answerText(id: RemainingId, instance: ProblemInstance): { text: string; value: string | number } {
  if (id === 'two-sum') {
    const [a, b] = (instance.extras?.['answerIndices'] as number[] | undefined) ?? [0, 1]
    return { text: `indices ${a} and ${b}`, value: `${a},${b}` }
  }
  if (id === 'move-zeroes') return { text: 'all zeroes are at the end', value: 'done' }
  if (id === 'valid-parentheses') {
    const valid = instance.extras?.['valid'] === true
    return { text: valid ? 'the brackets are balanced' : 'the brackets are not balanced', value: valid ? 'valid' : 'invalid' }
  }
  if (id === 'stack-push-pop') return { text: `pop order: ${instance.values.slice().reverse().join(', ')}`, value: instance.values.slice().reverse().join(',') }
  if (id === 'queue-operations') return { text: `dequeue order: ${instance.values.join(', ')}`, value: instance.values.join(',') }
  if (id === 'linked-list-traversal') return { text: `length ${instance.values.length}`, value: instance.values.length }
  return { text: `new head value ${instance.values[instance.values.length - 1]}`, value: instance.values[instance.values.length - 1] ?? 0 }
}

function legalActions(id: RemainingId, state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(id, state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Read the next item', options: { objectIds: [next.objectId] } }]
  if (next.type === 'comparePair') return [{ type: next.type, label: 'Compare these two items', options: { objectIds: [next.aId, next.bId] }, expects: 'relation' }]
  if (next.type === 'pushPop') return [{ type: next.type, label: next.op === 'push' ? 'Push / enqueue the selected item' : 'Pop / dequeue the next item', options: { objectIds: next.objectId ? [next.objectId] : [], containerIds: [next.containerId] } }]
  if (next.type === 'assignValue') return [{ type: next.type, label: 'Record the value', expects: 'value', options: { objectIds: [], targetIds: [next.targetId] } }]
  if (next.type === 'traverseNode') return [{ type: next.type, label: 'Follow the next link', options: { objectIds: [next.fromNodeId, next.toNodeId] } }]
  if (next.type === 'connectNodes') return [{ type: next.type, label: 'Connect the next pointer', options: { objectIds: [next.fromNodeId, next.toNodeId] } }]
  if (next.type === 'swapPair') return [{ type: next.type, label: 'Swap the nonzero item into the write position', options: { objectIds: [next.aId, next.bId] } }]
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Submit the result', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function context(id: RemainingId) {
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

function applyAction(id: RemainingId, state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
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
  const i = step + 1
  next.internal['planIndex'] = i
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
        next.variables['read'] = position
        if (next.slots[`s${position}`]) next.cursor.iSlotId = `s${position}`
      }
      current = action.objectId
      note = `Read ${next.objects[action.objectId]?.label ?? action.objectId}.`
      break
    }
    case 'assignValue': {
      const numeric = Number(action.value)
      next.variables[action.targetId] = Number.isFinite(numeric) ? numeric : action.value
      feedback = `${action.targetId} now records ${action.value}.`
      note = `Store ${action.value} in ${action.targetId}.`
      break
    }
    case 'comparePair': {
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
      if (id === 'move-zeroes') {
        const read = indexOf(next, action.aId)
        next.variables['read'] = read
        if (action.relation !== 'eq') next.variables['write'] = num(next.variables['write'], 0) + 1
      }
      if (id === 'valid-parentheses' && action.relation === 'eq') {
        next.variables['pairs'] = num(next.variables['pairs'], 0) + 1
      }
      if (id === 'valid-parentheses') {
        const position = indexOf(next, action.bId)
        next.variables['i'] = position
        next.cursor.iSlotId = `s${position}`
      }
      note = action.relation === 'eq' ? 'The values match.' : `The relation is ${action.relation}.`
      break
    }
    case 'swapPair': {
      const a = indexOf(next, action.aId)
      const b = indexOf(next, action.bId)
      swapSlots(next, a, b)
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
      feedback = 'The nonzero value is now in the next write position.'
      note = 'Swap the read value into the next available position.'
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
        feedback = `${object?.label ?? 'That item'} goes onto the ${container.kind === 'queue' ? 'rear of the queue' : 'top of the stack'}.`
        note = `Push ${object?.label ?? action.objectId}.`
      } else {
        const removed = container.kind === 'queue' ? container.order.shift() : container.order.pop()
        if (removed && next.objects[removed]) next.objects[removed]!.state = 'visited'
        feedback = `${removed ? next.objects[removed]?.label : 'The item'} leaves from the ${container.kind === 'queue' ? 'front of the queue' : 'top of the stack'}.`
        note = `Remove ${removed ?? 'the next item'} from the ${container.kind}.`
      }
      next.variables['size'] = container.order.length
      next.variables['depth'] = container.order.length
      break
    }
    case 'traverseNode': {
      next.cursor.prevNodeId = action.fromNodeId
      next.cursor.nodeId = action.toNodeId
      next.variables['count'] = num(next.variables['count'], 0) + 1
      next.variables['i'] = num(next.variables['i'], 0) + 1
      current = action.toNodeId
      feedback = `Follow one link; the pointer now reaches ${next.objects[action.toNodeId]?.label ?? action.toNodeId}.`
      note = 'Advance current to current.next.'
      break
    }
    case 'connectNodes': {
      next.links = next.links.filter((link) => !(link.from === action.fromNodeId && link.kind === action.linkKind))
      if (action.toNodeId !== 'null') next.links.push({ from: action.fromNodeId, to: action.toNodeId, kind: action.linkKind })
      next.variables['i'] = num(next.variables['i'], 0) + 1
      next.selection = [action.fromNodeId, action.toNodeId]
      compare = [action.fromNodeId, action.toNodeId]
      feedback = `${next.objects[action.fromNodeId]?.label} now points to ${action.toNodeId === 'null' ? 'NULL' : next.objects[action.toNodeId]?.label}.`
      note = 'Reverse one next pointer toward the previous node.'
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
    case 'moveObject':
      return finishIllegal(state, action, { feedback: 'This problem does not move objects between slots.', dsaOp: 'move', codeLine: 1, note: 'Unsupported operation.', ...ctx })
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

function canonicalTrace(id: RemainingId, state: GameState): TraceFrame[] {
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

export function createRemainingOracle(id: RemainingId): Oracle {
  if (!IDS.includes(id)) throw new Error(`No remaining oracle for ${id}`)
  return {
    problemId: id,
    buildInstance: (input) => buildInstance(id, input),
    initState: (instance) => initState(id, instance),
    legalActions: (state) => legalActions(id, state),
    applyAction: (state, action) => applyAction(id, state, action),
    isWin: (state) => state.phase === 'won',
    canonicalTrace: (state) => canonicalTrace(id, state),
    pseudocode: () => pseudocode(id),
    code: (language: CodeLang) => source(id, language),
    complexity: () => complexity(id),
    answerSummary: (state) => {
      const answer = answerText(id, state.instance)
      return { text: answer.text, value: answer.value }
    },
  }
}

export const createTwoSumOracle = (): Oracle => createRemainingOracle('two-sum')
export const createMoveZeroesOracle = (): Oracle => createRemainingOracle('move-zeroes')
export const createValidParenthesesOracle = (): Oracle => createRemainingOracle('valid-parentheses')
export const createStackPushPopOracle = (): Oracle => createRemainingOracle('stack-push-pop')
export const createQueueOperationsOracle = (): Oracle => createRemainingOracle('queue-operations')
export const createLinkedListTraversalOracle = (): Oracle => createRemainingOracle('linked-list-traversal')
export const createReverseLinkedListOracle = (): Oracle => createRemainingOracle('reverse-linked-list')
