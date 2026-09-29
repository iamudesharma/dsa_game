/**
 * Binary trees, played on level-order (heap-indexed) arrays.
 *
 * A complete binary tree in level order IS an array: the children of index i
 * are 2i+1 and 2i+2. Both clients already render linear boards with pointer
 * chips, so trees need no new renderer on either platform — the same lane
 * that shows `lo`/`mid`/`hi` shows the current node, and the heap-index
 * arithmetic is the lesson, not a limitation. (A 2D tree lane with SVG edges
 * would be prettier and is explicitly deferred: it needs a new renderer on
 * web AND Flutter to keep parity, for games that are already playable.)
 *
 * Four problems:
 *
 *   tree-traversals  visit every node in preorder/inorder/postorder. The order
 *                    is chosen by seed (like array-max-min's max/min mode), so
 *                    one oracle teaches all three walks. Single-mechanic play
 *                    (select + submit) — the linked-list-traversal precedent.
 *   bst-validate     a BST's inorder walk is sorted: visit inorder, compare
 *                    each value with its predecessor, stop at the first descent.
 *                    Invalid instances are built by swapping two values of a
 *                    valid BST, which always breaks inorder sortedness.
 *   tree-level-order BFS with a real FIFO queue container: dequeue, visit,
 *                    enqueue children. The queue panel IS the algorithm state.
 *   bst-search       the binary-search shape on a tree: select, compare
 *                    against the target, choosePath left/right, submit.
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
  cloneState,
  dsaOpForAction,
  getProblem,
  linearSlots,
  makeRng,
  randInt,
  PROBLEM_IDS,
} from '@dsa/game-schema'
import { buildBoard, finishIllegal, indexOf, num, type CodeLang } from '../shared/kernel.js'

type TreeId = 'tree-traversals' | 'bst-validate' | 'tree-level-order' | 'bst-search'

const IDS: readonly TreeId[] = ['tree-traversals', 'bst-validate', 'tree-level-order', 'bst-search']

type TraversalOrder = 'preorder' | 'inorder' | 'postorder'
const ORDERS: readonly TraversalOrder[] = ['preorder', 'inorder', 'postorder']

function sized(metaId: TreeId, input: BuildInstanceInput): number {
  const meta = getProblem(metaId)
  if (!meta) throw new Error(`${metaId} is missing from the catalogue`)
  const { minLength, maxLength } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  return Math.max(minLength, Math.min(maxLength, Math.trunc(input.length ?? defaultLength)))
}

function uniqueValues(n: number, rng: () => number): number[] {
  const values = new Set<number>()
  while (values.size < n) values.add(randInt(rng, 10, 89))
  return [...values]
}

function relation(a: number, b: number): Relation {
  return a < b ? 'lt' : a > b ? 'gt' : 'eq'
}

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

// ------------------------------------------------------------ tree structure

function childrenOf(i: number, n: number): number[] {
  const out: number[] = []
  const left = 2 * i + 1
  const right = 2 * i + 2
  if (left < n) out.push(left)
  if (right < n) out.push(right)
  return out
}

function preorderOf(n: number): number[] {
  const out: number[] = []
  const walk = (i: number): void => {
    if (i >= n) return
    out.push(i)
    walk(2 * i + 1)
    walk(2 * i + 2)
  }
  walk(0)
  return out
}

function inorderOf(n: number): number[] {
  const out: number[] = []
  const walk = (i: number): void => {
    if (i >= n) return
    walk(2 * i + 1)
    out.push(i)
    walk(2 * i + 2)
  }
  walk(0)
  return out
}

function postorderOf(n: number): number[] {
  const out: number[] = []
  const walk = (i: number): void => {
    if (i >= n) return
    walk(2 * i + 1)
    walk(2 * i + 2)
    out.push(i)
  }
  walk(0)
  return out
}

function orderOf(order: TraversalOrder, n: number): number[] {
  if (order === 'preorder') return preorderOf(n)
  if (order === 'postorder') return postorderOf(n)
  return inorderOf(n)
}

/** Level-order values that form a valid BST: sorted values dealt into inorder positions. */
function validBstValues(n: number, rng: () => number): number[] {
  const sorted = uniqueValues(n, rng).sort((a, b) => a - b)
  const seq = inorderOf(n)
  const values = new Array<number>(n)
  for (let rank = 0; rank < n; rank++) values[seq[rank]!] = sorted[rank]!
  return values
}

// ------------------------------------------------------------------ instances

