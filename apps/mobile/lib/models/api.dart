/// Dart mirror of the request/response envelopes in
/// `packages/game-schema/src/api-types.ts`, plus `ActionOutcome` from state.ts
/// and `AnswerSummary` from oracle.ts.
library;

import '../services/api_exception.dart';
import 'action.dart';
import 'guidance.dart';
import 'enums.dart';
import 'json.dart';
import 'problem.dart';
import 'provider.dart';
import 'spec.dart';
import 'state.dart';
import 'trace.dart';

// ------------------------------------------------------------------ generate

class GenerateRequest {
  const GenerateRequest({
    required this.problemId,
    this.seed,
    this.difficulty,
    this.freeText,
    this.forceTemplate = false,
  });

  /// Omit [seed] for a random instance + a fresh theme ("new version").
  final String problemId;
  final int? seed;
  final Difficulty? difficulty;

  /// Optional player free-text, used for Laya routing + theme steering.
  final String? freeText;

  /// Skip LLM tiers entirely; always use the template tier.
  final bool forceTemplate;

  Map<String, Object?> toJson() => {
    'problemId': problemId,
    if (seed != null) 'seed': seed,
    if (difficulty != null) 'difficulty': difficulty!.wire,
    if (freeText != null && freeText!.trim().isNotEmpty)
      'freeText': freeText!.trim(),
    if (forceTemplate) 'forceTemplate': true,
  };
}

class GenerateResponse {
  const GenerateResponse({
    required this.gameId,
    required this.problemId,
    required this.seed,
    required this.spec,
    required this.state,
    required this.usedTier,
    required this.attempts,
    required this.notes,
    this.turnPrompt,
  });

  factory GenerateResponse.from(Object? raw) {
    final map = Json.map(raw);
    final gameId = Json.str(map['gameId']);
    if (gameId.isEmpty) {
      throw const MalformedResponse('generate response is missing gameId');
    }
    return GenerateResponse(
      turnPrompt: map['turnPrompt'] == null
          ? null
          : TurnPrompt.from(map['turnPrompt']),
      gameId: gameId,
      problemId: Json.str(map['problemId']),
      seed: Json.intOr(map['seed']),
      spec: GameSpec.from(map['spec']),
      state: GameState.from(map['state']),
      usedTier: ProviderTier.parse(map['usedTier']),
      attempts: Json.listOf(
        map['attempts'],
        ProviderAttempt.from,
      ).whereType<ProviderAttempt>().toList(growable: false),
      notes: Json.stringList(map['notes']),
    );
  }

  final String gameId;
  final String problemId;
  final int seed;
  final GameSpec spec;
  final GameState state;

  /// Which tier actually produced the playable spec.
  final ProviderTier usedTier;

  final List<ProviderAttempt> attempts;

  /// Non-fatal notes, e.g. "spec repaired on attempt 2".
  final List<String> notes;
  final TurnPrompt? turnPrompt;
}

// -------------------------------------------------------------------- action

class ActionRequest {
  const ActionRequest({required this.gameId, required this.action});

  final String gameId;
  final Action action;

  Map<String, Object?> toJson() => {
    'gameId': gameId,
    'action': action.toJson(),
  };
}

class ActionOutcome {
  const ActionOutcome({
    required this.correct,
    required this.feedback,
    required this.dsaOp,
    required this.traceStep,
    this.expected,
    this.illegal = false,
    this.won,
  });

  factory ActionOutcome.from(Object? raw) {
    final map = Json.map(raw);
    return ActionOutcome(
      correct: Json.boolOr(map['correct']),
      // `expected` is a `Partial<Action>`, so parse it with the same lenient
      // reader; a partial body with a `type` is still enough to render.
      expected: Action.fromJson(map['expected']),
      feedback: Json.line(map['feedback'], fallback: 'Not quite.'),
      dsaOp: DsaOp.parse(map['dsaOp']),
      traceStep: Json.intOr(map['traceStep'], fallback: -1),
      illegal: Json.boolOr(map['illegal']),
      won: Json.boolOrNull(map['won']),
    );
  }

  final bool correct;

  /// Present when the player's action was wrong: what the algorithm wanted.
  final Action? expected;

  /// Short, in-theme, in-character feedback.
  final String feedback;

  final DsaOp dsaOp;

  /// Index into `state.trace` of the frame this action produced.
  final int traceStep;

