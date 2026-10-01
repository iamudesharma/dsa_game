/**
 * Skill → catalogue problem mapping.
 *
 * Deterministic data, not model output. Each entry points at a `problemId`
 * that exists in `packages/game-schema/src/problems.ts` and is currently
 * playable (has an oracle). The interview service re-checks playability at
 * serve time; this table is the static first pass.
 */

export interface SkillPractice {
  problemId: string
  label: string
}

const MAP: Record<string, SkillPractice[]> = {
  // Languages / runtimes (map to approachable entry points, not the language).
  python: [{ problemId: 'two-sum', label: 'Practise hash lookups' }],
  javascript: [{ problemId: 'two-sum', label: 'Practise hash lookups' }],
  typescript: [{ problemId: 'two-sum', label: 'Practise hash lookups' }],
  java: [{ problemId: 'array-max-min', label: 'Practise linear scans' }],
  'c++': [{ problemId: 'array-max-min', label: 'Practise linear scans' }],
  go: [{ problemId: 'array-max-min', label: 'Practise linear scans' }],
  rust: [{ problemId: 'array-max-min', label: 'Practise linear scans' }],

  // Core CS skills.
  algorithms: [{ problemId: 'binary-search', label: 'Play binary search' }],
  'data structures': [{ problemId: 'linked-list-traversal', label: 'Play linked-list traversal' }],
  'problem solving': [{ problemId: 'binary-search', label: 'Play binary search' }],
  'dynamic programming': [{ problemId: 'climbing-stairs', label: 'Play climbing stairs' }],
  dp: [{ problemId: 'climbing-stairs', label: 'Play climbing stairs' }],
  recursion: [{ problemId: 'tree-traversals', label: 'Play tree traversals' }],
  graphs: [{ problemId: 'num-islands', label: 'Play number of islands' }],
  trees: [{ problemId: 'tree-traversals', label: 'Play tree traversals' }],
  'binary search': [{ problemId: 'binary-search', label: 'Play binary search' }],
  sorting: [{ problemId: 'bubble-sort', label: 'Play bubble sort' }],
  'hash tables': [{ problemId: 'frequency-count', label: 'Play frequency count' }],
  hashmap: [{ problemId: 'two-sum', label: 'Practise hash lookups' }],
  stack: [{ problemId: 'valid-parentheses', label: 'Play valid parentheses' }],
  queue: [{ problemId: 'queue-operations', label: 'Play queue operations' }],
  'linked list': [{ problemId: 'linked-list-traversal', label: 'Play linked-list traversal' }],
  heap: [{ problemId: 'kth-largest-heap', label: 'Play kth largest' }],
  'system design': [{ problemId: 'union-find-connect', label: 'Play connected components' }],
  sql: [{ problemId: 'frequency-count', label: 'Play frequency count' }],

  // ML-adjacent.
  'machine learning': [{ problemId: 'kadane-max-subarray', label: 'Play Kadane’s scan' }],
  ml: [{ problemId: 'kadane-max-subarray', label: 'Play Kadane’s scan' }],
  pytorch: [{ problemId: 'kadane-max-subarray', label: 'Play Kadane’s scan' }],
  numpy: [{ problemId: 'sliding-window-max-sum', label: 'Play sliding window' }],
}

export function practiceForSkill(skillName: string): SkillPractice | null {
  const key = skillName.trim().toLowerCase()
  if (!key) return null
  const direct = MAP[key]
  if (direct?.[0]) return direct[0]
  // Substring fallback: "advanced python" still matches python.
  for (const [k, v] of Object.entries(MAP)) {
    if (key.includes(k) && v[0]) return v[0]
  }
  return null
}

export function practiceForText(text: string): SkillPractice | null {
  return practiceForSkill(text)
}