function buildInstance(id: TreeId, input: BuildInstanceInput): ProblemInstance {
  const n = Math.max(3, sized(id, input))
  const rng = makeRng(input.seed)
  const slotsFor = (values: number[]) => linearSlots(values.length)

  if (id === 'tree-traversals') {
    const values = uniqueValues(n, rng)
    const order = ORDERS[Math.floor(rng() * ORDERS.length)]!
    return { problemId: id, seed: input.seed, values, slots: slotsFor(values), extras: { difficulty: input.difficulty, order } }
  }

  if (id === 'bst-validate') {
    const values = validBstValues(n, rng)
    const valid = rng() >= 0.35
    if (!valid) {
      // Swapping two values of a strictly inorder-sorted tree always breaks
      // sortedness (distinct values), so the invalid branch is guaranteed.
      const a = randInt(rng, 0, n - 1)
      let b = randInt(rng, 0, n - 1)
      while (b === a) b = randInt(rng, 0, n - 1)
      const tmp = values[a]!
      values[a] = values[b]!
      values[b] = tmp
    }
    return { problemId: id, seed: input.seed, values, slots: slotsFor(values), extras: { difficulty: input.difficulty, valid } }
  }

  if (id === 'tree-level-order') {
    const values = uniqueValues(n, rng)
    return { problemId: id, seed: input.seed, values, slots: slotsFor(values), extras: { difficulty: input.difficulty } }
  }

  // bst-search: always a valid BST with a member target.
  const values = validBstValues(n, rng)
  const answerIndex = randInt(rng, 0, n - 1)
  return {
    problemId: id, seed: input.seed, values, target: values[answerIndex], slots: slotsFor(values),
    extras: { difficulty: input.difficulty, answerIndex },
  }
}

// --------------------------------------------------------------------- states

function initState(id: TreeId, instance: ProblemInstance): GameState {
  const extraObjects: GameObject[] = []
  const containers: GameState['containers'] = {}
  let variables: GameState['variables'] = { i: 0, n: instance.values.length }

  if (id === 'bst-search') {
    extraObjects.push({ id: 'target', kind: 'target', label: `target ${instance.target}`, value: instance.target, state: 'idle' })
    variables = { i: 0, target: instance.target ?? 0, n: instance.values.length }
  } else if (id === 'tree-level-order') {
    containers['queue'] = { id: 'queue', kind: 'queue', label: 'bfs queue', order: [], capacity: instance.values.length }
    variables = { i: 0, size: 0, n: instance.values.length }
  } else if (id === 'tree-traversals') {
    variables = { i: 0, visited: 0, n: instance.values.length }
  }

  const state = buildBoard({ problemId: id, instance, extras: extraObjects, containers, variables })
  state.internal = { planIndex: 0 }
  return state
}

// ---------------------------------------------------------------------- plans

function actionsFor(id: TreeId, instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const v = instance.values
  const n = v.length

  if (id === 'tree-traversals') {
    const order = (instance.extras?.['order'] as TraversalOrder | undefined) ?? 'inorder'
    const seq = orderOf(order, n)
    for (const idx of seq) actions.push({ type: 'selectObject', objectId: `v${idx}` })
    actions.push({ type: 'submitAnswer', targetId: `v${seq[seq.length - 1] ?? 0}`, value: seq.map((i) => v[i]).join(',') })
    return actions
  }

  if (id === 'bst-validate') {
    const seq = inorderOf(n)
    for (let t = 0; t < seq.length; t++) {
      actions.push({ type: 'selectObject', objectId: `v${seq[t]!}` })
      if (t === 0) continue
      const rel = relation(v[seq[t - 1]!]!, v[seq[t]!]!)
      actions.push({ type: 'comparePair', aId: `v${seq[t - 1]!}`, bId: `v${seq[t]!}`, relation: rel })
      if (rel !== 'lt') {
        actions.push({ type: 'submitAnswer', targetId: `v${seq[t]!}`, value: 'invalid' })
        return actions
      }
    }
    actions.push({ type: 'submitAnswer', targetId: `v${seq[seq.length - 1] ?? 0}`, value: 'valid' })
    return actions
  }

  if (id === 'tree-level-order') {
    const queue: number[] = [0]
    const visited: number[] = []
    actions.push({ type: 'pushPop', containerId: 'queue', op: 'push', objectId: 'v0' })
    while (queue.length > 0) {
      const i = queue.shift()!
      actions.push({ type: 'pushPop', containerId: 'queue', op: 'pop' })
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      visited.push(i)
      for (const c of childrenOf(i, n)) {
        actions.push({ type: 'pushPop', containerId: 'queue', op: 'push', objectId: `v${c}` })
        queue.push(c)
      }
    }
    actions.push({ type: 'submitAnswer', targetId: `v${visited[visited.length - 1] ?? 0}`, value: visited.map((i) => v[i]).join(',') })
    return actions
  }

  // bst-search
  const target = instance.target ?? 0
  let i = 0
  for (let guard = 0; guard < 2 * n + 4 && i < n; guard++) {
    actions.push({ type: 'selectObject', objectId: `v${i}` })
    const rel = relation(v[i]!, target)
    actions.push({ type: 'comparePair', aId: `v${i}`, bId: 'target', relation: rel })
    if (rel === 'eq') {
      actions.push({ type: 'submitAnswer', targetId: `v${i}`, value: String(i) })
      return actions
    }
    // BST invariant: the node holds larger values than its whole left subtree,
    // so a node above the target means the answer is down the left child.
    const goLeft = rel === 'gt'
    actions.push({ type: 'choosePath', fromId: `v${i}`, pathId: goLeft ? 'left' : 'right' })
    i = goLeft ? 2 * i + 1 : 2 * i + 2
  }
  const answerIndex = num(instance.extras?.['answerIndex'], 0)
  actions.push({ type: 'submitAnswer', targetId: `v${answerIndex}`, value: String(answerIndex) })
  return actions
}

