import { PROBLEMS } from '@dsa/game-schema'

/** Examples describe intent, rather than claim competence from completed games. */
export const PROBLEM_EXAMPLES: Record<string, string[]> = Object.fromEntries(PROBLEMS.map(p => [p.id, [
  p.learningObjective,
  `Practice ${p.title}: ${p.canonicalAlgorithm}`,
]]))
Object.assign(PROBLEM_EXAMPLES, {
  'binary-search': ['Find a target in an ordered list by repeatedly halving the search range', 'Locate a number in a sorted array efficiently'],
  'two-sum': ['Find two numbers whose sum equals a target using a hash map', 'Remember complements to find a pair in an unsorted list'],
  'two-pointers-pair': ['Find a pair in a sorted array using pointers at both ends', 'Move left and right pointers to reach a target sum'],
  'bubble-sort': ['Sort by swapping adjacent items that are in the wrong order', 'Repeatedly compare neighbouring numbers'],
  'selection-sort': ['Select the smallest remaining item and put it at the front', 'Sort by finding the minimum of the unsorted suffix'],
  'valid-parentheses': ['Check whether opening and closing brackets are balanced', 'Match nested parentheses with a stack'],
  'reverse-linked-list': ['Flip next pointers so a chain runs backwards', 'Reverse the direction of a singly linked list'],
  'linked-list-traversal': ['Follow next pointers and count nodes in a chain', 'Walk a linked list from head to tail'],
})
export const INTENT_EXAMPLES: Record<string, string[]> = {
  explanation: ['Explain a data structure in plain language', 'Help me understand the algorithm and its invariant'],
  'code-help': ['Debug this code and explain why it fails', 'Analyze implementation complexity and fix an algorithm'],
  practice: ['Generate a practice game for this problem', 'Give me a fresh exercise at my chosen difficulty'],
  'career-help': ['Prepare for a software engineering interview', 'Help with my resume and career preparation'],
  unrelated: ['Tell me the weather forecast', 'Recommend a restaurant or write a poem'],
}
export const INTENT_OPTIONS = Object.fromEntries(Object.entries(INTENT_EXAMPLES).map(([key, values]) => [key, values.join('. ')]))
export function examplesFor(kind: string, options: Record<string, string>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(options).map(([key, description]) => [key,
    kind === 'route-problem' ? PROBLEM_EXAMPLES[key] ?? [description] :
      kind === 'request-intent' ? INTENT_EXAMPLES[key] ?? [description] : [key.replaceAll('-', ' '), description],
  ]))
}

export function ruleIntent(text: string): string {
  if (/resume|career|interview/i.test(text)) return 'career-help'
  if (/debug|code|complexity|implementation|```/i.test(text)) return 'code-help'
  if (/practice|exercise|game|generate/i.test(text)) return 'practice'
  if (/explain|understand|algorithm|data structure/i.test(text)) return 'explanation'
  return 'unrelated'
}
