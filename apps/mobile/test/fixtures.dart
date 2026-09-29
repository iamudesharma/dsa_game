/// Contract fixtures: hand-written payloads shaped exactly like
/// `packages/game-schema/src/api-types.ts`.
///
/// These exist so the models and the widget tree can be exercised without the
/// server being up. They are deliberately *not* minimal — a thin fixture would
/// not catch a model that silently drops a field the real API always sends.
library;

Map<String, Object?> get catalogueJson => {
  'topics': [
    {
      'id': 'binary-search',
      'label': 'Binary Search',
      'problems': [
        {
          'id': 'binary-search',
          'topic': 'binary-search',
          'title': 'Find the target in a sorted array',
          'learningObjective': 'Binary search halves the search space on every comparison.',
          'canonicalAlgorithm': 'Set lo=0, hi=n-1. Compute mid, compare, discard one half.',
          'allowedMechanics': ['selectObject', 'comparePair', 'choosePath', 'assignValue', 'submitAnswer'],
          'instanceHints': {
            'minLength': 8,
            'maxLength': 16,
            'unique': true,
            'sorted': true,
            'targetGuaranteed': true,
            'valueRange': [1, 99],
          },
          'complexity': {'time': 'O(log n)', 'space': 'O(1)'},
          'defaultDifficulty': 'easy',
        },
      ],
    },
    {
      'id': 'linked-list',
      'label': 'Linked List',
      'problems': [
        {
          'id': 'reverse-linked-list',
          'topic': 'linked-list',
          'title': 'Reverse a linked list',
          'learningObjective': 'Swapping prev and next while advancing rewires the list in one pass.',
          'canonicalAlgorithm': 'prev = null, current = head. While current: next = current.next; ...',
          'allowedMechanics': ['traverseNode', 'connectNodes', 'selectObject', 'submitAnswer'],
          'instanceHints': {
            'minLength': 4,
            'maxLength': 6,
            'unique': true,
            'valueRange': [1, 99],
          },
          'complexity': {'time': 'O(n)', 'space': 'O(1)'},
          'defaultDifficulty': 'hard',
        },
      ],
    },
  ],
  'tiers': [
    {'tier': 'opencode', 'available': true},
    {'tier': 'template', 'available': true},
  ],
  'laya': {'enabled': true, 'available': false},
};

Map<String, Object?> get healthJson => {
  'ok': true,
  'version': '0.1.0',
  'tiers': [
    {'tier': 'opencode', 'available': true, 'detail': 'gateway up'},
    {'tier': 'template', 'available': true},
  ],
  'laya': {'enabled': true, 'available': false, 'detail': 'sidecar down'},
  'uptimeSec': 42.5,
};

