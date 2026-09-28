/// Dart mirror of `packages/game-schema/src/problems.ts` and the catalogue
/// half of `packages/game-schema/src/api-types.ts`.
library;

import 'enums.dart';
import 'json.dart';
import 'provider.dart';

enum Difficulty {
  easy('easy', 'Easy'),
  medium('medium', 'Medium'),
  hard('hard', 'Hard');

  const Difficulty(this.wire, this.label);

  final String wire;
  final String label;

  static final Map<String, Difficulty> _byWire = {
    for (final v in values) v.wire: v,
  };

  static Difficulty parse(Object? raw, {Difficulty fallback = Difficulty.easy}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

/// Constraints for `buildInstance`, mirrored so the problem screen can show the
/// shape of the data the player is about to get.
class InstanceHints {
  const InstanceHints({
    required this.minLength,
    required this.maxLength,
    this.unique = false,
    this.sorted = false,
    this.targetGuaranteed = false,
    this.valueRange,
    this.tokenAlphabet = const <String>[],
  });

  factory InstanceHints.from(Object? raw) {
    final map = Json.map(raw);
    final range = Json.list(map['valueRange']);
    return InstanceHints(
      minLength: Json.intOr(map['minLength']),
      maxLength: Json.intOr(map['maxLength'], fallback: Json.intOr(map['minLength'])),
      unique: Json.boolOr(map['unique']),
      sorted: Json.boolOr(map['sorted']),
      targetGuaranteed: Json.boolOr(map['targetGuaranteed']),
      valueRange: range.length >= 2
          ? (Json.doubleOr(range[0], fallback: 0), Json.doubleOr(range[1], fallback: 99))
          : null,
      tokenAlphabet: Json.listOf(map['tokenAlphabet'], Json.str).whereType<String>().toList(growable: false),
    );
  }

  static const InstanceHints unknown = InstanceHints(minLength: 0, maxLength: 0);

  final int minLength;
  final int maxLength;
  final bool unique;
  final bool sorted;
  final bool targetGuaranteed;

  /// `[min, max]` inclusive, or `null` when unconstrained.
  final (double, double)? valueRange;

  final List<String> tokenAlphabet;

  /// `null` when the values are unconstrained. Kept as a ready-made label so
  /// the UI does not have to destructure a record inside a `when` clause.
  String? get valueRangeLabel {
    final range = valueRange;
    if (range == null) return null;
    final (low, high) = range;
    return low == high.roundToDouble() && high == high.roundToDouble()
        ? '${low.toInt()}'
        : '${low.toInt()}–${high.toInt()}';
  }
}

class ProblemMeta {
  const ProblemMeta({
    required this.id,
    required this.topic,
    required this.title,
    required this.learningObjective,
    required this.canonicalAlgorithm,
    required this.allowedMechanics,
    required this.instanceHints,
    required this.complexityTime,
    required this.complexitySpace,
    required this.defaultDifficulty,
  });

  factory ProblemMeta.from(Object? raw) {
    final map = Json.map(raw);
    final complexity = Json.map(map['complexity']);
    return ProblemMeta(
      id: Json.str(map['id']),
      topic: DsaTopic.tryParse(map['topic']) ?? DsaTopic.arrays,
      title: Json.line(map['title'], fallback: Json.str(map['id'], fallback: 'Problem')),
      learningObjective: Json.line(
        map['learningObjective'],
        fallback: 'Understand what this algorithm does and why.',
      ),
      canonicalAlgorithm: Json.line(map['canonicalAlgorithm'], fallback: 'Work the problem step by step.'),
      allowedMechanics: Json.listOf(map['allowedMechanics'], MechanicId.parse).whereType<MechanicId>().toList(growable: false),
      instanceHints: InstanceHints.from(map['instanceHints']),
      complexityTime: Json.str(complexity['time'], fallback: '—'),
      complexitySpace: Json.str(complexity['space'], fallback: '—'),
      defaultDifficulty: Difficulty.parse(map['defaultDifficulty']),
    );
  }

  final String id;
  final DsaTopic topic;
  final String title;

  /// One sentence: what the player must internalise.
  final String learningObjective;

  /// The canonical algorithm, in plain words.
  final String canonicalAlgorithm;

  /// Strictly the mechanics the engine can render for this problem.
  final List<MechanicId> allowedMechanics;

  final InstanceHints instanceHints;
  final String complexityTime;
  final String complexitySpace;
  final Difficulty defaultDifficulty;

  List<(String, String)> get complexityChips => [
    ('time', complexityTime),
    ('space', complexitySpace),
  ];
}

class TopicDto {
  const TopicDto({required this.id, required this.label, required this.problems});

  factory TopicDto.from(Object? raw) {
    final map = Json.map(raw);
    return TopicDto(
      id: Json.str(map['id']),
      label: Json.line(map['label'], fallback: Json.str(map['id'], fallback: 'Topic')),
      problems: Json.listOf(map['problems'], ProblemMeta.from).whereType<ProblemMeta>().toList(growable: false),
    );
  }

  final String id;
  final String label;
  final List<ProblemMeta> problems;

  /// The enum label when the id is a known topic, else the server's label.
  DsaTopic? get topic => DsaTopic.tryParse(id);
}

class CatalogueResponse {
  const CatalogueResponse({required this.topics, required this.tiers, required this.laya});

  factory CatalogueResponse.from(Object? raw) {
    final map = Json.map(raw);
    return CatalogueResponse(
      topics: Json.listOf(map['topics'], TopicDto.from).whereType<TopicDto>().toList(growable: false),
      tiers: Json.listOf(map['tiers'], TierAvailability.from).whereType<TierAvailability>().toList(growable: false),
      laya: map['laya'] == null ? LayaAvailability.unknown : LayaAvailability.from(map['laya']),
    );
  }

  final List<TopicDto> topics;
  final List<TierAvailability> tiers;
  final LayaAvailability laya;

  bool get isEmpty => topics.isEmpty;

  int get problemCount =>
      topics.fold<int>(0, (sum, topic) => sum + topic.problems.length);

  ProblemMeta? problemById(String id) {
    for (final topic in topics) {
      for (final problem in topic.problems) {
        if (problem.id == id) return problem;
      }
    }
    return null;
  }
}
