/**
 * Graphs without a graph renderer: grids and parent arrays.
 *
 * Grids ARE linear boards with a column count. `instance.extras.gridCols`
 * tells both clients to lay the slots lane out as rows (web: CSS grid branch
 * in BoardLaneView; Flutter: forced columns in SlotGrid), so an island walk,
 * a rotting wave, and a backtracking path all read as 2D. The oracle only
 * promises row-major ids (`v{r*cols+c}`) plus `gridCols` — layout stays a
 * client decision, as everywhere else in this codebase.
 *
 * Five problems:
 *
 *   num-islands       DFS flood per island, row-major starts. Pure select +
 *                     submit (the tree-traversals shape). ≥2 islands forced.
 *   max-area-island   the same walk, measuring each flood; submit the max.
 *   rotting-oranges   multi-source BFS: selects in (minute, index) order, so
 *                     the trace IS the wavefront. Submit minutes or -1.
 *   word-search       DFS with an explicit undo: select + mark (assign 1),
 *                     unmark (assign 0) on dead ends. The plan is the full
 *                     exploration trace including backtracks.
 *   union-find        no grid: nodes on a line, sets in `parent_*` variables.
 *                     Per edge: walk both roots (selects), compare them, union
 *                     on mismatch (assign). Submit the component count.
 *   network-delay     no grid either: a weighted directed edge list in extras,
 *                     distances in `dist_*` variables. Settle nodes in Dijkstra
 *                     order (select), relax each outgoing edge (compare the
 *                     candidate against the known distance, assign on
 *                     improvement). Submit the largest distance.
 */
import type {
  Action,
  ActionOutcome,
  BuildInstanceInput,
  Complexity,
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

type GraphId = 'num-islands' | 'max-area-island' | 'rotting-oranges' | 'word-search' | 'union-find-connect' | 'network-delay-time'

const IDS: readonly GraphId[] = ['num-islands', 'max-area-island', 'rotting-oranges', 'word-search', 'union-find-connect', 'network-delay-time']

const LETTERS = ['a', 'b', 'c', 'd', 'e'] as const
/** Up, right, down, left — the fixed exploration order every walk uses. */
const DIRS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [0, 1], [1, 0], [0, -1]]

function sized(metaId: GraphId, input: BuildInstanceInput): number {
  const meta = getProblem(metaId)
  if (!meta) throw new Error(`${metaId} is missing from the catalogue`)
  const { minLength, maxLength } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  return Math.max(minLength, Math.min(maxLength, Math.trunc(input.length ?? defaultLength)))
}

function relation(a: number, b: number): Relation {
  return a < b ? 'lt' : a > b ? 'gt' : 'eq'
}

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

// ------------------------------------------------------------ grid structure

function dimsFor(difficulty: BuildInstanceInput['difficulty']): { rows: number; cols: number } {
  if (difficulty === 'easy') return { rows: 4, cols: 4 }
  if (difficulty === 'hard') return { rows: 5, cols: 6 }
  return { rows: 5, cols: 5 }
}

function gridIndex(r: number, c: number, cols: number): number {
  return r * cols + c
}

function gridRC(i: number, cols: number): { r: number; c: number } {
  return { r: Math.floor(i / cols), c: i % cols }
}

/** One flood in DFS discovery order (iterative, DIRS pop order). */
function flood(values: readonly number[], rows: number, cols: number, start: number, isLand: (v: number) => boolean): number[] {
  const seen = new Set<number>()
  const order: number[] = []
  const stack = [start]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    order.push(cur)
    const { r, c } = gridRC(cur, cols)
    for (let d = DIRS.length - 1; d >= 0; d--) {
      const nr = r + DIRS[d]![0]
      const nc = c + DIRS[d]![1]
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      const ni = gridIndex(nr, nc, cols)
      if (isLand(values[ni]!) && !seen.has(ni)) stack.push(ni)
    }
  }
  return order
}

/** Row-major island decomposition; each component in DFS discovery order. */
function islandComponents(values: readonly number[], rows: number, cols: number): number[][] {
  const global = new Set<number>()
  const comps: number[][] = []
  for (let i = 0; i < rows * cols; i++) {
    if (values[i] !== 1 || global.has(i)) continue
    const comp = flood(values, rows, cols, i, (v) => v === 1)
    for (const cell of comp) global.add(cell)
    comps.push(comp)
  }
  return comps
}

