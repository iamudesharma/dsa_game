export const LINKED_LIST_LANGUAGES = ['javascript', 'typescript', 'python', 'java', 'cpp'] as const
export type LinkedListLanguage = (typeof LINKED_LIST_LANGUAGES)[number]

export const LINKED_LIST_LANGUAGE_LABELS: Record<LinkedListLanguage, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
}

export const LINKED_LIST_QUESTIONS = [
  {
    id: 'count-nodes',
    title: 'Count the nodes',
    gameProblemId: 'linked-list-traversal',
    prompt:
      'Given the head of a singly linked list, return how many nodes it contains. Follow next pointers until you reach null; do not assume the list has an index or a stored length.',
    objective: 'Practice moving a cursor through one node at a time and stopping at null.',
    complexity: 'O(n) time · O(1) extra space',
  },
  {
    id: 'reverse-list',
    title: 'Reverse a singly linked list',
    gameProblemId: 'reverse-linked-list',
    prompt:
      'Given the head of a singly linked list, reverse its next links in place and return the new head. Keep the rest of the list reachable while you change each pointer.',
    objective: 'Practice saving the next node before rewiring the current node.',
    complexity: 'O(n) time · O(1) extra space',
  },
] as const

export type LinkedListQuestion = (typeof LINKED_LIST_QUESTIONS)[number]

export function getLinkedListQuestion(id: string | null | undefined): LinkedListQuestion | undefined {
  return LINKED_LIST_QUESTIONS.find((question) => question.id === id)
}

export function questionForGameProblem(problemId: string | null | undefined): LinkedListQuestion | undefined {
  return LINKED_LIST_QUESTIONS.find((question) => question.gameProblemId === problemId)
}

export const LINKED_LIST_PROGRESS_KEY = 'play-the-algorithms:linked-list-solved:v1'

export function readSolvedLinkedListQuestions(accountId?:string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(accountId ? `${LINKED_LIST_PROGRESS_KEY}:${accountId}` : LINKED_LIST_PROGRESS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const validIds = new Set<string>(LINKED_LIST_QUESTIONS.map((question) => question.id))
    return parsed.filter((id): id is string => typeof id === 'string' && validIds.has(id))
  } catch {
    return []
  }
}

export function markLinkedListQuestionSolved(questionId: string,accountId?:string): void {
  if (!LINKED_LIST_QUESTIONS.some((question) => question.id === questionId)) return
  const solved = new Set(readSolvedLinkedListQuestions(accountId))
  solved.add(questionId)
  try {
    window.localStorage.setItem(accountId ? `${LINKED_LIST_PROGRESS_KEY}:${accountId}` : LINKED_LIST_PROGRESS_KEY, JSON.stringify([...solved]))
    window.dispatchEvent(new Event('linked-list-progress'))
  } catch {
    // Storage can be disabled; the game still completes normally.
  }
}

