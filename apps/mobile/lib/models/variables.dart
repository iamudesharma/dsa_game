/// The two loose value bags in the contract: `Variables` (algorithm variables)
/// and the `Record<string, string|number|boolean>` maps used for
/// `GameObject.tags`, `Slot.meta` and `GameState.internal`.
///
/// They live in their own file so `state.dart` and `trace.dart` can both use
/// them without a circular import.
library;

import 'json.dart';

/// A single `Variables` entry.
///
/// The contract is `number | string | boolean | null`, which Dart cannot
/// express without `dynamic`. A sealed hierarchy keeps the model layer free of
/// `dynamic` while still round-tripping all four cases, and gives the UI a
/// typed [number] for the algorithm strip.
sealed class VarValue {
  const VarValue();

  /// Rebuilds from a decoded JSON value.
  factory VarValue.from(Object? raw) {
    if (raw is num) {
      return raw.isFinite ? NumValue(raw) : const NullValue();
    }
    if (raw is bool) return FlagValue(raw);
    if (raw is String) return TextValue(raw);
    return const NullValue();
  }

  /// The value as a number, when it is one (or a numeric string).
  num? get number => null;

  /// How the algorithm strip / trace rail renders this value.
  String get display;

  @override
  String toString() => display;
}

final class NumValue extends VarValue {
  const NumValue(this.value);

  final num value;

  @override
  num? get number => value;

  /// Whole numbers render without a trailing `.0` so `mid = 3` does not read as
  /// `3.0`; real halves like `3.5` keep one decimal.
  @override
  String get display {
    if (value is int) return value.toString();
    if (value == value.roundToDouble() && value.abs() < 1e15) {
      return value.toInt().toString();
    }
    return value.toStringAsFixed(1);
  }
}

final class TextValue extends VarValue {
  const TextValue(this.value);

  final String value;

  /// A weaker tier sometimes writes a number as a string. The value stays a
  /// string for display, but the numeric accessor still works, so the algorithm
  /// strip does not have to special-case it.
  @override
  num? get number => num.tryParse(value.trim());

  @override
  String get display => value.isEmpty ? '—' : value;
}

final class FlagValue extends VarValue {
  const FlagValue(this.value);

  final bool value;

  @override
  String get display => value ? 'true' : 'false';
}

final class NullValue extends VarValue {
  const NullValue();

  @override
  String get display => '—';
}

/// Immutable `Record<string, number|string|boolean|null>`.
class Variables {
  const Variables(this._values);

  factory Variables.from(Object? raw) {
    final src = Json.map(raw);
    if (src.isEmpty) return const Variables({});
    return Variables(
      Map.unmodifiable(src.map((key, value) => MapEntry(key, VarValue.from(value)))),
    );
  }

  static const Variables empty = Variables({});

  final Map<String, VarValue> _values;

  Map<String, VarValue> get entries => _values;

  bool get isEmpty => _values.isEmpty;

  int get length => _values.length;

  VarValue? operator [](String name) => _values[name];

  /// Convenience for the algorithm strip: the numeric value or `null`.
  num? number(String name) => _values[name]?.number;

  String display(String name) => _values[name]?.display ?? '—';

  bool has(String name) => _values.containsKey(name);

  /// Names in stable sorted order.
  ///
  /// The strip must not reshuffle between frames: chips that move around on
  /// every step are unreadable while the player is watching the board. Sorting
  /// keeps each variable anchored to the same chip.
  List<String> get names => _values.keys.toList()..sort();
}

/// Typed reader for the loose `Record<string, string|number|boolean>` maps.
class Attrs {
  /// [raw] is stored as-is; use [Attrs.from] to get an unmodifiable copy.
  const Attrs(this._raw);

  factory Attrs.from(Object? raw) => Attrs(Map.unmodifiable(Json.map(raw)));

  static const Attrs empty = Attrs(<String, Object?>{});

  final Map<String, Object?> _raw;

  Map<String, Object?> get entries => _raw;

  bool get isEmpty => _raw.isEmpty;

  bool has(String key) => _raw.containsKey(key);

  String? str(String key) {
    final v = _raw[key];
    return v is String ? v : null;
  }

  num? number(String key) => Json.numberOrNull(_raw[key]);

  bool? flag(String key) => Json.boolOrNull(_raw[key]);

  String strOr(String key, String fallback) => str(key) ?? fallback;
}