/** Minute each cell rots (-1 = never). Multi-source BFS in DIRS order. */
function rotDistances(values: readonly number[], rows: number, cols: number): number[] {
  const dist = new Array<number>(rows * cols).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < rows * cols; i++) {
    if (values[i] === 2) {
      dist[i] = 0
      queue.push(i)
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!
    const { r, c } = gridRC(cur, cols)
    for (const [dr, dc] of DIRS) {
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      const ni = gridIndex(nr, nc, cols)
      if (values[ni] === 1 && dist[ni] === -1) {
        dist[ni] = dist[cur]! + 1
        queue.push(ni)
      }
    }
  }
  return dist
}

function rottingAnswer(values: readonly number[], rows: number, cols: number): number {
  const dist = rotDistances(values, rows, cols)
  let best = 0
  for (let i = 0; i < rows * cols; i++) {
    if (values[i] === 1 && dist[i] === -1) return -1
    if (dist[i]! > best) best = dist[i]!
  }
  return best
}

interface WordSearchResult {
  actions: Action[]
  found: boolean
}

/** Complete ordered-DFS solver; the action trace IS the exploration including undos. */
function solveWordSearch(tokens: readonly string[], rows: number, cols: number, word: string): WordSearchResult {
  const cells = rows * cols
  const L = word.length
  const actions: Action[] = []
  const visited = new Array<boolean>(cells).fill(false)
  let found = false

  function dfs(i: number, k: number): boolean {
    if (tokens[i] !== word[k]) return false
    const { r, c } = gridRC(i, cols)
    actions.push({ type: 'selectObject', objectId: `v${i}` })
    actions.push({ type: 'assignValue', targetId: `cell_${r}_${c}`, value: '1' })
    visited[i] = true
    if (k === L - 1) {
      found = true
      return true
    }
    for (const [dr, dc] of DIRS) {
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      const ni = gridIndex(nr, nc, cols)
      if (visited[ni]) continue
      if (dfs(ni, k + 1)) return true
    }
    visited[i] = false
    actions.push({ type: 'assignValue', targetId: `cell_${r}_${c}`, value: '0' })
    return false
  }

  for (let i = 0; i < cells && !found; i++) {
    if (tokens[i] === word[0]) {
      if (dfs(i, 0)) break
    }
  }
  let lastSelect = 'v0'
  for (const a of actions) {
    if (a.type === 'selectObject') lastSelect = a.objectId
  }
  actions.push({ type: 'submitAnswer', targetId: lastSelect, value: found ? 'found' : 'absent' })
  return { actions, found }
}

/** Unreached distance. Larger than any real path (at most (n-1) × 9), small enough to read. */
const INF = 9999

/** Dijkstra with deterministic ties (smaller index first). All callers share it so the plan, the answer, and the variables agree. */
function dijkstra(n: number, edges: readonly number[], source: number): { dist: number[]; order: number[] } {
  const dist = new Array<number>(n).fill(INF)
  dist[source] = 0
  const done = new Array<boolean>(n).fill(false)
  const order: number[] = []
  for (let iter = 0; iter < n; iter++) {
    let u = -1
    for (let i = 0; i < n; i++) {
      if (!done[i] && (u === -1 || dist[i]! < dist[u]!)) u = i
    }
    done[u] = true
    order.push(u)
    for (const { v, w } of outEdges(edges, u)) {
      if (dist[u]! + w < dist[v]!) dist[v] = dist[u]! + w
    }
  }
  return { dist, order }
}

/** Outgoing edges of u in instance order: flat [from, to, weight] triples. */
function outEdges(edges: readonly number[], u: number): Array<{ v: number; w: number }> {
  const out: Array<{ v: number; w: number }> = []
  for (let e = 0; e + 2 < edges.length; e += 3) {
    if (edges[e] === u) out.push({ v: edges[e + 1]!, w: edges[e + 2]! })
  }
  return out
}
/** Union-find simulation: per-edge walk/compare/union description. */
function unionFindTrace(n: number, edges: readonly number[]): { comps: number } {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x]!
    return x
  }
  let comps = n
  for (let e = 0; e + 1 < edges.length; e += 2) {
    const ru = find(edges[e]!)
    const rv = find(edges[e + 1]!)
    if (ru !== rv) {
      parent[ru] = rv
      comps--
    }
  }
  return { comps }
}

// ------------------------------------------------------------------ instances

function randomLand(rng: () => number, rows: number, cols: number, p: number): number[] {
  return Array.from({ length: rows * cols }, () => (rng() < p ? 1 : 0))
}