  /// True when the action was not allowed at all in the current state.
  final bool illegal;

  /// Set when the action ended the game.
  final bool? won;

  bool get isMistake => !correct;

  /// A mistake the engine refused outright: nothing changed, so the player just
  /// needs to pick a different target.
  bool get isDeadEnd => illegal;
}

class ActionResponse {
  const ActionResponse({
    required this.gameId,
    required this.state,
    required this.outcome,
    required this.usedTier,
    this.debrief,
    this.turnPrompt,
  });

  factory ActionResponse.from(Object? raw) {
    final map = Json.map(raw);
    final gameId = Json.str(map['gameId']);
    if (gameId.isEmpty) {
      throw const MalformedResponse('action response is missing gameId');
    }
    return ActionResponse(
      turnPrompt: map['turnPrompt'] == null
          ? null
          : TurnPrompt.from(map['turnPrompt']),
      gameId: gameId,
      state: GameState.from(map['state']),
      outcome: ActionOutcome.from(map['outcome']),
      usedTier: ProviderTier.parse(map['usedTier']),
      debrief: map['debrief'] == null ? null : Debrief.from(map['debrief']),
    );
  }

  final String gameId;
  final GameState state;
  final ActionOutcome outcome;
  final ProviderTier usedTier;

  /// Present once phase !== 'playing'.
  final Debrief? debrief;
  final TurnPrompt? turnPrompt;
}

// ------------------------------------------------------------------- debrief

class AnswerSummary {
  const AnswerSummary({
    required this.text,
    this.value,
    this.details = const <AnswerDetail>[],
  });

  factory AnswerSummary.from(Object? raw) {
    final map = Json.map(raw);
    return AnswerSummary(
      text: Json.line(map['text'], fallback: '—'),
      value: _scalarOrNull(map['value']),
      details: Json.listOf(
        map['details'],
        AnswerDetail.from,
      ).whereType<AnswerDetail>().toList(growable: false),
    );
  }

  static Object? _scalarOrNull(Object? raw) {
    if (raw == null) return null;
    if (raw is num || raw is String) return raw;
    return null;
  }

  /// Human readable canonical answer, e.g. "index 7".
  final String text;

  /// Machine readable form for the client.
  final Object? value;

  final List<AnswerDetail> details;

  String get valueText => value?.toString() ?? '—';
}

class AnswerDetail {
  const AnswerDetail({required this.label, required this.value});

  factory AnswerDetail.from(Object? raw) {
    final map = Json.map(raw);
    return AnswerDetail(
      label: Json.line(map['label'], fallback: 'detail'),
      value: Json.line(map['value']?.toString()),
    );
  }

  final String label;
  final String value;
}

class DebriefStats {
  const DebriefStats({
    required this.steps,
    required this.mistakes,
    required this.hintsUsed,
    required this.mistakesByMechanic,
    this.misconception,
    this.confidence,
  });

  factory DebriefStats.from(Object? raw) {
    final map = Json.map(raw);
    final byMechanic = <String, int>{};
    Json.map(map['mistakesByMechanic']).forEach((key, value) {
      final n = Json.numberOrNull(value);
      if (n != null) byMechanic[key] = n.round();
    });
    return DebriefStats(
      steps: Json.intOr(map['steps']),
      mistakes: Json.intOr(map['mistakes']),
      hintsUsed: Json.intOr(map['hintsUsed']),
      mistakesByMechanic: Map.unmodifiable(byMechanic),
      misconception: Json.strOrNull(map['misconception']),
      confidence: Json.doubleOrNull(map['confidence']),
    );
  }

  static const DebriefStats empty = DebriefStats(
    steps: 0,
    mistakes: 0,
    hintsUsed: 0,
    mistakesByMechanic: {},
  );

  final int steps;
  final int mistakes;
  final int hintsUsed;
  final Map<String, int> mistakesByMechanic;

  /// Laya-classified misconception, when available.
  final String? misconception;

  final double? confidence;

  List<(String, String)> get chips => <(String, String)>[
    ('steps', '$steps'),
    ('mistakes', '$mistakes'),
    ('hints', '$hintsUsed'),
  ];

  List<(String, int)> get mechanicTallies {
    final entries =
        mistakesByMechanic.entries.where((e) => e.value > 0).toList()
          ..sort((a, b) => b.value.compareTo(a.value));
    return entries
        .map((e) => (MechanicId.parse(e.key).wire, e.value))
        .toList(growable: false);
  }
}

