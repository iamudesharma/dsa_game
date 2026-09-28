/// Dart mirror of `packages/game-schema/src/state.ts`.
///
/// The wire format uses `Record<string, T>` maps keyed by id. Those stay maps
/// here (ids are not contiguous and the oracle owns them), but the models add
/// the derived lookups the board needs — ordered slots, occupancy, per-kind
/// object lists — so widgets never re-implement the resolution rules.
library;

import 'action.dart';
import 'enums.dart';
import 'json.dart';
import 'trace.dart';
import 'variables.dart';

// ------------------------------------------------------------------ objects

sealed class ObjectVisual {
  const ObjectVisual();

  factory ObjectVisual.from(Object? raw) {
    final map = Json.map(raw);
    return switch (Json.str(map['kind'])) {
      'shape' => ShapeVisual(
        Json.str(map['shape'], fallback: 'circle'),
      ),
      'emoji' => EmojiVisual(Json.str(map['glyph'], fallback: '◆')),
      'text' => TextVisual(Json.str(map['text'], fallback: '•')),
      'bar' => BarVisual(Json.doubleOr(map['height'], fallback: 0.5)),
      _ => const ShapeVisual('circle'),
    };
  }

  static const ObjectVisual fallback = ShapeVisual('circle');
}

final class ShapeVisual extends ObjectVisual {
  const ShapeVisual(this.shape);

  final String shape;
}

final class EmojiVisual extends ObjectVisual {
  const EmojiVisual(this.glyph);

  final String glyph;
}

final class TextVisual extends ObjectVisual {
  const TextVisual(this.text);

  final String text;
}

final class BarVisual extends ObjectVisual {
  const BarVisual(this.height);

  /// 0..1 expected; the painter clamps anyway.
  final double height;
}

class GameObject {
  const GameObject({
    required this.id,
    required this.kind,
    required this.label,
    required this.state,
    this.value,
    this.slotId,
    this.x,
    this.y,
    this.visual,
    this.tags = Attrs.empty,
  });

  factory GameObject.from(String id, Object? raw) {
    final map = Json.map(raw);
    return GameObject(
      id: Json.str(map['id'], fallback: id),
      kind: GameObjectKind.parse(map['kind']),
      label: Json.line(map['label'], fallback: id),
      value: Json.numberOrNull(map['value']),
      slotId: Json.strOrNull(map['slotId']),
      x: Json.doubleOrNull(map['x']),
      y: Json.doubleOrNull(map['y']),
      visual: map['visual'] == null ? null : ObjectVisual.from(map['visual']),
      state: ObjectState.parse(map['state']),
      tags: Attrs.from(map['tags']),
    );
  }

  final String id;
  final GameObjectKind kind;

  /// What the player reads. Falls back to the id when the spec omits it.
  final String label;

  /// Numeric value used by comparisons. May equal [label] when numeric.
  final num? value;

  /// For ordered containers: current slot id.
  final String? slotId;

  /// Normalised 0..1 position hints for free-form boards.
  final double? x;
  final double? y;

  final ObjectVisual? visual;
  final ObjectState state;
  final Attrs tags;

  /// The number the algorithm compares, preferring [value] over the label.
  num? get comparable => value ?? num.tryParse(label.trim());

  bool get isPlaced => slotId != null && slotId!.isNotEmpty;

  /// True when the object must be drawn faint / struck through.
  bool get isEliminated => state == ObjectState.eliminated;

  GameObject copyWith({ObjectState? state, String? slotId}) => GameObject(
    id: id,
    kind: kind,
    label: label,
    value: value,
    slotId: slotId ?? this.slotId,
    x: x,
    y: y,
    visual: visual,
    state: state ?? this.state,
    tags: tags,
  );

  @override
  String toString() => 'GameObject($id, $label, ${state.wire})';
}

class Slot {
  const Slot({
    required this.id,
    required this.index,
    required this.kind,
    this.occupantId,
    this.label,
    this.state,
    this.meta = Attrs.empty,
  });

  factory Slot.from(String id, Object? raw) {
    final map = Json.map(raw);
    return Slot(
      id: Json.str(map['id'], fallback: id),
      index: Json.intOr(map['index']),
      kind: SlotKind.parse(map['kind']),
      occupantId: Json.strOrNull(map['occupantId']),
      label: Json.strOrNull(map['label']),
      state: map['state'] == null ? null : ObjectState.parse(map['state']),
      meta: Attrs.from(map['meta']),
    );
  }

  final String id;
  final int index;
  final SlotKind kind;
  final String? occupantId;
  final String? label;
  final ObjectState? state;
  final Attrs meta;

  @override
  String toString() => 'Slot($id, #$index, ${kind.wire})';
}