function buildInstance(id: GraphId, input: BuildInstanceInput): ProblemInstance {
  const rng = makeRng(input.seed)

  if (id === 'num-islands' || id === 'max-area-island') {
    const { rows, cols } = dimsFor(input.difficulty)
    let values = randomLand(rng, rows, cols, 0.45)
    // At least two islands, or the counting game has nothing to count.
    for (let attempt = 0; attempt < 12 && islandComponents(values, rows, cols).length < 2; attempt++) {
      values = randomLand(makeRng(input.seed + attempt + 1), rows, cols, 0.45)
    }
    if (islandComponents(values, rows, cols).length < 2) {
      values = new Array<number>(rows * cols).fill(0)
      values[0] = 1
      values[rows * cols - 1] = 1
    }
    return {
      problemId: id, seed: input.seed, values, slots: linearSlots(values.length),
      extras: { difficulty: input.difficulty, rows, cols, gridCols: cols },
    }
  }

  if (id === 'rotting-oranges') {
    const dims = input.difficulty === 'hard' ? { rows: 5, cols: 5 } : dimsFor(input.difficulty)
    const { rows, cols } = dims
    const cells = rows * cols
    const roll = (): number[] => Array.from({ length: cells }, () => {
      const r = rng()
      return r < 0.25 ? 0 : r < 0.4 ? 2 : 1
    })
    let values = roll()
    const usable = (v: number[]): boolean => v.includes(2) && v.includes(1)
    for (let attempt = 0; attempt < 12 && !usable(values); attempt++) values = roll()
    // Prefer a solvable board (every fresh reachable) most of the time; an
    // unreachable fresh cell is a legitimate -1 game, kept occasionally.
    for (let attempt = 0; attempt < 12; attempt++) {
      if (!usable(values)) {
        values = roll()
        continue
      }
      const unreachable = values.some((x, i) => x === 1 && rotDistances(values, rows, cols)[i] === -1)
      if (!unreachable || rng() < 0.3) break
      values = roll()
    }
    if (!values.includes(2)) values[randInt(rng, 0, cells - 1)] = 2
    if (!values.includes(1)) {
      const spot = values.findIndex((x) => x === 0)
      values[spot === -1 ? randInt(rng, 0, cells - 1) : spot] = 1
    }
    return {
      problemId: id, seed: input.seed, values, slots: linearSlots(values.length),
      extras: { difficulty: input.difficulty, rows, cols, gridCols: cols },
    }
  }

  if (id === 'word-search') {
    const dims = input.difficulty === 'easy' ? { rows: 4, cols: 4 } : { rows: 5, cols: 5 }
    const { rows, cols } = dims
    const cells = rows * cols
    const L = input.difficulty === 'easy' ? 3 : input.difficulty === 'hard' ? 5 : 4
    const randomWord = (r: () => number): string =>
      Array.from({ length: L }, () => LETTERS[Math.floor(r() * LETTERS.length)]!).join('')
    const word = randomWord(rng)
    const wantPresent = rng() >= 0.4
    const randomLetters = (r: () => number): string[] =>
      Array.from({ length: cells }, () => LETTERS[Math.floor(r() * LETTERS.length)]!)

    // A self-avoiding random walk for the embedded word; falls back to a
    // horizontal placement, which always fits (L <= cols).
    const embed = (letters: string[], r: () => number): boolean => {
      for (let t = 0; t < 30; t++) {
        const path = [randInt(r, 0, cells - 1)]
        while (path.length < L) {
          const { r: cr, c: cc } = gridRC(path[path.length - 1]!, cols)
          const options: number[] = []
          for (const [dr, dc] of DIRS) {
            const nr = cr + dr
            const nc = cc + dc
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
            const ni = gridIndex(nr, nc, cols)
            if (!path.includes(ni)) options.push(ni)
          }
          if (options.length === 0) break
          path.push(options[Math.floor(r() * options.length)]!)
        }
        if (path.length === L) {
          path.forEach((cell, k) => {
            letters[cell] = word[k]!
          })
          return true
        }
      }
      const row = randInt(r, 0, rows - 1)
      for (let k = 0; k < L; k++) letters[gridIndex(row, k, cols)] = word[k]!
      return true
    }

    let letters = randomLetters(rng)
    let valid: boolean
    if (wantPresent) {
      embed(letters, rng)
      valid = true
    } else {
      // The first letter is forced present so the search always has something
      // to explore; absence is decided by the full word, verified by solving.
      letters[randInt(rng, 0, cells - 1)] = word[0]!
      valid = solveWordSearch(letters, rows, cols, word).found
      for (let t = 0; t < 8 && valid; t++) {
        letters = randomLetters(makeRng(input.seed + t + 1))
        letters[randInt(makeRng(input.seed + t + 100), 0, cells - 1)] = word[0]!
        valid = solveWordSearch(letters, rows, cols, word).found
      }
      if (valid) {
        embed(letters, rng)
        valid = true
      }
    }
    return {
      problemId: id, seed: input.seed,
      values: letters.map((c) => c.charCodeAt(0)),
      tokens: letters, slots: linearSlots(letters.length),
      extras: { difficulty: input.difficulty, rows, cols, gridCols: cols, word, valid },
    }
  }

  // network-delay-time: a weighted directed edge list. A spanning
  // arborescence out of node 0 guarantees every node is reachable, so the
  // delay is always a number (never -1); extra edges add route choices.
  if (id === 'network-delay-time') {
    const n = Math.max(4, sized(id, input))
    const seen = new Set<string>()
    const edges: number[] = []
    for (let i = 1; i < n; i++) {
      const parent = randInt(rng, 0, i - 1)
      seen.add(`${parent}-${i}`)
      edges.push(parent, i, 1 + randInt(rng, 0, 8))
    }
    const m = n + 1
    let guard = 0
    while (edges.length < 3 * m && guard++ < 300) {
      const u = randInt(rng, 0, n - 1)
      const v = randInt(rng, 0, n - 1)
      if (u === v) continue
      const key = `${u}-${v}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push(u, v, 1 + randInt(rng, 0, 8))
    }
    return {
      problemId: id, seed: input.seed,
      values: Array.from({ length: n }, (_, i) => i),
      slots: linearSlots(n),
      extras: { difficulty: input.difficulty, edges, source: 0 },
    }
  }

  // union-find-connect: a plain linear board of node labels plus an edge list.
  const n = Math.max(4, sized(id, input))
  const m = n + 1
  const seen = new Set<string>()
  const edges: number[] = []
  let guard = 0
  while (edges.length < 2 * m && guard++ < 200) {
    const u = randInt(rng, 0, n - 1)
    const v = randInt(rng, 0, n - 1)
    if (u === v) continue
    const key = u < v ? `${u}-${v}` : `${v}-${u}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(u, v)
  }
  return {
    problemId: id, seed: input.seed,
    values: Array.from({ length: n }, (_, i) => i),
    slots: linearSlots(n),
    extras: { difficulty: input.difficulty, edges },
  }
}

// --------------------------------------------------------------------- states

function initState(id: GraphId, instance: ProblemInstance): GameState {
  const extras = instance.extras ?? {}
  if (id === 'word-search') {
    const state = buildBoard({ problemId: id, instance, kind: 'token', variables: { r: 0, c: 0, n: instance.values.length } })
    state.internal = { planIndex: 0 }
    return state
  }
  if (id === 'network-delay-time') {
    const n = instance.values.length
    const source = num(instance.extras?.['source'], 0)
    const variables: GameState['variables'] = { i: 0, settled: 0, n, source }
    for (let i = 0; i < n; i++) variables[`dist_${i}`] = i === source ? 0 : INF
    const state = buildBoard({ problemId: id, instance, variables })
    state.internal = { planIndex: 0 }
    return state
  }
  if (id === 'union-find-connect') {
    const n = instance.values.length
    const variables: GameState['variables'] = { i: 0, comps: n, n }
    for (let i = 0; i < n; i++) variables[`parent_${i}`] = i
    const state = buildBoard({ problemId: id, instance, variables })
    state.internal = { planIndex: 0 }
    return state
  }
  const cols = num(extras['cols'], 4)
  void cols
  const state = buildBoard({
    problemId: id, instance,
    variables: id === 'rotting-oranges' ? { r: 0, c: 0, minutes: 0, n: instance.values.length } : { r: 0, c: 0, islands: 0, n: instance.values.length },
  })
  if (id === 'max-area-island') {
    state.variables = { r: 0, c: 0, curArea: 0, maxArea: 0, n: instance.values.length }
  }
  state.internal = { planIndex: 0 }
  return state
}

// ---------------------------------------------------------------------- plans

function gridDims(instance: ProblemInstance): { rows: number; cols: number } {
  const rows = num(instance.extras?.['rows'], 4)
  const cols = num(instance.extras?.['cols'], 4)
  return { rows, cols }
}

function actionsFor(id: GraphId, instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const v = instance.values

  if (id === 'num-islands' || id === 'max-area-island') {
    const { rows, cols } = gridDims(instance)
    const comps = islandComponents(v, rows, cols)
    for (const comp of comps) {
      for (const cell of comp) actions.push({ type: 'selectObject', objectId: `v${cell}` })
    }
    const last = comps.length > 0 ? comps[comps.length - 1]![comps[comps.length - 1]!.length - 1]! : 0
    const value = id === 'num-islands' ? String(comps.length) : String(Math.max(...comps.map((c) => c.length)))
    actions.push({ type: 'submitAnswer', targetId: `v${last}`, value })
    return actions
  }

  if (id === 'rotting-oranges') {
    const { rows, cols } = gridDims(instance)
    const dist = rotDistances(v, rows, cols)
    const order = dist
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d >= 0)
      .sort((a, b) => a.d - b.d || a.i - b.i)
    for (const { i } of order) actions.push({ type: 'selectObject', objectId: `v${i}` })
    const last = order.length > 0 ? order[order.length - 1]!.i : 0
    actions.push({ type: 'submitAnswer', targetId: `v${last}`, value: String(rottingAnswer(v, rows, cols)) })
    return actions
  }

  if (id === 'word-search') {
    const { rows, cols } = gridDims(instance)
    const word = String(instance.extras?.['word'] ?? '')
    return solveWordSearch(instance.tokens ?? [], rows, cols, word).actions
  }

  // network-delay-time: settle in Dijkstra order; relax every outgoing edge.
  if (id === 'network-delay-time') {
    const delayN = v.length
    const delayEdges = (instance.extras?.['edges'] as number[] | undefined) ?? []
    const source = num(instance.extras?.['source'], 0)
    const dist = new Array<number>(delayN).fill(INF)
    dist[source] = 0
    const done = new Array<boolean>(delayN).fill(false)
    for (let iter = 0; iter < delayN; iter++) {
      let u = -1
      for (let i = 0; i < delayN; i++) {
        if (!done[i] && (u === -1 || dist[i]! < dist[u]!)) u = i
      }
      done[u] = true
      actions.push({ type: 'selectObject', objectId: `v${u}` })
      for (const { v: nb, w } of outEdges(delayEdges, u)) {
        const rel = relation(dist[u]! + w, dist[nb]!)
        actions.push({ type: 'comparePair', aId: `v${u}`, bId: `v${nb}`, relation: rel })
        if (rel === 'lt') {
          dist[nb] = dist[u]! + w
          actions.push({ type: 'assignValue', targetId: `dist_${nb}`, value: String(dist[nb]) })
        }
      }
    }
    const { order } = dijkstra(delayN, delayEdges, source)
    const last = order[order.length - 1] ?? source
    actions.push({ type: 'submitAnswer', targetId: `v${last}`, value: String(Math.max(...dist)) })
    return actions
  }

  // union-find-connect
  const n = v.length
  const edges = (instance.extras?.['edges'] as number[] | undefined) ?? []
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): { root: number; path: number[] } => {
    const path = [x]
    while (parent[x] !== x) {
      x = parent[x]!
      path.push(x)
    }
    return { root: x, path }
  }
  for (let e = 0; e + 1 < edges.length; e += 2) {
    const u = find(edges[e]!)
    const w = find(edges[e + 1]!)
    for (const node of u.path) actions.push({ type: 'selectObject', objectId: `v${node}` })
    for (const node of w.path) actions.push({ type: 'selectObject', objectId: `v${node}` })
    const rel = relation(u.root, w.root)
    actions.push({ type: 'comparePair', aId: `v${u.root}`, bId: `v${w.root}`, relation: rel })
    if (rel !== 'eq') {
      actions.push({ type: 'assignValue', targetId: `parent_${u.root}`, value: String(w.root) })
      parent[u.root] = w.root
    }
  }
  const { comps } = unionFindTrace(n, edges)
  actions.push({ type: 'submitAnswer', targetId: 'v0', value: String(comps) })
  return actions
}

