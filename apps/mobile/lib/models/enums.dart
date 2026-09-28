/// Dart mirrors of the closed string unions in
/// `packages/game-schema/src/{mechanics,problems,state}.ts`.
///
/// Every union gets a `wire` field (the exact string the API speaks) and a
/// `parse` that falls back rather than throwing, because the payloads can
/// originate from a weaker LLM tier.
library;

import 'package:flutter/material.dart';

// ------------------------------------------------------------------ mechanics

enum MechanicId {
  selectObject('selectObject'),
  moveObject('moveObject'),
  comparePair('comparePair'),
  swapPair('swapPair'),
  pushPop('pushPop'),
  choosePath('choosePath'),
  traverseNode('traverseNode'),
  connectNodes('connectNodes'),
  assignValue('assignValue'),
  submitAnswer('submitAnswer');

  const MechanicId(this.wire);

  final String wire;

  static final Map<String, MechanicId> _byWire = {
    for (final v in values) v.wire: v,
  };

  static MechanicId parse(Object? raw, {MechanicId fallback = MechanicId.selectObject}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum DsaOp {
  compare('compare'),
  traverse('traverse'),
  move('move'),
  insert('insert'),
  swap('swap'),
  push('push'),
  pop('pop'),
  choosePath('choose-path'),
  read('read'),
  assign('assign'),
  terminate('terminate'),
  link('link'),
  unlink('unlink');

  const DsaOp(this.wire);

  final String wire;

  /// Short glyph for the trace rail / strip chips.
  String get glyph => switch (this) {
    DsaOp.compare => '⚖',
    DsaOp.traverse => '⇥',
    DsaOp.move => '↷',
    DsaOp.insert => '⊕',
    DsaOp.swap => '⇄',
    DsaOp.push => '↑',
    DsaOp.pop => '↓',
    DsaOp.choosePath => '⑂',
    DsaOp.read => '◉',
    DsaOp.assign => '=',
    DsaOp.terminate => '■',
    DsaOp.link => '→',
    DsaOp.unlink => '×',
  };

  static final Map<String, DsaOp> _byWire = {for (final v in values) v.wire: v};

  static DsaOp parse(Object? raw, {DsaOp fallback = DsaOp.read}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum GameObjectKind {
  item('item'),
  number('number'),
  node('node'),
  token('token'),
  door('door'),
  room('room'),
  slot('slot'),
  path('path'),
  target('target');

  const GameObjectKind(this.wire);

  final String wire;

  /// Fallback glyph when the spec does not supply `objectGlyphs[wire]`.
  String get defaultGlyph => switch (this) {
    GameObjectKind.item => '◆',
    GameObjectKind.number => '#',
    GameObjectKind.node => '⬤',
    GameObjectKind.token => '❖',
    GameObjectKind.door => '⌸',
    GameObjectKind.room => '▣',
    GameObjectKind.slot => '▢',
    GameObjectKind.path => '➤',
    GameObjectKind.target => '✦',
  };

  static final Map<String, GameObjectKind> _byWire = {
    for (final v in values) v.wire: v,
  };

  static GameObjectKind parse(Object? raw, {GameObjectKind fallback = GameObjectKind.item}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum ContainerKind {
  stack('stack'),
  queue('queue'),
  array('array'),
  graph('graph');

  const ContainerKind(this.wire);

  final String wire;

  static final Map<String, ContainerKind> _byWire = {
    for (final v in values) v.wire: v,
  };

  static ContainerKind parse(Object? raw, {ContainerKind fallback = ContainerKind.stack}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

// --------------------------------------------------------------------- state

enum ObjectState {
  idle('idle'),
  selected('selected'),
  eliminated('eliminated'),
  matched('matched'),
  swapped('swapped'),
  locked('locked'),
  current('current'),
  visited('visited'),
  revealed('revealed');

  const ObjectState(this.wire);

  final String wire;

  static final Map<String, ObjectState> _byWire = {
    for (final v in values) v.wire: v,
  };

  static ObjectState parse(Object? raw, {ObjectState fallback = ObjectState.idle}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum SlotKind {
  plain('default'),
  target('target'),
  left('left'),
  right('right'),
  mid('mid'),
  sink('sink'),
  source('source');

  const SlotKind(this.wire);

  final String wire;

  static final Map<String, SlotKind> _byWire = {for (final v in values) v.wire: v};

  static SlotKind parse(Object? raw, {SlotKind fallback = SlotKind.plain}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum GamePhase {
  playing('playing'),
  won('won'),
  lost('lost');

  const GamePhase(this.wire);

  final String wire;

  bool get isTerminal => this != GamePhase.playing;

  static final Map<String, GamePhase> _byWire = {for (final v in values) v.wire: v};

  static GamePhase parse(Object? raw, {GamePhase fallback = GamePhase.playing}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

// ------------------------------------------------------------------ problems

enum DsaTopic {
  arrays('arrays'),
  sorting('sorting'),
  stack('stack'),
  queue('queue'),
  binarySearch('binary-search'),
  linkedList('linked-list');

  const DsaTopic(this.wire);

  final String wire;

  /// Mirrors `TOPIC_LABELS` in problems.ts.
  String get label => switch (this) {
    DsaTopic.arrays => 'Arrays',
    DsaTopic.sorting => 'Sorting',
    DsaTopic.stack => 'Stack',
    DsaTopic.queue => 'Queue',
    DsaTopic.binarySearch => 'Binary Search',
    DsaTopic.linkedList => 'Linked List',
  };

  String get blurb => switch (this) {
    DsaTopic.arrays => 'Scan, look up, relocate in one pass.',
    DsaTopic.sorting => 'Order the data by comparing and swapping.',
    DsaTopic.stack => 'Last in, first out. Mismatches live at the top.',
    DsaTopic.queue => 'First in, first out. Enqueue behind, dequeue in front.',
    DsaTopic.binarySearch => 'Halve the space on every comparison.',
    DsaTopic.linkedList => 'No indexing — follow pointers one node at a time.',
  };

  /// `Icons` lives in the Flutter SDK; the model layer is allowed to depend on
  /// Flutter (this is a client, not a shared package) so the mapping stays
  /// exhaustive and type-checked instead of a stringly-typed lookup.
  IconData get icon => switch (this) {
    DsaTopic.arrays => Icons.view_column,
    DsaTopic.sorting => Icons.sort,
    DsaTopic.stack => Icons.vertical_align_bottom,
    DsaTopic.queue => Icons.format_list_numbered,
    DsaTopic.binarySearch => Icons.zoom_in,
    DsaTopic.linkedList => Icons.linear_scale,
  };

  static final Map<String, DsaTopic> _byWire = {for (final v in values) v.wire: v};

  static DsaTopic? tryParse(Object? raw) => raw is String ? _byWire[raw] : null;
}