class Debrief {
  const Debrief({
    required this.problemId,
    required this.phase,
    required this.playedTrace,
    required this.canonicalTrace,
    required this.answer,
    required this.pseudocode,
    required this.code,
    required this.complexity,
    required this.summary,
    required this.actionMeaning,
    required this.mapping,
    required this.stats,
    required this.hintPool,
  });

  factory Debrief.from(Object? raw) {
    final map = Json.map(raw);
    final code = <String, List<String>>{};
    Json.map(map['code']).forEach((lang, lines) {
      final parsed = Json.listOf(
        lines,
        Json.line,
      ).whereType<String>().toList(growable: false);
      if (parsed.isNotEmpty) code[lang] = parsed;
    });
    return Debrief(
      problemId: Json.str(map['problemId']),
      phase: GamePhase.parse(map['phase'], fallback: GamePhase.won),
      playedTrace: Json.listOf(
        map['playedTrace'],
        TraceFrame.from,
      ).whereType<TraceFrame>().toList(growable: false),
      canonicalTrace: Json.listOf(
        map['canonicalTrace'],
        TraceFrame.from,
      ).whereType<TraceFrame>().toList(growable: false),
      answer: AnswerSummary.from(map['answer']),
      pseudocode: Json.listOf(
        map['pseudocode'],
        Json.line,
      ).whereType<String>().toList(growable: false),
      code: Map.unmodifiable(code),
      complexity: Complexity.from(map['complexity']),
      summary: Json.line(map['summary'], fallback: 'Here is what happened.'),
      actionMeaning: Json.stringMap(map['actionMeaning']),
      mapping: Json.listOf(
        map['mapping'],
        _rowFrom,
      ).whereType<MappingRow>().toList(growable: false),
      stats: DebriefStats.from(map['stats']),
      hintPool: Json.stringList(map['hintPool']),
    );
  }

  static MappingRow? _rowFrom(Object? raw) {
    if (raw is! Map) return null;
    final a = Json.strOrNull(raw['gameTerm']);
    final b = Json.strOrNull(raw['algorithmTerm']);
    if (a == null || b == null) return null;
    return MappingRow(gameTerm: a, algorithmTerm: b);
  }

  final String problemId;
  final GamePhase phase;

  /// The player's own history, for the replay.
  final List<TraceFrame> playedTrace;

  /// The reference solution, for the side-by-side algorithm view.
  final List<TraceFrame> canonicalTrace;

  final AnswerSummary answer;
  final List<String> pseudocode;

  /// Language -> 1-indexed source lines. The client adds the gutter.
  final Map<String, List<String>> code;

  final Complexity complexity;

  /// Player-facing prose from the spec's debrief block.
  final String summary;

  final Map<String, String> actionMeaning;
  final List<MappingRow> mapping;
  final DebriefStats stats;

  /// Throttled hints, revealed on demand by the client.
  final List<String> hintPool;

  bool get isWin => phase == GamePhase.won;

  /// Languages actually present in `code`, in a stable display order.
  List<String> get codeLanguages {
    const preferred = ['javascript', 'typescript', 'python'];
    final present = code.keys.toSet();
    final ordered = preferred.where(present.contains).toList();
    final rest = present.where((key) => !ordered.contains(key)).toList()
      ..sort();
    return [...ordered, ...rest];
  }

  /// 1-based code lines the player actually reached, per language.
  ///
  /// `TraceFrame.codeLine` is 1-based and indexes `pseudocode()` /
  /// `code(lang)`, so the same line number applies to every language block.
  Set<int> get hitCodeLines {
    final lines = <int>{};
    for (final frame in playedTrace) {
      if (frame.codeLine > 0) lines.add(frame.codeLine);
    }
    return lines;
  }

  /// Code lines the player reached on a wrong action — highlighted in danger
  /// colour so "where I went wrong" is a line, not a paragraph.
  Set<int> get mistakeCodeLines {
    final lines = <int>{};
    for (final frame in playedTrace) {
      if (!frame.correct && frame.codeLine > 0) lines.add(frame.codeLine);
    }
    return lines;
  }
}

// --------------------------------------------------------------------- hints

class HintRequest {
  const HintRequest({required this.gameId});

  final String gameId;