// ------------------------------------------------------------------ metadata

function codeLine(id: GraphId, action: Action): number {
  if (action.type === 'submitAnswer') {
    if (id === 'word-search') return action.value === 'found' ? 3 : 5
    return 9
  }
  if (action.type === 'selectObject') {
    if (id === 'word-search') return 9
    if (id === 'union-find-connect') return 13
    if (id === 'network-delay-time') return 5
    return 6
  }
  if (action.type === 'comparePair') return id === 'network-delay-time' ? 7 : 6
  if (action.type === 'assignValue') {
    if (id === 'word-search') return action.value === '1' ? 9 : 14
    if (id === 'network-delay-time') return 8
    return 7
  }
  return 1
}

function source(id: GraphId): string[] {
  switch (id) {
    case 'num-islands': return ['function numIslands(grid) {', '  let count = 0', '  for (let r = 0; r < rows; r++) {', '    for (let c = 0; c < cols; c++) {', '      if (grid[r][c] === 1 && !seen) {', '        flood(r, c)', '        count++', '      }', '    }', '  }', '  return count', '}']
    case 'max-area-island': return ['function maxArea(grid) {', '  let best = 0', '  for (let r = 0; r < rows; r++) {', '    for (let c = 0; c < cols; c++) {', '      if (grid[r][c] === 1 && !seen) {', '        area = flood(r, c)', '        best = Math.max(best, area)', '      }', '    }', '  }', '  return best', '}']
    case 'rotting-oranges': return ['function rottingOranges(grid) {', '  queue all rotten at minute 0', '  while (queue.length) {', '    cell = queue.shift()', '    for (const nb of neighbours(cell)) {', '      if (nb is fresh) { rot it, minute = cell.minute + 1 }', '    }', '  }', '  return fresh remain ? -1 : last minute', '}']
    case 'word-search': return ['function exist(board, word) {', '  for (let r = 0; r < rows; r++) {', '    for (let c = 0; c < cols; c++) if (dfs(r, c, 0)) return true', '  }', '  return false', '}', 'function dfs(r, c, k) {', '  if (board[r][c] !== word[k]) return false', '  mark (r, c) visited', '  if (k === word.length - 1) return true', '  for (const [nr, nc] of neighbours(r, c)) {', '    if (!visited && dfs(nr, nc, k + 1)) return true', '  }', '  unmark (r, c)', '  return false', '}']
    case 'union-find-connect': return ['function components(n, edges) {', '  parent = [0..n-1]', '  let comps = n', '  for (const [u, v] of edges) {', '    ru = find(u); rv = find(v)', '    if (ru !== rv) {', '      parent[ru] = rv', '      comps--', '    }', '  }', '  return comps', '}', 'function find(x) {', '  while (parent[x] !== x) x = parent[x]', '  return x', '}']
    case 'network-delay-time': return ['function networkDelay(n, edges, source) {', '  dist = [0, ∞, ...]; settled = none', '  repeat n times:', '    u = the closest unsettled node', '    settle u', '    for each edge u -> v with weight w:', '      if dist[u] + w < dist[v]:', '        dist[v] = dist[u] + w', '  return max(dist)', '}']
  }
}