/// A spec with all four possible areas populated, in the "detective" genre.
Map<String, Object?> get specJson => {
  'specVersion': 1,
  'problemId': 'binary-search',
  'seed': 4242,
  'language': 'en',
  'objective': 'Halve the search space every time you compare.',
  'theme': {
    'title': 'The Ledger Room',
    'story': 'The vault you need is one shelf in a very long ledger.',
    'genre': 'detective',
    'tone': 'mysterious',
  },
  'visual': {
    'palette': {
      'background': '#0B1020',
      'primary': '#7AA2F7',
      'accent': '#E0AF68',
      'success': '#9ECE6A',
      'danger': '#F7768E',
    },
    // One entry per GameObjectKind, indexed by ordinal: opencode-go rejects
    // JSON-Schema maps, so the contract ships an ordered palette and the client
    // only uses it when it covers every kind. index 1 is `number`.
    'objectGlyphs': ['◆', '❖', '⬤', '◈', '▣', '⬢', '▢', '➤', '✦'],
    'boardLabel': 'the ledger',
  },
  'vocabulary': {
    'object': 'entry',
    'objectPlural': 'entries',
    'place': 'the ledger',
    'actionVerb': 'search',
    'target': 'the vault',
    'lowerWord': 'nearer',
    'equalWord': 'found',
    'higherWord': 'further',
  },
  'mechanics': [
    {
      'id': 'comparePair',
      'boundDsaOp': 'compare',
      'label': 'read two entries against each other',
      'hint': 'Compare the middle entry with what you are looking for.',
    },
    {'id': 'choosePath', 'boundDsaOp': 'choose-path', 'label': 'choose which half to keep'},
    {
      'id': 'submitAnswer',
      'boundDsaOp': 'terminate',
      'label': 'name the vault',
    },
  ],
  'narration': {
    'intro': 'The ledger runs off the page. Only comparisons will get you there.',
    'hintPool': ['Start from the middle.', 'Each wrong half costs you nothing but time.'],
    'win': 'You open the vault in fewer comparisons than you expected.',
    'lose': 'The ledger wins. Walk it again, and watch the window shrink.',
    'correctFlavour': ['The window halves.', 'A clean comparison.'],
  },
  'debrief': {
    'summary': 'You walked the ledger by halving it every time.',
    'actionMeaning': {
      'comparePair': 'Comparing the middle against the target is what decides which half survives.',
      'choosePath': 'Discarding a half is the entire point: the work you throw away is never revisited.',
      'submitAnswer': 'Committing the answer ends the search loop for good.',
    },
    'mapping': [
      ['entry', 'a[mid]'],
      ['the window', '[lo, hi]'],
      ['the vault', 'target'],
    ],
    'codeLanguages': ['javascript', 'python'],
  },
  'generatedBy': 'opencode',
};

Map<String, Object?> _object(String id, String label, String state, {String? slotId, num? value}) =>
    {
      'id': id,
      'kind': 'number',
      'label': label,
      'value': ?value,
      'slotId': ?slotId,
      'state': state,
      'tags': <String, Object?>{'partOf': 'left-half'},
    };

/// A sorted 8-slot instance with lo/mid/hi already set.
Map<String, Object?> get generateJson => {
  'gameId': 'binary-search-abc123',
  'problemId': 'binary-search',
  'seed': 4242,
  'spec': specJson,
  'state': {
    'problemId': 'binary-search',
    'seed': 4242,
    'instance': {
      'problemId': 'binary-search',
      'seed': 4242,
      'values': [4, 9, 14, 22, 31, 40, 55, 71],
      'target': 55,
      'slots': [
        for (var i = 0; i < 8; i++) {'id': 's$i', 'index': i, 'kind': 'default'},
      ],
    },
    'objects': {
      for (var i = 0; i < 8; i++)
        'o$i': _object('o$i', '${[4, 9, 14, 22, 31, 40, 55, 71][i]}', 'idle', slotId: 's$i', value: [4, 9, 14, 22, 31, 40, 55, 71][i]),
      't1': {'id': 't1', 'kind': 'target', 'label': '55', 'state': 'idle', 'visual': {'kind': 'shape', 'shape': 'star'}},
    },
    'slots': {
      for (var i = 0; i < 8; i++) 's$i': {'id': 's$i', 'index': i, 'kind': 'default', 'occupantId': 'o$i'},
    },
    'containers': <String, Object?>{},
    'links': <Object?>[],
    'selection': <String>[],
    'cursor': {'loSlotId': 's0', 'midSlotId': 's4', 'hiSlotId': 's7'},
    'variables': {'lo': 0, 'mid': 4, 'hi': 7, 'target': 55, 'pass': 0},
    'progress': {'steps': 0, 'mistakes': 0, 'hintsUsed': 0, 'mistakesByMechanic': <String, Object?>{}},
    'phase': 'playing',
    'trace': <Object?>[],
    'internal': {'passes': 0},
  },
  'usedTier': 'opencode',
  'attempts': [
    {'tier': 'opencode', 'ok': true, 'ms': 4120},
    {'tier': 'openrouter', 'ok': false, 'ms': 900, 'error': 'no api key'},
  ],
  'notes': <String>['spec repaired on attempt 2'],
};

