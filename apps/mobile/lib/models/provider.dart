/// Provider / coach availability, shared by the catalogue (problem.dart) and
/// the action + generate responses (api.dart).
///
/// Kept separate from both so neither has to import the other just for a tier
/// enum, and so the UI can render "who actually made this" without knowing
/// which response it came from.
library;

import 'json.dart';

enum ProviderTier {
  opencode('opencode', 'opencode'),
  openrouter('openrouter', 'OpenRouter'),
  localLlm('local-llm', 'local LLM'),
  template('template', 'template');

  const ProviderTier(this.wire, this.label);

  final String wire;
  final String label;

  /// Tier 4 is the deterministic fallback: no LLM was involved, so the spec
  /// is machine-authored and the client can say so honestly.
  bool get isGenerated => this != ProviderTier.template;

  static final Map<String, ProviderTier> _byWire = {
    for (final v in values) v.wire: v,
  };

  static ProviderTier parse(
    Object? raw, {
    ProviderTier fallback = ProviderTier.template,
  }) => raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum CoachSource {
  laya('laya', 'Laya'),
  semantic('semantic', 'semantic router'),
  zeroShot('zero-shot', 'local classifier'),
  heuristic('heuristic', 'built-in');

  const CoachSource(this.wire, this.label);

  final String wire;
  final String label;

  bool get isLlm => this != CoachSource.heuristic;

  static final Map<String, CoachSource> _byWire = {
    for (final v in values) v.wire: v,
  };

  static CoachSource parse(
    Object? raw, {
    CoachSource fallback = CoachSource.heuristic,
  }) => raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

class TierAvailability {
  const TierAvailability({
    required this.tier,
    required this.available,
    this.detail,
  });

  factory TierAvailability.from(Object? raw) {
    final map = Json.map(raw);
    return TierAvailability(
      tier: ProviderTier.parse(map['tier']),
      available: Json.boolOr(map['available']),
      detail: Json.strOrNull(map['detail']),
    );
  }

  final ProviderTier tier;
  final bool available;
  final String? detail;
}

/// Which tiers were tried, and why the earlier ones were skipped or failed.
class ProviderAttempt {
  const ProviderAttempt({
    required this.tier,
    required this.ok,
    required this.ms,
    this.error,
  });

  factory ProviderAttempt.from(Object? raw) {
    final map = Json.map(raw);
    return ProviderAttempt(
      tier: ProviderTier.parse(map['tier']),
      ok: Json.boolOr(map['ok']),
      ms: Json.intOr(map['ms']),
      error: Json.strOrNull(map['error']),
    );
  }

  final ProviderTier tier;
  final bool ok;
  final int ms;
  final String? error;
}

class LayaAvailability {
  const LayaAvailability({
    required this.enabled,
    required this.available,
    this.detail,
  });

  factory LayaAvailability.from(Object? raw) {
    final map = Json.map(raw);
    return LayaAvailability(
      enabled: Json.boolOr(map['enabled']),
      available: Json.boolOr(map['available']),
      detail: Json.strOrNull(map['detail']),
    );
  }

  static final LayaAvailability unknown = LayaAvailability(
    enabled: false,
    available: false,
  );

  final bool enabled;
  final bool available;
  final String? detail;

  bool get isLive => enabled && available;
}

class DecisionAvailability {
  const DecisionAvailability({
    required this.backend,
    required this.available,
    this.model,
    this.detail,
  });
  factory DecisionAvailability.from(Object? raw) {
    final map = Json.map(raw);
    return DecisionAvailability(
      backend: Json.str(map['backend']),
      available: Json.boolOr(map['available']),
      model: Json.strOrNull(map['model']),
      detail: Json.strOrNull(map['detail']),
    );
  }
  final String backend;
  final bool available;
  final String? model;
  final String? detail;
}
