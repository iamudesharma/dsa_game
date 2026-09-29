/// Browser-local style progression: versioned progress with completed problem
/// ids, completion timestamps and the selected cosmetic map frame.
///
/// Pure functions over plain data, so every rule is unit-testable without a
/// device:
///
///  * completion is recorded only from an authoritative game state reporting
///    `won` — callers pass the phase, and anything else is ignored;
///  * one mission stamp per problem, regardless of difficulty, mistakes or
///    hints; replays never duplicate rewards and keep the first timestamp;
///  * a world badge is earned by completing *every* mission in the topic;
///  * recommendation is the first unfinished mission in catalogue order;
///  * deserialisation tolerates corrupt data by resetting with a warning flag
///    instead of throwing.
library;

import 'worlds.dart';

/// Storage schema version. Bump when the shape changes and migrate in
/// [AdventureProgress.fromJson].
const int adventureSchemaVersion = 1;

/// Solved markers from the linked-list lesson, mapped onto mission ids. The
/// mobile client never had lesson markers of its own, so there is nothing to
/// import — but the mapping lives here, next to the rule, for the day the
/// notebook marks questions solved outside a game.
const Map<String, String> lessonQuestionToMission = {
  'count-nodes': 'linked-list-traversal',
  'reverse-list': 'reverse-linked-list',
};

class AdventureProgress {
  const AdventureProgress({
    required this.completed,
    this.mapFrame = 'default',
  });

  /// Problem id -> first-completion ISO-8601 timestamp.
  final Map<String, String> completed;

  /// `'default'` or a fully-completed world's topic wire value.
  final String mapFrame;

  static AdventureProgress fresh() => const AdventureProgress(completed: {});

  /// Parses stored JSON, returning fresh progress plus `warning: true` when
  /// the payload is corrupt or from an unknown schema version.
  static ({AdventureProgress progress, bool warning}) fromJson(Object? raw) {
    if (raw is! Map) return (progress: fresh(), warning: true);
    final version = raw['version'];
    if (version != adventureSchemaVersion) return (progress: fresh(), warning: version != null);
    final completedRaw = raw['completed'];
    if (completedRaw is! Map) return (progress: fresh(), warning: true);
    final completed = <String, String>{};
    for (final entry in completedRaw.entries) {
      final id = entry.key;
      final stamp = entry.value;
      if (id is! String || stamp is! String) continue;
      if (DateTime.tryParse(stamp) == null) continue;
      completed[id] = stamp;
    }
    final frame = raw['mapFrame'];
    return (
      progress: AdventureProgress(
        completed: completed,
        mapFrame: frame is String ? frame : 'default',
      ),
      warning: false,
    );
  }

  Map<String, Object?> toJson() => {
    'version': adventureSchemaVersion,
    'completed': Map<String, String>.from(completed),
    'mapFrame': mapFrame,
  };
}

/// Records a completion. Returns the *same instance* when nothing is earned,
/// so callers can skip a write: anything that is not `won`, an unknown
/// problem id, or an already-stamped mission earns nothing.
AdventureProgress recordCompletion(
  AdventureProgress progress,
  Set<String> knownProblemIds, {
  required String problemId,
  required String phase,
  DateTime Function()? clock,
}) {
  if (phase != 'won') return progress;
  if (!knownProblemIds.contains(problemId)) return progress;
  if (progress.completed.containsKey(problemId)) return progress;
  final now = (clock ?? DateTime.now)().toUtc().toIso8601String();
  return AdventureProgress(
    completed: {...progress.completed, problemId: now},
    mapFrame: progress.mapFrame,
  );
}

/// Worlds where every listed mission id is stamped.
List<WorldDefinition> completedWorlds(
  AdventureProgress progress,
  Map<WorldDefinition, List<String>> missionIds,
) {
  return [
    for (final entry in missionIds.entries)
      if (entry.value.isNotEmpty && entry.value.every(progress.completed.containsKey)) entry.key,
  ];
}

/// The first unfinished mission in catalogue order, or `null` when done.
/// All missions stay accessible regardless — this is a suggestion, not a lock.
String? nextMission(AdventureProgress progress, List<String> orderedProblemIds) {
  for (final id in orderedProblemIds) {
    if (!progress.completed.containsKey(id)) return id;
  }
  return null;
}