// ------------------------------------------------------------------ metadata

function codeLine(id: TreeId, action: Action, instance?: ProblemInstance): number {
  if (action.type === 'submitAnswer') {
    if (id === 'bst-validate') return action.value === 'valid' ? 7 : 5
    return 8
  }
  if (action.type === 'selectObject') {
    if (id === 'tree-traversals') {
      const order = (instance?.extras?.['order'] as TraversalOrder | undefined) ?? 'inorder'
      return order === 'preorder' ? 3 : order === 'postorder' ? 7 : 5
    }
    return 3
  }
  if (action.type === 'comparePair') return id === 'bst-search' ? 4 : 5
  if (action.type === 'pushPop') return action.op === 'push' ? 7 : 5
  if (action.type === 'choosePath') return 5
  return 1
}

function source(id: TreeId): string[] {
  switch (id) {
    case 'tree-traversals': return ['function traverse(node, order) {', '  if (node === null) return', '  if (order === "pre") visit(node)', '  traverse(node.left, order)', '  if (order === "in") visit(node)', '  traverse(node.right, order)', '  if (order === "post") visit(node)', '}']
    case 'bst-validate': return ['function isBST(root) {', '  const seq = []', '  inorder(root, seq)', '  for (let i = 1; i < seq.length; i++) {', '    if (seq[i] < seq[i - 1]) return false', '  }', '  return true', '}']
    case 'tree-level-order': return ['function levelOrder(root) {', '  const out = []', '  const queue = [root]', '  while (queue.length) {', '    const node = queue.shift()', '    out.push(node.value)', '    if (node.left) queue.push(node.left)', '    if (node.right) queue.push(node.right)', '  }', '  return out', '}']
    case 'bst-search': return ['function bstSearch(root, target) {', '  let node = root', '  while (node !== null) {', '    if (node.value === target) return node', '    if (target < node.value) node = node.left', '    else node = node.right', '  }', '  return null', '}']
  }
}

function pseudocode(id: TreeId): string[] {
  switch (id) {
    case 'tree-traversals': return ['FUNCTION traverse(node, order)', '    IF node is null: RETURN', '    IF order is pre: VISIT node', '    traverse(node.left)', '    IF order is in: VISIT node', '    traverse(node.right)', '    IF order is post: VISIT node', 'END FUNCTION']
    case 'bst-validate': return ['FUNCTION isBST(root)', '    seq <- inorder walk of the tree', '    FOR i FROM 1 TO LENGTH(seq) - 1', '        IF seq[i] < seq[i-1]: RETURN false', '    END FOR', '    RETURN true', 'END FUNCTION']
    case 'tree-level-order': return ['FUNCTION levelOrder(root)', '    queue <- [root]', '    WHILE queue is nonempty', '        node <- DEQUEUE the front', '        VISIT node', '        ENQUEUE its left child, then its right child', '    END WHILE', 'END FUNCTION']
    case 'bst-search': return ['FUNCTION bstSearch(root, target)', '    node <- root', '    WHILE node is not null', '        IF node.value = target: RETURN node', '        IF target < node.value: node <- left child', '        ELSE node <- right child', '    END WHILE', 'END FUNCTION']
  }
}

function complexity(id: TreeId): Complexity {
  const meta = getProblem(id)!
  return { ...meta.complexity }
}

