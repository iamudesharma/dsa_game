/// Dart mirror of `packages/game-schema/src/trace.ts`.
library;

import 'action.dart';
import 'enums.dart';
import 'json.dart';
import 'variables.dart';

/// Which objects/slots the algorithm is pointing at in a frame.
class TracePointers {
  const TracePointers({
    this.current,
    this.compare = const <String>[],
    this.eliminated = const <String>[],
    this.swapped = const <String>[],
    this.read = const <String>[],
  });

  factory TracePointers.from(Object? raw) {
    final map = Json.map(raw);
    List<String> ids(String key) => Json.stringList(map[key]);
    return TracePointers(
      current: Json.strOrNull(map['current']),
      compare: ids('compare'),
      eliminated: ids('eliminated'),
      swapped: ids('swapped'),
      read: ids('read'),
    );
  }

  static const TracePointers empty = TracePointers();

  final String? current;
  final List<String> compare;
  final List<String> eliminated;
  final List<String> swapped;
  final List<String> read;

  bool get isEmpty =>
      current == null &&
      compare.isEmpty &&
      eliminated.isEmpty &&
      swapped.isEmpty &&
      read.isEmpty;

  /// Every id this frame draws attention to, for the board overlay.
  Set<String> get all => <String>{
    ?current,
    ...compare,
    ...eliminated,
    ...swapped,
    ...read,
  };

  Set<String> get compared => compare.toSet();
  Set<String> get eliminatedSet => eliminated.toSet();
  Set<String> get swappedSet => swapped.toSet();
  Set<String> get readSet => read.toSet();
}

/// A trace frame records what one player action actually did to the algorithm.
class TraceFrame {
  const TraceFrame({
    required this.index,
    required this.action,
    required this.codeLine,
    required this.codeLineText,
    required this.variables,
    required this.pointers,
    required this.dsaOp,
    required this.correct,
    required this.note,
  });

  factory TraceFrame.from(Object? raw) {
    final map = Json.map(raw);
    return TraceFrame(
      index: Json.intOr(map['index']),
      action: Action.fromJson(map['action']) ?? const SelectObjectAction(objectId: ''),
      codeLine: Json.intOr(map['codeLine']),
      codeLineText: Json.str(map['codeLineText']),
      variables: Variables.from(map['variables']),
      pointers: TracePointers.from(map['pointers']),
      dsaOp: DsaOp.parse(map['dsaOp']),
      correct: Json.boolOr(map['correct'], fallback: true),
      note: Json.line(map['note'], fallback: 'step ${Json.intOr(map['index'])}'),
    );
  }

  /// Monotonic index within the game.
  final int index;

  /// The action the player performed.
  final Action action;

  /// 1-based index into the oracle's `code(lang)` output.
  final int codeLine;

  /// The literal source line at [codeLine], for cheap rendering.
  final String codeLineText;

  /// Algorithm variables after this step (lo, mid, hi, i, j, max, ...).
  final Variables variables;

  /// Which objects/slots the algorithm is pointing at right now.
  final TracePointers pointers;

  final DsaOp dsaOp;
  final bool correct;

  /// Engine-authored note (short). Narration prose comes from the spec.
  final String note;

  @override
  String toString() => 'TraceFrame($index, ${action.type.wire}, ${dsaOp.wire}, ok=$correct)';
}

class Complexity {
  const Complexity({required this.time, required this.space, this.best, this.worst, this.average, this.note});

  factory Complexity.from(Object? raw) {
    final map = Json.map(raw);
    return Complexity(
      time: Json.str(map['time'], fallback: '—'),
      space: Json.str(map['space'], fallback: '—'),
      best: Json.strOrNull(map['best']),
      worst: Json.strOrNull(map['worst']),
      average: Json.strOrNull(map['average']),
      note: Json.strOrNull(map['note']),
    );
  }

  static const Complexity unknown = Complexity(time: '—', space: '—');

  final String time;
  final String space;
  final String? best;
  final String? worst;
  final String? average;
  final String? note;

  /// Ordered chips for the debrief header. Only non-null fields appear.
  List<(String, String)> get chips => <(String, String)>[
    ('time', time),
    ('space', space),
    if (best != null) ('best', best!),
    if (worst != null) ('worst', worst!),
    if (average != null) ('avg', average!),
  ];
}