/// The two frames the player actually produced. Shared by [finishActionJson]
/// and [debriefJson] so the two payloads cannot disagree.
List<Object?> get playedTraceJson => [
  {
    'index': 0,
    'action': {'type': 'comparePair', 'aId': 'o4', 'bId': 'o6', 'relation': 'gt', 'actionId': 'a1'},
    'codeLine': 3,
    'codeLineText': '  if (a[mid] < target) lo = mid + 1',
    'variables': {'lo': 5, 'mid': 6, 'hi': 7, 'target': 55},
    'pointers': {
      'current': 'o6',
      'compare': ['o4', 'o6'],
      'eliminated': ['o0', 'o1', 'o2', 'o3'],
    },
    'dsaOp': 'compare',
    'correct': false,
    'note': '31 is below 55, so the window moves right',
  },
  {
    'index': 1,
    'action': {'type': 'submitAnswer', 'targetId': 't1', 'value': '6'},
    'codeLine': 7,
    'codeLineText': '  return mid',
    'variables': {'lo': 6, 'mid': 6, 'hi': 6, 'target': 55},
    'pointers': {'current': 'o6'},
    'dsaOp': 'terminate',
    'correct': true,
    'note': 'the window collapsed onto 55',
  },
];

/// A wrong `comparePair`: legal, applied, and with `expected` filled in.
Map<String, Object?> get wrongActionJson => {
  'gameId': 'binary-search-abc123',
  'state': {
    ...(generateJson['state']! as Map<String, Object?>),
    'selection': ['o4', 'o6'],
    'cursor': {'loSlotId': 's5', 'midSlotId': 's6', 'hiSlotId': 's7'},
    'variables': {'lo': 5, 'mid': 6, 'hi': 7, 'target': 55, 'pass': 1},
    'progress': {'steps': 1, 'mistakes': 1, 'hintsUsed': 0, 'mistakesByMechanic': {'comparePair': 1}},
    'trace': [playedTraceJson[0]],
  },
  'outcome': {
    'correct': false,
    'expected': {'type': 'comparePair', 'aId': 'o4', 'bId': 'o6', 'relation': 'lt'},
    'feedback': '31 sits below 55, so this entry is the nearer one.',
    'dsaOp': 'compare',
    'traceStep': 0,
  },
  'usedTier': 'opencode',
};

Map<String, Object?> get finishActionJson => {
  'gameId': 'binary-search-abc123',
  'state': {
    ...(generateJson['state']! as Map<String, Object?>),
    'phase': 'won',
    'progress': {'steps': 4, 'mistakes': 1, 'hintsUsed': 1, 'mistakesByMechanic': {'comparePair': 1}},
    'trace': playedTraceJson,
  },
  'outcome': {
    'correct': true,
    'feedback': 'The vault opens.',
    'dsaOp': 'terminate',
    'traceStep': 1,
    'won': true,
  },
  'usedTier': 'opencode',
  'debrief': debriefJson,
};

/// A server-side undo: the board the player had before their last action, with
/// the trace rewound to match. `undone: true` is what tells the client the
/// stack actually had something to pop.
Map<String, Object?> get undoActionJson => {
  'gameId': 'binary-search-abc123',
  'undone': true,
  'state': {
    ...(generateJson['state']! as Map<String, Object?>),
    'selection': const <String>[],
    'cursor': {'loSlotId': 's0', 'midSlotId': 's6', 'hiSlotId': 's7'},
    'variables': {'lo': 0, 'mid': 6, 'hi': 7, 'target': 55, 'pass': 1},
    // The undone action must be gone from the trace, not merely hidden.
    'progress': {'steps': 0, 'mistakes': 1, 'hintsUsed': 0, 'mistakesByMechanic': {'comparePair': 1}},
    'trace': const <Object?>[],
  },
};

/// The server had nothing to undo.
Map<String, Object?> get undoNoopJson => {
  'gameId': 'binary-search-abc123',
  'undone': false,
  'state': generateJson['state'],
};