  Map<String, Object?> toJson() => {'gameId': gameId};
}

class HintResponse {
  const HintResponse({
    required this.hint,
    required this.source,
    this.confidence,
  });

  factory HintResponse.from(Object? raw) {
    final map = Json.map(raw);
    return HintResponse(
      hint: Json.line(
        map['hint'],
        fallback: 'Re-read the objective and take the next legal step.',
      ),
      source: CoachSource.parse(map['source']),
      confidence: Json.doubleOrNull(map['confidence']),
    );
  }

  final String hint;

  /// 'laya' when the local model chose it, 'heuristic' otherwise.
  final CoachSource source;

  final double? confidence;
}

// -------------------------------------------------------------------- decide

enum DecisionKind {
  routeProblem('route-problem'),
  pickTheme('pick-theme'),
  pickHint('pick-hint'),
  tagMisconception('tag-misconception'),
  difficulty('difficulty');

  const DecisionKind(this.wire);

  final String wire;

  static final Map<String, DecisionKind> _byWire = {
    for (final v in values) v.wire: v,
  };

  static DecisionKind parse(
    Object? raw, {
    DecisionKind fallback = DecisionKind.pickTheme,
  }) => raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

class DecideRequest {
  const DecideRequest({
    required this.kind,
    required this.stateText,
    required this.options,
    required this.instructions,
  });

  final DecisionKind kind;

  /// Text describing the current situation, for Laya to score.
  final String stateText;

  /// Fixed label set. Laya returns one of these keys.
  final Map<String, String> options;

  final String instructions;

  Map<String, Object?> toJson() => {
    'kind': kind.wire,
    'stateText': stateText,
    'options': options,
    'instructions': instructions,
  };
}

class DecideResponse {
  const DecideResponse({
    required this.kind,
    required this.choice,
    required this.confidence,
    required this.source,
    this.distribution,
    this.model,
    this.scoreKind,
    this.score,
    this.margin,
    this.fallbackReason,
  });

  factory DecideResponse.from(Object? raw) {
    final map = Json.map(raw);
    final distribution = <String, double>{};
    Json.map(map['distribution']).forEach((key, value) {
      final n = Json.numberOrNull(value);
      if (n != null) distribution[key] = n.toDouble();
    });
    return DecideResponse(
      kind: DecisionKind.parse(map['kind']),
      choice: Json.str(map['choice']),
      confidence: Json.doubleOr(map['confidence'], fallback: 0),
      source: CoachSource.parse(map['source']),
      model: Json.strOrNull(map['model']),
      scoreKind: Json.strOrNull(map['scoreKind']),
      score: Json.numberOrNull(map['score'])?.toDouble(),
      margin: Json.numberOrNull(map['margin'])?.toDouble(),
      fallbackReason: Json.strOrNull(map['fallbackReason']),
      distribution: distribution.isEmpty
          ? null
          : Map.unmodifiable(distribution),
    );
  }

  final String? model;
  final String? scoreKind;
  final double? score;
  final double? margin;
  final String? fallbackReason;
  final DecisionKind kind;
  final String choice;

  /// Compatibility score; scoreKind identifies similarity versus probability.
  final double confidence;

  final CoachSource source;

  /// Full calibrated distribution when Laya answered.
  final Map<String, double>? distribution;
}

// -------------------------------------------------------------------- health

class HealthResponse {
  const HealthResponse({
    required this.ok,
    required this.version,
    required this.tiers,
    required this.laya,
    required this.uptimeSec,
    this.decision,
  });

  factory HealthResponse.from(Object? raw) {
    final map = Json.map(raw);
    return HealthResponse(
      ok: Json.boolOr(map['ok']),
      version: Json.str(map['version'], fallback: '0.0.0'),
      tiers: Json.listOf(
        map['tiers'],
        TierAvailability.from,
      ).whereType<TierAvailability>().toList(growable: false),
      laya: map['laya'] == null
          ? LayaAvailability.unknown
          : LayaAvailability.from(map['laya']),
      uptimeSec: Json.doubleOr(map['uptimeSec']),
      decision: map['decision'] == null
          ? null
          : DecisionAvailability.from(map['decision']),
    );
  }

  final DecisionAvailability? decision;
  final bool ok;
  final String version;
  final List<TierAvailability> tiers;
  final LayaAvailability laya;
  final double uptimeSec;
}
