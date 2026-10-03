import 'json.dart';
import 'enums.dart';

/// Oracle-provided instruction, never inferred from tutor prose.
class TurnPrompt {
  TurnPrompt.from(Object? raw) : data = Json.map(raw);
  final Map<String, Object?> data;
  String get instruction => Json.str(data['instruction']);
  List<String> get assignmentTargetIds =>
      Json.list(data['assignmentTargetIds']).whereType<String>().toList();
  String? get answerTargetId => data['answerTargetId'] is String
      ? data['answerTargetId'] as String
      : null;
  String get reason => Json.str(data['reason']);
  MechanicId get mechanic => MechanicId.parse(data['mechanic']);
  Set<String> get objectIds => Json.list(data['targets'])
      .map(Json.map)
      .where((t) => mechanic != MechanicId.choosePath || t['role'] == 'current')
      .map((t) => Json.str(t['id']))
      .toSet();
}
