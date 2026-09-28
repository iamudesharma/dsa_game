/// Dart mirror of the `Action` union in
/// `packages/game-schema/src/action.ts`.
///
/// The union is modelled as a `sealed class` so `switch` expressions over an
/// action are exhaustive and a new action type is a compile error rather than a
/// silently-wrong `else` branch. Every variant also exposes [toJson] so the
/// wire shape is byte-identical to the TypeScript source.
library;

import 'json.dart';

enum Relation {
  lt('lt'),
  eq('eq'),
  gt('gt');

  const Relation(this.wire);

  final String wire;

  /// Pairs 1:1 with `Vocabulary.lowerWord / equalWord / higherWord`, which is
  /// why they are positional: [word] takes the themed triple in that order.
  String word(String lower, String equal, String higher) => switch (this) {
    Relation.lt => lower,
    Relation.eq => equal,
    Relation.gt => higher,
  };

  static final Map<String, Relation> _byWire = {for (final v in values) v.wire: v};

  static Relation parse(Object? raw, {Relation fallback = Relation.eq}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum StackOp {
  push('push'),
  pop('pop');

  const StackOp(this.wire);

  final String wire;

  static final Map<String, StackOp> _byWire = {for (final v in values) v.wire: v};

  static StackOp parse(Object? raw, {StackOp fallback = StackOp.push}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum LinkKind {
  next('next'),
  prev('prev');

  const LinkKind(this.wire);

  final String wire;

  String get arrow => this == LinkKind.next ? '→' : '←';

  static final Map<String, LinkKind> _byWire = {for (final v in values) v.wire: v};

  static LinkKind parse(Object? raw, {LinkKind fallback = LinkKind.next}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum ActionType {
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

  const ActionType(this.wire);

  final String wire;

  /// Mirrors `ACTION_TO_DSA_OP`.
  String get defaultDsaOp => switch (this) {
    ActionType.selectObject => 'read',
    ActionType.moveObject => 'move',
    ActionType.comparePair => 'compare',
    ActionType.swapPair => 'swap',
    ActionType.pushPop => 'push',
    ActionType.choosePath => 'choose-path',
    ActionType.traverseNode => 'traverse',
    ActionType.connectNodes => 'link',
    ActionType.assignValue => 'assign',
    ActionType.submitAnswer => 'terminate',
  };

  static final Map<String, ActionType> _byWire = {
    for (final v in values) v.wire: v,
  };

  static ActionType? tryParse(Object? raw) => raw is String ? _byWire[raw] : null;
}

/// Base of the action union. Subclasses are the only legal actions.
sealed class Action {
  const Action();

  ActionType get type;

  /// The wire representation. Keys are inserted in the same order as the TS
  /// source for easy diffing against the server logs.
  Map<String, Object?> toJson();

  /// Optional client-generated id for idempotent replays. The server accepts it
  /// but does not require it, so the client only sends it when present.
  String? get actionId => null;

  Map<String, Object?> baseJson() {
    final id = actionId;
    return id == null ? <String, Object?>{} : <String, Object?>{'actionId': id};
  }

  /// Every object id this action references, for board highlighting.
  Set<String> get objectIds => const <String>{};

  /// Parses an action from JSON, returning `null` when `type` is unknown.
  /// The engine validates independently, so an unrecognised action is a
  /// protocol error we surface as a malformed-response error, not a crash.
  static Action? fromJson(Object? raw) {
    final map = Json.map(raw);
    final type = ActionType.tryParse(map['type']);
    if (type == null) return null;
    final id = Json.strOrNull(map['actionId']);
    return switch (type) {
      ActionType.selectObject => SelectObjectAction(
        objectId: Json.str(map['objectId']),
        actionId: id,
      ),
      ActionType.moveObject => MoveObjectAction(
        objectId: Json.str(map['objectId']),
        toSlotId: Json.str(map['toSlotId']),
        actionId: id,
      ),
      ActionType.comparePair => ComparePairAction(
        aId: Json.str(map['aId']),
        bId: Json.str(map['bId']),
        relation: Relation.parse(map['relation']),
        actionId: id,
      ),
      ActionType.swapPair => SwapPairAction(
        aId: Json.str(map['aId']),
        bId: Json.str(map['bId']),
        actionId: id,
      ),
      ActionType.pushPop => PushPopAction(
        containerId: Json.str(map['containerId']),
        op: StackOp.parse(map['op']),
        objectId: Json.strOrNull(map['objectId']),
        actionId: id,
      ),
      ActionType.choosePath => ChoosePathAction(
        fromId: Json.str(map['fromId']),
        pathId: Json.str(map['pathId']),
        actionId: id,
      ),
      ActionType.traverseNode => TraverseNodeAction(
        fromNodeId: Json.str(map['fromNodeId']),
        toNodeId: Json.str(map['toNodeId']),
        actionId: id,
      ),
      ActionType.connectNodes => ConnectNodesAction(
        fromNodeId: Json.str(map['fromNodeId']),
        toNodeId: Json.str(map['toNodeId']),
        linkKind: LinkKind.parse(map['linkKind']),
        actionId: id,
      ),
      ActionType.assignValue => AssignValueAction(
        targetId: Json.str(map['targetId']),
        value: Json.str(map['value']),
        actionId: id,
      ),
      ActionType.submitAnswer => SubmitAnswerAction(
        targetId: Json.str(map['targetId']),
        value: Json.str(map['value']),
        actionId: id,
      ),
    };
  }
}

final class SelectObjectAction extends Action {
  const SelectObjectAction({required this.objectId, this.actionId});

  final String objectId;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.selectObject;

  @override
  Set<String> get objectIds => {objectId};

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'objectId': objectId,
  };

  @override
  String toString() => 'selectObject($objectId)';
}

final class MoveObjectAction extends Action {
  const MoveObjectAction({required this.objectId, required this.toSlotId, this.actionId});

  final String objectId;
  final String toSlotId;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.moveObject;

  @override
  Set<String> get objectIds => {objectId};

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'objectId': objectId,
    'toSlotId': toSlotId,
  };

  @override
  String toString() => 'moveObject($objectId -> $toSlotId)';
}

final class ComparePairAction extends Action {
  const ComparePairAction({required this.aId, required this.bId, required this.relation, this.actionId});

  final String aId;
  final String bId;
  final Relation relation;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.comparePair;

  @override
  Set<String> get objectIds => {aId, bId};

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'aId': aId,
    'bId': bId,
    'relation': relation.wire,
  };

  @override
  String toString() => 'comparePair($aId ${relation.wire} $bId)';
}

final class SwapPairAction extends Action {
  const SwapPairAction({required this.aId, required this.bId, this.actionId});

  final String aId;
  final String bId;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.swapPair;

  @override
  Set<String> get objectIds => {aId, bId};

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'aId': aId,
    'bId': bId,
  };

  @override
  String toString() => 'swapPair($aId <-> $bId)';
}

final class PushPopAction extends Action {
  const PushPopAction({required this.containerId, required this.op, this.objectId, this.actionId});

  final String containerId;
  final StackOp op;

  /// Required for push, absent for pop.
  final String? objectId;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.pushPop;

  @override
  Set<String> get objectIds {
    final id = objectId;
    return id == null ? const <String>{} : {id};
  }

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'containerId': containerId,
    'op': op.wire,
    if (objectId != null) 'objectId': objectId,
  };

  @override
  String toString() => 'pushPop(${op.wire} $containerId${objectId == null ? '' : ' $objectId'})';
}

final class ChoosePathAction extends Action {
  const ChoosePathAction({required this.fromId, required this.pathId, this.actionId});