/// A game container (stack / queue / array / graph).
///
/// Named `GameContainer` in Dart because the contract calls it `Container` and
/// that would shadow Flutter's own `Container` widget in every widget file.
class GameContainer {
  const GameContainer({
    required this.id,
    required this.kind,
    required this.order,
    this.capacity,
    this.label,
  });

  factory GameContainer.from(String id, Object? raw) {
    final map = Json.map(raw);
    return GameContainer(
      id: Json.str(map['id'], fallback: id),
      kind: ContainerKind.parse(map['kind']),
      order: Json.stringList(map['order']),
      capacity: Json.numberOrNull(map['capacity'])?.round(),
      label: Json.strOrNull(map['label']),
    );
  }

  final String id;
  final ContainerKind kind;

  /// Ordered object ids, bottom/head first.
  final List<String> order;

  final int? capacity;
  final String? label;

  bool get isFull => capacity != null && order.length >= capacity!;

  /// A queue reads top-to-bottom like a queue; a stack reads bottom-up so the
  /// "top" element is the one the player can pop.
  List<String> get displayOrder => kind == ContainerKind.stack ? order.reversed.toList() : order;

  @override
  String toString() => 'GameContainer($id, ${kind.wire}, $order)';
}

class Link {
  const Link({required this.from, required this.to, required this.kind});

  factory Link.from(Object? raw) {
    final map = Json.map(raw);
    return Link(
      from: Json.str(map['from']),
      to: Json.str(map['to']),
      kind: LinkKind.parse(map['kind']),
    );
  }

  final String from;
  final String to;
  final LinkKind kind;

  /// The edge as a direction-agnostic pair, so a rewired list does not draw
  /// duplicate arrows when a node has both a `next` and a `prev` edge.
  Set<String> get edge => {from, to};

  @override
  String toString() => 'Link($from ${kind.wire} $to)';
}

class LinkedNodeSpec {
  const LinkedNodeSpec({required this.id, required this.value, this.nextId, this.prevId});

  factory LinkedNodeSpec.from(Object? raw) {
    final map = Json.map(raw);
    return LinkedNodeSpec(
      id: Json.str(map['id']),
      value: Json.doubleOr(map['value']),
      nextId: Json.strOrNull(map['nextId']),
      prevId: Json.strOrNull(map['prevId']),
    );
  }

  final String id;
  final double value;
  final String? nextId;
  final String? prevId;
}

class ProblemInstance {
  const ProblemInstance({
    required this.problemId,
    required this.seed,
    required this.values,
    required this.slots,
    this.target,
    this.tokens = const <String>[],
    this.list = const <LinkedNodeSpec>[],
    this.extras = Attrs.empty,
  });

  factory ProblemInstance.from(Object? raw) {
    final map = Json.map(raw);
    return ProblemInstance(
      problemId: Json.str(map['problemId']),
      seed: Json.intOr(map['seed']),
      values: Json.listOf(map['values'], Json.numberOrNull)
          .whereType<num>()
          .toList(growable: false),
      target: Json.numberOrNull(map['target']),
      tokens: Json.stringList(map['tokens']),
      list: Json.listOf(map['list'], LinkedNodeSpec.from)
          .whereType<LinkedNodeSpec>()
          .toList(growable: false),
      slots: Json.listOf(map['slots'], (raw) => Slot.from('', raw)).toList(growable: false),
      extras: Attrs.from(map['extras']),
    );
  }

  final String problemId;
  final int seed;

  /// The primary data array.
  final List<num> values;

  /// Lookup target (two-sum, binary search).
  final num? target;

  /// Preset pairs, e.g. for a parentheses sequence.
  final List<String> tokens;

  /// Linked-list payload, when the problem is a list problem.
  final List<LinkedNodeSpec> list;

  /// Initial linear layout; the oracle decides ids.
  final List<Slot> slots;

  final Attrs extras;
}

/// Which algorithm pointer a cursor field represents. Drives the badge glyph
/// and colour on the board.
enum CursorPointer {
  lo('lo', 'lo'),
  mid('mid', 'mid'),
  hi('hi', 'hi'),
  i('i', 'i'),
  j('j', 'j'),
  best('best', 'best'),
  node('node', 'node'),
  prevNode('prev', 'prev');

  const CursorPointer(this.field, this.badge);

  /// The `Cursor` field name in the TS contract.
  final String field;

  /// Short text drawn on the pointer badge.
  final String badge;

  bool get isBound => this != CursorPointer.best && this != CursorPointer.node && this != CursorPointer.prevNode;
}

class Cursor {
  const Cursor({
    this.nodeId,
    this.prevNodeId,
    this.loSlotId,
    this.midSlotId,
    this.hiSlotId,
    this.iSlotId,
    this.jSlotId,
    this.bestObjectId,
  });

