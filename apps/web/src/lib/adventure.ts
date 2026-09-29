import { DSA_TOPICS, PROBLEMS, type DsaTopic } from '@dsa/game-schema'

export interface WorldDefinition { id: DsaTopic; name: string; subtitle: string; color: string; pale: string; mark: string }
export const WORLDS: WorldDefinition[] = [
  { id: 'arrays', name: 'Array Orchard', subtitle: 'A little order. A lot to discover.', color: '#386448', pale: '#d9ebbf', mark: '01' },
  { id: 'sorting', name: 'Sorting Workshop', subtitle: 'Make every piece fall into place.', color: '#9b492c', pale: '#f9d0ae', mark: '02' },
  { id: 'stack', name: 'Stack Tower', subtitle: 'Build it up. Take it from the top.', color: '#68518d', pale: '#e6daf5', mark: '03' },
  { id: 'queue', name: 'Queue Station', subtitle: 'Everyone gets their turn.', color: '#246b75', pale: '#c9e9e8', mark: '04' },
  { id: 'binary-search', name: 'Search Observatory', subtitle: 'Narrow the sky. Find your star.', color: '#425c96', pale: '#d9e3ff', mark: '05' },
  { id: 'linked-list', name: 'Linked-list Railway', subtitle: 'Follow the connections.', color: '#8c4b65', pale: '#f4d4df', mark: '06' },
  { id: 'hash-table', name: 'Hash Bazaar', subtitle: 'Count everything once.', color: '#7a5c2e', pale: '#f3e5c3', mark: '07' },
  { id: 'strings', name: 'String Atelier', subtitle: 'Read from both ends.', color: '#3f6b4f', pale: '#d7ecd9', mark: '08' },
  { id: 'trees', name: 'Tree Canopy', subtitle: 'Branch down, visit every node.', color: '#2e5d50', pale: '#cfe8d8', mark: '09' },
  { id: 'heap', name: 'Heap Foundry', subtitle: 'Keep the k largest, drop the rest.', color: '#6b3a4d', pale: '#f2d3de', mark: '10' },
  { id: 'graphs', name: 'Graph Archipelago', subtitle: 'Islands, waves, and wandering words.', color: '#2b5d7d', pale: '#cfe4f2', mark: '11' },
  { id: 'dp', name: 'DP Observatory', subtitle: 'Small answers build big ones.', color: '#5d4a7d', pale: '#e3d8f5', mark: '12' },
  { id: 'backtracking', name: 'Backtrack Maze', subtitle: 'Choose, explore, undo.', color: '#7d5a2b', pale: '#f2e3c8', mark: '13' },
  { id: 'greedy', name: 'Greedy Frontier', subtitle: 'How far can you reach?', color: '#3d6b35', pale: '#d5ebc9', mark: '14' },
  { id: 'bit-manip', name: 'Bit Forge', subtitle: 'Fold bits until one survives.', color: '#555a6b', pale: '#dfe1ea', mark: '15' },
  { id: 'trie', name: 'Trie Grove', subtitle: 'Shared prefixes, shared paths.', color: '#2f6b5e', pale: '#cde9dd', mark: '16' },
]
export function worldForProblem(id?: string) { return WORLDS.find(w => w.id === PROBLEMS.find(p => p.id === id)?.topic) ?? WORLDS[0]! }
export interface PlayerPreferences { mapFrame: DsaTopic | 'default' }
export interface AdventureProgress { version: 1; completed: Record<string, string>; preferences: PlayerPreferences; legacyImported: boolean }
export const PROGRESS_KEY = 'play-the-algorithms:adventure:v1'
const LEGACY_KEY = 'play-the-algorithms:linked-list-solved:v1'
export const freshProgress = (): AdventureProgress => ({ version: 1, completed: {}, preferences: { mapFrame: 'default' }, legacyImported: false })
export function completedWorlds(progress: AdventureProgress): WorldDefinition[] {
  return WORLDS.filter(w => PROBLEMS.filter(p => p.topic === w.id).every(p => Boolean(progress.completed[p.id])))
}
export function nextMission(progress: AdventureProgress) {
  return DSA_TOPICS.flatMap(topic => PROBLEMS.filter(p => p.topic === topic)).find(p => !progress.completed[p.id])
}
export function recordCompletion(progress: AdventureProgress, state: { problemId: string; phase: string }, now = new Date().toISOString()): AdventureProgress {
  if (state.phase !== 'won' || !PROBLEMS.some(p => p.id === state.problemId) || progress.completed[state.problemId]) return progress
  return { ...progress, completed: { ...progress.completed, [state.problemId]: now } }
}
export function readProgress(storage: Pick<Storage, 'getItem'>, now = new Date().toISOString()): { progress: AdventureProgress; warning: boolean } {
  let progress = freshProgress()
  let warning = false
  try {
    const raw = storage.getItem(PROGRESS_KEY)
    if (raw) {
      const value = JSON.parse(raw)
      if (value?.version !== 1 || !value.completed || typeof value.completed !== 'object' || Array.isArray(value.completed)) throw new Error('Invalid progress')
      const completed = Object.fromEntries(Object.entries(value.completed).filter(([id, time]) => PROBLEMS.some(p => p.id === id) && typeof time === 'string' && Number.isFinite(Date.parse(time)))) as Record<string, string>
      progress = { version: 1, completed, preferences: { mapFrame: 'default' }, legacyImported: value.legacyImported === true }
      if (completedWorlds(progress).some(w => w.id === value.preferences?.mapFrame)) progress.preferences.mapFrame = value.preferences.mapFrame
    }
  } catch { warning = true }
  if (!progress.legacyImported) {
    try {
      const legacy = JSON.parse(storage.getItem(LEGACY_KEY) ?? '[]')
      if (Array.isArray(legacy)) {
        if (legacy.includes('count-nodes')) progress = recordCompletion(progress, { problemId: 'linked-list-traversal', phase: 'won' }, now)
        if (legacy.includes('reverse-list')) progress = recordCompletion(progress, { problemId: 'reverse-linked-list', phase: 'won' }, now)
      }
    } catch { warning = true }
    progress.legacyImported = true
  }
  return { progress, warning }
}
export function saveProgress(storage: Pick<Storage, 'setItem'>, progress: AdventureProgress): boolean {
  try { storage.setItem(PROGRESS_KEY, JSON.stringify(progress)); return true } catch { return false }
}