function inorderSorted(values: number[]): boolean {
  const seq = inorderOf(values.length)
  for (let t = 1; t < seq.length; t++) {
    if (values[seq[t]!]! < values[seq[t - 1]!]!) return false
  }
  return true
}

function answerText(id: TreeId, instance: ProblemInstance): { text: string; value: string | number } {
  const v = instance.values
  if (id === 'tree-traversals') {
    const order = (instance.extras?.['order'] as TraversalOrder | undefined) ?? 'inorder'
    const seq = orderOf(order, v.length).map((i) => v[i])
    return { text: `${order} order: ${seq.join(',')}`, value: seq.join(',') }
  }
  if (id === 'bst-validate') {
    // Brute-forced from the values, not read from extras, so the summary can
    // never disagree with the plan's own submit.
    return inorderSorted(v)
      ? { text: 'the tree is a valid BST', value: 'valid' }
      : { text: 'the tree is not a BST', value: 'invalid' }
  }
  if (id === 'tree-level-order') {
    return { text: `level order: ${v.join(',')}`, value: v.join(',') }
  }
  const answerIndex = num(instance.extras?.['answerIndex'], 0)
  return { text: `target ${instance.target} at index ${answerIndex}`, value: answerIndex }
}

// ------------------------------------------------------------------ gameplay

function legalActions(id: TreeId, state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(id, state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Visit the next node in the walk', options: { objectIds: [next.objectId] } }]
  if (next.type === 'comparePair') {
    const label =
      id === 'bst-validate'
        ? 'Is this inorder value still larger than the previous one?'
        : 'Is the target below, equal to, or above this node?'
    return [{ type: next.type, label, options: { objectIds: [next.aId, next.bId] }, expects: 'relation' }]
  }
  if (next.type === 'pushPop')
    return [{ type: next.type, label: next.op === 'push' ? 'Enqueue the child' : 'Dequeue the front of the queue', options: { objectIds: next.objectId ? [next.objectId] : [], containerIds: [next.containerId] } }]
  if (next.type === 'choosePath') return [{ type: next.type, label: 'Descend to the child that can still hold the target', options: { objectIds: [next.fromId] } }]
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Submit the result', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function context(id: TreeId) {
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

function applyAction(id: TreeId, state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const step = num(state.internal['planIndex'], 0)
  const expected = actionsFor(id, state.instance)[step]
  const ctx = context(id)
  if (state.phase !== 'playing' || !expected || !sameAction(action, expected)) {
    return finishIllegal(state, action, {
      feedback: expected ? `The next algorithm step is ${expected.type}; follow the highlighted item and try that operation.` : 'This game is already complete.',
      dsaOp: action.type === 'pushPop' && action.op === 'pop' ? 'pop' : dsaOpForAction(action),
      codeLine: expected ? codeLine(id, expected, state.instance) : 1,
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
      if (id === 'tree-traversals') next.variables['visited'] = num(next.variables['visited'], 0) + 1
      current = action.objectId
      note = `Visit ${next.objects[action.objectId]?.label ?? action.objectId}.`
      break
    }
    case 'comparePair': {
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
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
        feedback = `${object?.label ?? 'That node'} joins the back of the queue.`
        note = `Enqueue ${object?.label ?? action.objectId}.`
      } else {
        const removed = container.order.shift()
        if (removed && next.objects[removed]) next.objects[removed]!.state = 'visited'
        feedback = `${removed ? next.objects[removed]?.label : 'The node'} leaves from the front of the queue.`
        note = `Dequeue ${removed ?? 'the front'}.`
      }
      next.variables['size'] = container.order.length
      break
    }
    case 'choosePath': {
      next.selection = [action.fromId]
      current = action.fromId
      feedback = `Down the ${action.pathId} child: the target can only be in that subtree.`
      note = `Descend ${action.pathId}.`
      dsaOp = 'choose-path'
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
  const code = codeLine(id, action, state.instance)
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

function canonicalTrace(id: TreeId, state: GameState): TraceFrame[] {
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

export function createTreeOracle(id: TreeId): Oracle {
  if (!IDS.includes(id)) throw new Error(`No tree oracle for ${id}`)
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

export const createTreeTraversalsOracle = (): Oracle => createTreeOracle('tree-traversals')
export const createBstValidateOracle = (): Oracle => createTreeOracle('bst-validate')
export const createTreeLevelOrderOracle = (): Oracle => createTreeOracle('tree-level-order')
export const createBstSearchOracle = (): Oracle => createTreeOracle('bst-search')

/** Guard used by the registry test: every id must be in the catalogue. */
if (!IDS.every((id) => PROBLEM_IDS.includes(id))) throw new Error('a tree oracle id is not in PROBLEM_IDS')