  factory Cursor.from(Object? raw) {
    final map = Json.map(raw);
    return Cursor(
      nodeId: Json.strOrNull(map['nodeId']),
      prevNodeId: Json.strOrNull(map['prevNodeId']),
      loSlotId: Json.strOrNull(map['loSlotId']),
      midSlotId: Json.strOrNull(map['midSlotId']),
      hiSlotId: Json.strOrNull(map['hiSlotId']),
      iSlotId: Json.strOrNull(map['iSlotId']),
      jSlotId: Json.strOrNull(map['jSlotId']),
      bestObjectId: Json.strOrNull(map['bestObjectId']),
    );
  }

  static const Cursor empty = Cursor();

  final String? nodeId;
  final String? prevNodeId;
  final String? loSlotId;
  final String? midSlotId;
  final String? hiSlotId;
  final String? iSlotId;
  final String? jSlotId;
  final String? bestObjectId;

  bool get isEmpty =>
      nodeId == null &&
      prevNodeId == null &&
      loSlotId == null &&
      midSlotId == null &&
      hiSlotId == null &&
      iSlotId == null &&
      jSlotId == null &&
      bestObjectId == null;

  String? operator [](CursorPointer pointer) => switch (pointer) {
    CursorPointer.lo => loSlotId,
    CursorPointer.mid => midSlotId,
    CursorPointer.hi => hiSlotId,
    CursorPointer.i => iSlotId,
    CursorPointer.j => jSlotId,
    CursorPointer.best => bestObjectId,
    CursorPointer.node => nodeId,
    CursorPointer.prevNode => prevNodeId,
  };

  /// Every pointer that currently targets a slot, in visual priority order.
  ///
  /// A slot can carry several pointers (binary search has lo/mid/hi on three
  /// different slots, but bubble sort has both `i` and `j` transiently equal),
  /// so the board renders one badge per entry rather than one per slot.
  Map<CursorPointer, String> get slotPointers {
    final out = <CursorPointer, String>{};
    for (final pointer in CursorPointer.values) {
      final target = this[pointer];
      if (target != null && target.isNotEmpty) out[pointer] = target;
    }
    return out;
  }
}

class Progress {
  const Progress({
    required this.steps,
    required this.mistakes,
    required this.hintsUsed,
    required this.mistakesByMechanic,
  });

  factory Progress.from(Object? raw) {
    final map = Json.map(raw);
    final byMechanic = <String, int>{};
    Json.map(map['mistakesByMechanic']).forEach((key, value) {
      final n = Json.numberOrNull(value);
      if (n != null) byMechanic[key] = n.round();
    });
    return Progress(
      steps: Json.intOr(map['steps']),
      mistakes: Json.intOr(map['mistakes']),
      hintsUsed: Json.intOr(map['hintsUsed']),
      mistakesByMechanic: Map.unmodifiable(byMechanic),
    );
  }

  static const Progress empty = Progress(
    steps: 0,
    mistakes: 0,
    hintsUsed: 0,
    mistakesByMechanic: {},
  );

  final int steps;
  final int mistakes;
  final int hintsUsed;

  /// Keyed by `MechanicId.wire`; keyed by string so an unknown mechanic from a
  /// newer server build still renders instead of being dropped.
  final Map<String, int> mistakesByMechanic;

  int mistakesFor(MechanicId mechanic) => mistakesByMechanic[mechanic.wire] ?? 0;
}

class GameState {
  const GameState({
    required this.problemId,
    required this.seed,
    required this.instance,
    required this.objects,
    required this.slots,
    required this.containers,
    required this.links,
    required this.selection,
    required this.cursor,
    required this.variables,
    required this.progress,
    required this.phase,
    required this.trace,
    required this.internal,
  });

  factory GameState.from(Object? raw) {
    final map = Json.map(raw);
    final objects = <String, GameObject>{};
    Json.map(map['objects']).forEach((key, value) {
      objects[key] = GameObject.from(key, value);
    });
    final slots = <String, Slot>{};
    Json.map(map['slots']).forEach((key, value) {
      slots[key] = Slot.from(key, value);
    });
    final containers = <String, GameContainer>{};
    Json.map(map['containers']).forEach((key, value) {
      containers[key] = GameContainer.from(key, value);
    });
    return GameState(
      problemId: Json.str(map['problemId']),
      seed: Json.intOr(map['seed']),
      instance: ProblemInstance.from(map['instance']),
      objects: Map.unmodifiable(objects),
      slots: Map.unmodifiable(slots),
      containers: Map.unmodifiable(containers),
      links: Json.listOf(map['links'], Link.from).whereType<Link>().toList(growable: false),
      selection: Json.stringList(map['selection']),
      cursor: Cursor.from(map['cursor']),
      variables: Variables.from(map['variables']),
      progress: Progress.from(map['progress']),
      phase: GamePhase.parse(map['phase']),
      trace: Json.listOf(map['trace'], TraceFrame.from).whereType<TraceFrame>().toList(growable: false),
      internal: Attrs.from(map['internal']),
    );
  }

