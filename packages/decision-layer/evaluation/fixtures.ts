import { PROBLEMS } from '@dsa/game-schema'
import { getOracle } from '../../dsa-oracles/src/index.js'
import { INTENT_OPTIONS } from '../src/examples.js'

// Independently authored development/test wording. Never used as prototype embeddings.
const phrasing: Record<string, [string, string]> = {
  'binary-search': ['Look up a value by cutting an ordered range in half', 'Locate 42 in an ascending sequence without inspecting every item'],
  'array-max-min': ['Identify the biggest and smallest array entries', 'Scan temperatures to report the hottest and coldest readings'],
  'two-sum': ['Find target-sum complements in an unordered collection', 'Which two entries add to nine? The input is unsorted and I want a hash table'],
  'move-zeroes': ['Shift zero values behind all nonzero values', 'Keep the nonzero order but move every 0 to the back'],
  'bubble-sort': ['Put numbers in order using neighbouring exchanges', 'I want the sorting method that repeatedly swaps adjacent out-of-order items'],
  'selection-sort': ['Sort by repeatedly extracting the smallest remaining item', 'Choose the minimum from the unsorted suffix for each next position'],
  'valid-parentheses': ['Recognize correctly nested bracket expressions', 'Is {[()]} properly matched? Use last-opened first-closed logic'],
  'stack-push-pop': ['Practice adding and removing from the top of a stack', 'Show how a pile behaves when I push then pop and it becomes empty'],
  'queue-operations': ['Practice first-in-first-out insertion and removal', 'Simulate people joining the back of a line and leaving from its front'],
  'linked-list-traversal': ['Visit each node by following its successor', 'Count how many nodes exist by walking the next links once'],
  'reverse-linked-list': ['Change each next link to point at its predecessor', 'Make the tail become the head by flipping a singly linked chain'],
  'sliding-window-max-sum': ['Find the greatest total over a fixed-size window', 'Among all consecutive groups of three numbers, which has the largest sum?'],
  'two-pointers-pair': ['Meet a target sum in a sorted sequence using two ends', 'On a sorted array advance the low or high pointer until the pair sums to ten'],
  'prefix-sum-range': ['Precompute cumulative totals for interval queries', 'Answer many subarray sum queries by subtracting two cumulative sums'],
  'kadane-max-subarray': ['Track the best running contiguous sum', 'Find the maximum-sum continuous slice when some values are negative'],
  'merge-intervals': ['Combine intersecting start-end ranges', 'Collapse overlapping appointment intervals into disjoint spans'],
  'next-greater-element': ['Find the first larger number to the right', 'For each value use a monotonic stack to locate its next strictly greater successor'],
  'rotated-search': ['Search an ordered array shifted around a pivot', 'Find a target in [4,5,6,1,2,3] by exploiting the sorted half'],
  'linked-list-cycle': ['Use slow and fast runners to detect a loop', 'Determine whether repeatedly following next eventually revisits a node'],
  'frequency-count': ['Tally how often every item appears', 'Build a table mapping each array value to its occurrence count'],
  'valid-anagram': ['Compare two words by their character multiplicities', 'Check whether listen and silent contain exactly the same letters'],
  'valid-palindrome': ['Compare matching characters from opposite ends', 'Ignore punctuation and case to see if a phrase reads the same backwards'],
  'tree-traversals': ['Visit a binary tree with depth-first ordering', 'Practice preorder, inorder and postorder visits on a binary tree'],
  'bst-validate': ['Check whether all nodes obey inherited BST bounds', 'Verify each subtree respects the ancestor lower and upper value limits'],
  'tree-level-order': ['Visit tree nodes breadth first with a queue', 'List the root, then its children, then grandchildren by depth'],
  'bst-search': ['Find a value by choosing left or right in a search tree', 'Look up a key in a BST using node comparisons'],
  'kth-largest-heap': ['Keep a bounded min heap to retain the largest k values', 'Find the third largest entry with a heap of size three'],
  'num-islands': ['Count disconnected groups of land cells', 'How many separate islands appear in a zero-one grid connected orthogonally?'],
  'max-area-island': ['Measure the biggest connected component of land', 'Return the number of cells in the largest island rather than count islands'],
  'rotting-oranges': ['Spread rot simultaneously from multiple starting cells', 'How many minutes until all reachable fresh oranges become rotten?'],
  'word-search': ['Find a word by walking neighbouring letter cells', 'Can adjacent grid letters spell a word without reusing a cell?'],
  'union-find-connect': ['Track connected components with disjoint sets', 'Merge groups after each edge and check if two vertices share a representative'],
  'climbing-stairs': ['Count ways to reach a step using jumps of one or two', 'How many different sequences of one-step and two-step moves reach stair n?'],
  'house-robber': ['Maximize loot without selecting neighbouring houses', 'Choose nonadjacent amounts for the greatest total payout'],
  subsets: ['Enumerate every combination of selected elements', 'Generate the power set, including the empty selection'],
  permutations: ['Enumerate every possible ordering of the input items', 'Produce all rearrangements using each element exactly once'],
  'jump-game': ['Track the furthest index reachable from jump lengths', 'Can I reach the final array position when each entry gives my maximum jump?'],
  'single-number': ['Cancel duplicate integers with XOR', 'Every integer occurs twice except one; isolate it using bitwise exclusive or'],
  'trie-prefix-search': ['Follow a prefix through a character trie', 'Determine whether a stored word starts with the given characters using a trie'],
  'network-delay-time': ['Find shortest signal travel times on weighted directed edges', 'Use Dijkstra to determine when a broadcast reaches every network vertex'],
  'coin-change': ['Minimize the number of coins needed for an amount', 'Find the fewest denominations summing to eleven, or say impossible'],
  'kruskal-mst': ['Choose minimum-cost edges without creating cycles', 'Connect all vertices at lowest total weight using sorted edges and disjoint sets'],
  'unique-paths': ['Count right-down grid routes that avoid obstacles', 'How many ways cross a blocked grid moving only right and down?'],
  'lcs-length': ['Find the length of a subsequence shared by two strings', 'Compute how many characters match in order while allowing gaps in both words'],
  'edit-distance': ['Minimize insertions deletions and replacements between strings', 'How many single-character edits transform kitten into sitting?'],
}
export interface Fixture { split: 'development' | 'heldout'; kind: 'route-problem' | 'request-intent' | 'pick-theme'; text: string; expected: string | null; options: Record<string, string> }
const playable = PROBLEMS.filter(p => getOracle(p.id))
export const problemOptions = Object.fromEntries(playable.map(p => [p.id, `${p.title}: ${p.learningObjective}`]))
export const fixtures: Fixture[] = playable.flatMap(p => {
  if (!phrasing[p.id]) throw new Error(`Missing independent fixture for playable problem ${p.id}`)
  return (['development', 'heldout'] as const).map((split, i) => ({ split, kind: 'route-problem' as const, text: phrasing[p.id]![i]!, expected: p.id, options: problemOptions }))
})
for (const [a, b] of [['Write a poem about clouds', 'What is the weather today?'], ['Recommend a cafe', 'Help me book a flight'], ['Not sorting; I want to reverse next pointers', 'Not binary search: check if all brackets close in the proper order']]) {
  for (const [i, text] of [a!, b!].entries()) fixtures.push({ split: i ? 'heldout' : 'development', kind: 'route-problem', text, expected: text.startsWith('Not sorting') ? 'reverse-linked-list' : text.startsWith('Not binary') ? 'valid-parentheses' : null, options: problemOptions })
}
for (const [expected, a, b] of [
  ['explanation', 'Explain why binary search halves the range', 'Teach me how a queue works'],
  ['code-help', 'Debug my broken loop', 'What is the time complexity of this implementation?'],
  ['practice', 'Give me a new exercise', 'Generate another game for me'],
  ['career-help', 'Review my resume for interviews', 'Help me prepare for a software engineer interview'],
  ['unrelated', 'Recommend a hotel', 'Write a love poem'],
]) for (const [i, text] of [a!, b!].entries()) fixtures.push({ split: i ? 'heldout' : 'development', kind: 'request-intent', text, expected: expected!, options: INTENT_OPTIONS })
const themes = { arctic: 'Ice, snow and frozen landscapes', desert: 'Sand dunes and hot sun', jungle: 'Green forest canopy and vines', 'neon-city': 'Futuristic city with glowing lights' }
for (const [expected, a, b] of [['arctic', 'Give me a snowy landscape', 'A frozen polar adventure'], ['desert', 'Set this in sandy dunes', 'A scorching wilderness of sand'], ['jungle', 'Use a lush forest', 'Take me through vines and tropical trees'], ['neon-city', 'A glowing futuristic town', 'Make a cyberpunk night skyline']]) for (const [i,text] of [a!,b!].entries()) fixtures.push({split:i?'heldout':'development',kind:'pick-theme',text,expected:expected!,options:themes})

for (const [split, text, expected] of [
  ['development', 'Teach me binray search on a sorted list', 'binary-search'],
  ['heldout', 'Find target using bianry serach and repeatedly halve the sorted range', 'binary-search'],
  ['development', 'Find whether my parantheses are balanced', 'valid-parentheses'],
  ['heldout', 'Help check balanced brakets with a stack', 'valid-parentheses'],
  ['development', 'I do not want a queue; practice last-in-first-out push and pop', 'stack-push-pop'],
  ['heldout', 'Do not count islands; measure the largest land component', 'max-area-island'],
  ['development', 'Count coins in my wallet, not a programming question', null],
  ['heldout', 'I want to book a hotel, not practice sorting', null],
] as const) fixtures.push({ split, kind:'route-problem', text, expected, options:problemOptions })