  final String fromId;
  final String pathId;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.choosePath;

  @override
  Set<String> get objectIds => {fromId, pathId};

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'fromId': fromId,
    'pathId': pathId,
  };

  @override
  String toString() => 'choosePath($fromId -> $pathId)';
}

final class TraverseNodeAction extends Action {
  const TraverseNodeAction({required this.fromNodeId, required this.toNodeId, this.actionId});

  final String fromNodeId;
  final String toNodeId;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.traverseNode;

  @override
  Set<String> get objectIds => {fromNodeId, toNodeId};

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'fromNodeId': fromNodeId,
    'toNodeId': toNodeId,
  };

  @override
  String toString() => 'traverseNode($fromNodeId -> $toNodeId)';
}

final class ConnectNodesAction extends Action {
  const ConnectNodesAction({
    required this.fromNodeId,
    required this.toNodeId,
    required this.linkKind,
    this.actionId,
  });

  final String fromNodeId;
  final String toNodeId;
  final LinkKind linkKind;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.connectNodes;

  @override
  Set<String> get objectIds => {fromNodeId, toNodeId};

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'fromNodeId': fromNodeId,
    'toNodeId': toNodeId,
    'linkKind': linkKind.wire,
  };

  @override
  String toString() => 'connectNodes($fromNodeId ${linkKind.wire} $toNodeId)';
}

final class AssignValueAction extends Action {
  const AssignValueAction({required this.targetId, required this.value, this.actionId});

  final String targetId;

  /// Free text: the oracle parses it (a number, a node id, a variable name).
  final String value;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.assignValue;

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'targetId': targetId,
    'value': value,
  };

  @override
  String toString() => 'assignValue($targetId = $value)';
}

final class SubmitAnswerAction extends Action {
  const SubmitAnswerAction({required this.targetId, required this.value, this.actionId});

  final String targetId;

  /// Free text: the oracle parses the committed answer.
  final String value;

  @override
  final String? actionId;

  @override
  ActionType get type => ActionType.submitAnswer;

  @override
  Map<String, Object?> toJson() => {
    ...baseJson(),
    'type': type.wire,
    'targetId': targetId,
    'value': value,
  };

  @override
  String toString() => 'submitAnswer($targetId = $value)';
}