function pseudocode(id: GraphId): string[] {
  switch (id) {
    case 'num-islands': return ['FUNCTION numIslands(grid)', '    count <- 0', '    FOR each cell row by row', '        IF land AND unvisited', '            FLOOD through land neighbours', '            count <- count + 1', '    END FOR', '    RETURN count', 'END FUNCTION']
    case 'max-area-island': return ['FUNCTION maxArea(grid)', '    best <- 0', '    FOR each cell row by row', '        IF land AND unvisited', '            area <- FLOOD through land neighbours', '            best <- max(best, area)', '    END FOR', '    RETURN best', 'END FUNCTION']
    case 'rotting-oranges': return ['FUNCTION rottingOranges(grid)', '    QUEUE every rotten cell at minute 0', '    WHILE queue is nonempty', '        cell <- DEQUEUE', '        ROT each fresh neighbour at minute + 1', '    END WHILE', '    RETURN fresh remain ? -1 : last minute', 'END FUNCTION']
    case 'word-search': return ['FUNCTION exist(board, word)', '    FOR each cell as a start', '        DFS letter by letter through unvisited neighbours', '        MARK the path; UNMARK on dead ends', '        IF every letter matched: RETURN true', '    END FOR', '    RETURN false', 'END FUNCTION']
    case 'union-find-connect': return ['FUNCTION components(n, edges)', '    parent[i] <- i, comps <- n', '    FOR each edge (u, v)', '        ru <- FIND(u); rv <- FIND(v)', '        IF ru != rv: parent[ru] <- rv, comps <- comps - 1', '    END FOR', '    RETURN comps', 'END FUNCTION']
    case 'network-delay-time': return ['FUNCTION networkDelay(n, edges, source)', '    dist[source] <- 0, rest <- ∞', '    REPEAT n times', '        u <- closest UNSETTLED node; SETTLE it', '        FOR each edge u -> v with weight w', '            IF dist[u] + w < dist[v]: dist[v] <- dist[u] + w', '    END REPEAT', '    RETURN max(dist)', 'END FUNCTION']
  }
}