Map<String, Object?> get debriefJson => {
  'problemId': 'binary-search',
  'phase': 'won',
  'playedTrace': playedTraceJson,
  'canonicalTrace': [
    {
      'index': 0,
      'action': {'type': 'comparePair', 'aId': 'o4', 'bId': 't1', 'relation': 'lt'},
      'codeLine': 3,
      'codeLineText': '  if (a[mid] < target) lo = mid + 1',
      'variables': {'lo': 0, 'mid': 4, 'hi': 7, 'target': 55},
      'pointers': {'current': 'o4', 'compare': ['o4', 't1']},
      'dsaOp': 'compare',
      'correct': true,
      'note': '31 < 55, keep the right half',
    },
    {
      'index': 1,
      'action': {'type': 'choosePath', 'fromId': 'o4', 'pathId': 'o6'},
      'codeLine': 3,
      'codeLineText': '  if (a[mid] < target) lo = mid + 1',
      'variables': {'lo': 5, 'mid': 6, 'hi': 7, 'target': 55},
      'pointers': {'current': 'o6'},
      'dsaOp': 'choose-path',
      'correct': true,
      'note': 'lo = mid + 1',
    },
  ],
  'answer': {
    'text': 'index 6',
    'value': 6,
    'details': [
      {'label': 'comparisons', 'value': '3'},
      {'label': 'window at the end', 'value': '[6, 6]'},
    ],
  },
  'pseudocode': [
    'function search(a, target):',
    '  lo = 0; hi = len(a) - 1',
    '  while lo <= hi:',
    '    mid = (lo + hi) / 2',
    '    if a[mid] == target: return mid',
    '    if a[mid] < target: lo = mid + 1',
    '    else: hi = mid - 1',
    '  return -1',
  ],
  'code': {
    'javascript': [
      'function search(a, target) {',
      '  let lo = 0, hi = a.length - 1;',
      '  while (lo <= hi) {',
      '    const mid = (lo + hi) >> 1;',
      '    if (a[mid] === target) return mid;',
      '    if (a[mid] < target) lo = mid + 1;',
      '    else hi = mid - 1;',
      '  }',
      '  return -1;',
      '}',
    ],
    'python': [
      'def search(a, target):',
      '    lo, hi = 0, len(a) - 1',
      '    while lo <= hi:',
      '        mid = (lo + hi) // 2',
      '        if a[mid] == target:',
      '            return mid',
      '        if a[mid] < target:',
      '            lo = mid + 1',
      '        else:',
      '            hi = mid - 1',
      '    return -1',
    ],
  },
  'complexity': {
    'time': 'O(log n)',
    'space': 'O(1)',
    'note': 'Every comparison throws away half the ledger, so the work per step is constant.',
  },
  'summary': 'You halved the ledger five times and stopped on 55.',
  'actionMeaning': {
    'comparePair': 'The comparison is the only thing that decides which half survives.',
    'submitAnswer': 'Committing ends the loop; the window had already collapsed to one entry.',
  },
  'mapping': [
    {'gameTerm': 'entry', 'algorithmTerm': 'a[mid]'},
    {'gameTerm': 'the window', 'algorithmTerm': '[lo, hi]'},
    {'gameTerm': 'the vault', 'algorithmTerm': 'target'},
  ],
  'stats': {
    'steps': 4,
    'mistakes': 1,
    'hintsUsed': 1,
    'mistakesByMechanic': {'comparePair': 1, 'submitAnswer': 0},
    'misconception': 'You treated the comparison as "which entry is bigger" instead of "which half survives".',
    'confidence': 0.82,
  },
  'hintPool': ['Start from the middle.'],
};

Map<String, Object?> get hintJson => {
  'hint': 'The middle entry decides which half you keep.',
  'source': 'heuristic',
};

Map<String, Object?> get decideJson => {
  'kind': 'difficulty',
  'choice': 'medium',
  'confidence': 0.74,
  'source': 'laya',
  'distribution': {'easy': 0.1, 'medium': 0.74, 'hard': 0.16},
};