export const LINKED_LIST_EXAMPLES: Record<LinkedListQuestion['id'], Record<LinkedListLanguage, string>> = {
  'count-nodes': {
    javascript: `class Node {\n  constructor(value, next = null) {\n    this.value = value\n    this.next = next\n  }\n}\n\nfunction length(head) {\n  let count = 0\n  let current = head\n  while (current !== null) {\n    count++\n    current = current.next\n  }\n  return count\n}`,
    typescript: `type Node<T> = { value: T; next: Node<T> | null }\n\nfunction length<T>(head: Node<T> | null): number {\n  let count = 0\n  let current = head\n  while (current !== null) {\n    count++\n    current = current.next\n  }\n  return count\n}`,
    python: `from __future__ import annotations\nfrom dataclasses import dataclass\n\n@dataclass\nclass Node:\n    value: int\n    next: Node | None = None\n\ndef length(head: Node | None) -> int:\n    count = 0\n    current = head\n    while current is not None:\n        count += 1\n        current = current.next\n    return count`,
    java: `class Node {\n  int value;\n  Node next;\n  Node(int value) { this.value = value; }\n}\n\nclass Solution {\n  int length(Node head) {\n    int count = 0;\n    Node current = head;\n    while (current != null) {\n      count++;\n      current = current.next;\n    }\n    return count;\n  }\n}`,
    cpp: `struct Node {\n  int value;\n  Node* next = nullptr;\n};\n\nint length(Node* head) {\n  int count = 0;\n  Node* current = head;\n  while (current != nullptr) {\n    ++count;\n    current = current->next;\n  }\n  return count;\n}`,
  },
  'reverse-list': {
    javascript: `function reverseList(head) {\n  let previous = null\n  let current = head\n  while (current !== null) {\n    const next = current.next\n    current.next = previous\n    previous = current\n    current = next\n  }\n  return previous\n}`,
    typescript: `type Node<T> = { value: T; next: Node<T> | null }\n\nfunction reverseList<T>(head: Node<T> | null): Node<T> | null {\n  let previous: Node<T> | null = null\n  let current = head\n  while (current !== null) {\n    const next = current.next\n    current.next = previous\n    previous = current\n    current = next\n  }\n  return previous\n}`,
    python: `from __future__ import annotations\nfrom dataclasses import dataclass\n\n@dataclass\nclass Node:\n    value: int\n    next: Node | None = None\n\ndef reverse_list(head: Node | None) -> Node | None:\n    previous = None\n    current = head\n    while current is not None:\n        next_node = current.next\n        current.next = previous\n        previous = current\n        current = next_node\n    return previous`,
    java: `class Node {\n  int value;\n  Node next;\n  Node(int value) { this.value = value; }\n}\n\nclass Solution {\n  Node reverseList(Node head) {\n    Node previous = null;\n    Node current = head;\n    while (current != null) {\n      Node next = current.next;\n      current.next = previous;\n      previous = current;\n      current = next;\n    }\n    return previous;\n  }\n}`,
    cpp: `struct Node {\n  int value;\n  Node* next = nullptr;\n};\n\nNode* reverseList(Node* head) {\n  Node* previous = nullptr;\n  Node* current = head;\n  while (current != nullptr) {\n    Node* next = current->next;\n    current->next = previous;\n    previous = current;\n    current = next;\n  }\n  return previous;\n}`,
  },
}

export const LINKED_LIST_STARTERS: Record<LinkedListQuestion['id'], Record<LinkedListLanguage, string>> = {
  'count-nodes': {
    javascript: `function length(head) {\n  // TODO: count each node reached from head\n}`,
    typescript: `function length<T>(head: Node<T> | null): number {\n  // TODO: count each node reached from head\n}`,
    python: `def length(head):\n    # TODO: count each node reached from head\n    pass`,
    java: `int length(Node head) {\n  // TODO: count each node reached from head\n}`,
    cpp: `int length(Node* head) {\n  // TODO: count each node reached from head\n}`,
  },
  'reverse-list': {
    javascript: `function reverseList(head) {\n  // TODO: keep previous and current pointers\n}`,
    typescript: `function reverseList<T>(head: Node<T> | null): Node<T> | null {\n  // TODO: keep previous and current pointers\n}`,
    python: `def reverse_list(head):\n    # TODO: keep previous and current pointers\n    return None`,
    java: `Node reverseList(Node head) {\n  // TODO: keep previous and current pointers\n}`,
    cpp: `Node* reverseList(Node* head) {\n  // TODO: keep previous and current pointers\n}`,
  },
}

export const LINKED_LIST_READINGS = [
  {
    title: 'Singly linked lists in JavaScript',
    source: 'trekhleb/javascript-algorithms',
    href: 'https://github.com/trekhleb/javascript-algorithms/tree/master/src/data-structures/linked-list',
    note: 'A linked-list overview with implementation notes and further reading.',
  },
  {
    title: 'Singly linked list in Python',
    source: 'TheAlgorithms/Python',
    href: 'https://github.com/TheAlgorithms/Python/blob/master/data_structures/linked_list/singly_linked_list.py',
    note: 'A worked Python implementation in an MIT-licensed algorithms collection.',
  },
] as const