function complexity(id: GraphId): Complexity {
  const meta = getProblem(id)!
  return { ...meta.complexity }
}

function answerText(id: GraphId, instance: ProblemInstance): { text: string; value: string | number } {
  const v = instance.values
  if (id === 'num-islands' || id === 'max-area-island') {
    // Recomputed from the values, never read from extras.
    const { rows, cols } = gridDims(instance)
    const comps = islandComponents(v, rows, cols)
    if (id === 'num-islands') return { text: `${comps.length} islands`, value: comps.length }
    const best = Math.max(...comps.map((c) => c.length))
    return { text: `max area ${best}`, value: best }
  }
  if (id === 'rotting-oranges') {
    const { rows, cols } = gridDims(instance)
    const answer = rottingAnswer(v, rows, cols)
    return answer === -1 ? { text: 'some fresh oranges never rot', value: -1 } : { text: `${answer} minutes to rot everything`, value: answer }
  }
  if (id === 'word-search') {
    const { rows, cols } = gridDims(instance)
    const word = String(instance.extras?.['word'] ?? '')
    const found = solveWordSearch(instance.tokens ?? [], rows, cols, word).found
    return found ? { text: `the word "${word}" is on the board`, value: 'found' } : { text: `the word "${word}" is not on the board`, value: 'absent' }
  }
  if (id === 'network-delay-time') {
    const delayN = v.length
    const delayEdges = (instance.extras?.['edges'] as number[] | undefined) ?? []
    const source = num(instance.extras?.['source'], 0)
    const { dist } = dijkstra(delayN, delayEdges, source)
    const delay = Math.max(...dist)
    return { text: `the signal reaches every node in ${delay}`, value: delay }
  }
  const n = v.length
  const edges = (instance.extras?.['edges'] as number[] | undefined) ?? []
  const { comps } = unionFindTrace(n, edges)
  return { text: `${comps} connected components`, value: comps }
}