  final String problemId;
  final int seed;
  final ProblemInstance instance;
  final Map<String, GameObject> objects;
  final Map<String, Slot> slots;
  final Map<String, GameContainer> containers;
  final List<Link> links;

  /// Currently selected object ids (1 for most mechanics, 2 for compare/swap).
  final List<String> selection;

  final Cursor cursor;
  final Variables variables;
  final Progress progress;
  final GamePhase phase;

  /// Appended by the engine on every validated action.
  final List<TraceFrame> trace;

  /// Oracle-owned opaque bookkeeping. The client never interprets it.
  final Attrs internal;

  GameObject? object(String? id) => id == null ? null : objects[id];

  Slot? slot(String? id) => id == null ? null : slots[id];

  GameContainer? container(String? id) => id == null ? null : containers[id];

  bool get isPlaying => phase == GamePhase.playing;

  /// Slots in index order. The oracle assigns `index`; ties break on id so the
  /// board never reshuffles between frames.
  List<Slot> get orderedSlots {
    final list = slots.values.toList();
    list.sort((a, b) {
      final byIndex = a.index.compareTo(b.index);
      return byIndex != 0 ? byIndex : a.id.compareTo(b.id);
    });
    return list;
  }

  List<GameObject> get orderedObjects {
    final list = objects.values.toList();
    list.sort((a, b) => a.id.compareTo(b.id));
    return list;
  }

  List<GameObject> objectsOfKind(GameObjectKind kind) =>
      orderedObjects.where((o) => o.kind == kind).toList(growable: false);

  /// Objects that are not on any slot: the free pool the player drags from.
  List<GameObject> get poolObjects =>
      orderedObjects.where((o) => !o.isPlaced).toList(growable: false);

  /// The object sitting in [slotId], if any.
  ///
  /// Occupancy can be expressed two ways in the contract: `Slot.occupantId` or
  /// the object's own `slotId`. Oracles use both, so occupancy is resolved from
  /// either direction and `occupantId` wins when the two disagree.
  GameObject? occupantOf(String slotId) {
    final direct = slot(slotId)?.occupantId;
    if (direct != null && objects.containsKey(direct)) return objects[direct];
    for (final object in objects.values) {
      if (object.slotId == slotId) return object;
    }
    return null;
  }

  /// Slot ids currently occupied, so a drop target can refuse illegal moves.
  Set<String> get occupiedSlotIds {
    final ids = <String>{};
    slots.forEach((id, slot) {
      if ((slot.occupantId ?? '') != '' || occupantOf(id) != null) ids.add(id);
    });
    return ids;
  }

  /// True when [objectId] is currently selected — drives the "selected" look.
  bool isSelected(String objectId) => selection.contains(objectId);

  /// Links grouped by node id, for the linked-list painter.
  Map<String, List<Link>> get linksByNode {
    final out = <String, List<Link>>{};
    for (final link in links) {
      out.putIfAbsent(link.from, () => <Link>[]).add(link);
    }
    return out;
  }

  /// A copy with a different object map.
  ///
  /// The debrief replay uses this to project a `TraceFrame`'s pointers onto a
  /// board snapshot: `pointers.eliminated` and `pointers.current` describe how
  /// to *draw* the board at that step, so the engine's real state is untouched.
  GameState withObjects(Map<String, GameObject> objects) => GameState(
    problemId: problemId,
    seed: seed,
    instance: instance,
    objects: Map.unmodifiable(objects),
    slots: slots,
    containers: containers,
    links: links,
    selection: selection,
    cursor: cursor,
    variables: variables,
    progress: progress,
    phase: phase,
    trace: trace,
    internal: internal,
  );

  /// A copy with a different [variables] bag, so the replay can show a frame's
  /// variable snapshot on the algorithm strip.
  GameState withVariables(Variables next) => GameState(
    problemId: problemId,
    seed: seed,
    instance: instance,
    objects: objects,
    slots: slots,
    containers: containers,
    links: links,
    selection: selection,
    cursor: cursor,
    variables: next,
    progress: progress,
    phase: phase,
    trace: trace,
    internal: internal,
  );

  @override
  String toString() => 'GameState($problemId, seed=$seed, ${phase.wire}, '
      '${objects.length} objects, ${trace.length} frames)';
}