// ------------------------------------------------------------------ gameplay

function legalActions(id: GraphId, state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(id, state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') {
    const label =
      id === 'num-islands' ? 'Claim the next land cell of this island'
      : id === 'max-area-island' ? 'Measure the next cell of this island'
      : id === 'rotting-oranges' ? 'Visit the next cell the wave reaches'
      : id === 'word-search' ? 'Step onto the next matching letter'
      : id === 'network-delay-time' ? 'Settle the closest unsettled node'
      : 'Walk up to the root'
    return [{ type: next.type, label, options: { objectIds: [next.objectId] } }]
  }
  if (next.type === 'comparePair') {
    const label =
      id === 'network-delay-time' ? 'Is the path through the settled node shorter?' : 'Are these two roots the same set?'
    return [{ type: next.type, label, options: { objectIds: [next.aId, next.bId] }, expects: 'relation' }]
  }
  if (next.type === 'assignValue') {
    const label =
      id === 'word-search' ? 'Mark or unmark this path cell'
      : id === 'network-delay-time' ? 'Record the shorter distance'
      : 'Attach the root under the other set'
    return [{ type: next.type, label, expects: 'value' }]
  }
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Submit the result', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function context(id: GraphId) {
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

/** Island starts and per-cell island membership, recomputed deterministically. */
function islandStarts(instance: ProblemInstance): Set<number> {
  const { rows, cols } = gridDims(instance)
  const comps = islandComponents(instance.values, rows, cols)
  return new Set(comps.map((c) => c[0]!))
}

function islandMembership(instance: ProblemInstance): Map<number, { comp: number; order: number }> {
  const { rows, cols } = gridDims(instance)
  const comps = islandComponents(instance.values, rows, cols)
  const map = new Map<number, { comp: number; order: number }>()
  comps.forEach((comp, ci) => comp.forEach((cell, oi) => map.set(cell, { comp: ci, order: oi })))
  return map
}

function applyAction(id: GraphId, state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const step = num(state.internal['planIndex'], 0)
  const expected = actionsFor(id, state.instance)[step]
  const ctx = context(id)
  if (state.phase !== 'playing' || !expected || !sameAction(action, expected)) {
    return finishIllegal(state, action, {
      feedback: expected ? `The next algorithm step is ${expected.type}; follow the highlighted cell and try that operation.` : 'This game is already complete.',
      dsaOp: dsaOpForAction(action),
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
  const dsaOp = dsaOpForAction(action)

  switch (action.type) {
    case 'selectObject': {
      next.selection = [action.objectId]
      if (next.objects[action.objectId]) next.objects[action.objectId]!.state = 'current'
      const position = indexOf(next, action.objectId)
      if (position >= 0) {
        const { rows: _rows, cols } = gridDims(next.instance)
        void _rows
        // Union-find and Dijkstra boards are linear node lines, not grids:
        // row/column arithmetic would place them on phantom rows.
        const linear = id === 'union-find-connect' || id === 'network-delay-time'
        const { r, c } = gridRC(position, linear ? Math.max(1, next.instance.values.length) : cols)
        next.variables['r'] = linear ? 0 : r
        next.variables['c'] = linear ? 0 : c
        next.variables['i'] = position
        if (id === 'network-delay-time') {
          next.variables['settled'] = num(next.variables['settled'], 0) + 1
        }
        if (next.slots[`s${position}`]) next.cursor.iSlotId = `s${position}`
        if (id === 'num-islands' && islandStarts(next.instance).has(position)) {
          next.variables['islands'] = num(next.variables['islands'], 0) + 1
        }
        if (id === 'max-area-island') {
          const member = islandMembership(next.instance).get(position)
          if (member && member.order === 0) {
            next.variables['curArea'] = 1
          } else {
            next.variables['curArea'] = num(next.variables['curArea'], 0) + 1
          }
          next.variables['maxArea'] = Math.max(num(next.variables['maxArea'], 0), num(next.variables['curArea'], 0))
        }
        if (id === 'rotting-oranges') {
          const { rows, cols: rc } = gridDims(next.instance)
          next.variables['minutes'] = rotDistances(next.instance.values, rows, rc)[position] ?? 0
        }
      }
      current = action.objectId
      note = `Visit ${next.objects[action.objectId]?.label ?? action.objectId}.`
      break
    }
    case 'assignValue': {
      const numeric = Number(action.value)
      next.variables[action.targetId] = Number.isFinite(numeric) ? numeric : action.value
      if (id === 'union-find-connect' && action.targetId.startsWith('parent_')) {
        next.variables['comps'] = num(next.variables['comps'], 1) - 1
      }
      feedback = `${action.targetId} now records ${action.value}.`
      note = `Store ${action.value} in ${action.targetId}.`
      break
    }
    case 'comparePair': {
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
      note =
        id === 'network-delay-time'
          ? action.relation === 'lt'
            ? 'Shorter through the settled node — record it.'
            : 'No improvement — keep the known distance.'
          : action.relation === 'eq'
            ? 'Already the same set — no union.'
            : 'Different sets — union them.'
      break
    }
    case 'submitAnswer': {
      next.phase = 'won'
      next.variables['answer'] = action.value
      feedback = 'Correct. The algorithm is complete.'
      note = 'Commit the result.'
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

function canonicalTrace(id: GraphId, state: GameState): TraceFrame[] {
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

export function createGraphOracle(id: GraphId): Oracle {
  if (!IDS.includes(id)) throw new Error(`No graph oracle for ${id}`)
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

export const createNumIslandsOracle = (): Oracle => createGraphOracle('num-islands')
export const createMaxAreaIslandOracle = (): Oracle => createGraphOracle('max-area-island')
export const createRottingOrangesOracle = (): Oracle => createGraphOracle('rotting-oranges')
export const createWordSearchOracle = (): Oracle => createGraphOracle('word-search')
export const createUnionFindConnectOracle = (): Oracle => createGraphOracle('union-find-connect')
export const createNetworkDelayTimeOracle = (): Oracle => createGraphOracle('network-delay-time')

/** Guard used by the registry test: every id must be in the catalogue. */
if (!IDS.every((id) => PROBLEM_IDS.includes(id))) throw new Error('a graph oracle id is not in PROBLEM_IDS')
