/// Defensive JSON coercion helpers.
///
/// The API is served by an LLM-authored spec, so a weaker tier can emit
/// `null` where the contract promises a string, an array where it promises an
/// object, or a float where it promises an int. Every `fromJson` in
/// `lib/models` funnels through these helpers so a malformed payload degrades
/// into a sensible default instead of throwing inside `build()`.
library;

/// Namespace of pure coercion functions. Named to read as `Json.str(x)`.
abstract final class Json {
  /// String, or [fallback] when absent / not a string.
  static String str(Object? v, {String fallback = ''}) =>
      v is String ? v : fallback;

  /// String with whitespace trimmed, [fallback] when blank.
  static String line(Object? v, {String fallback = ''}) {
    if (v is! String) return fallback;
    final t = v.trim();
    return t.isEmpty ? fallback : t;
  }

  /// Nullable string: `null` when absent or blank.
  static String? strOrNull(Object? v) {
    if (v is! String) return null;
    final t = v.trim();
    return t.isEmpty ? null : t;
  }

  /// Accepts int or double (JSON has one number type).
  static num? numberOrNull(Object? v) {
    if (v is num) return v.isFinite ? v : null;
    if (v is String) {
      // Some tiers stringify numbers inside free-form maps like `variables`.
      final parsed = num.tryParse(v.trim());
      if (parsed != null && parsed.isFinite) return parsed;
    }
    return null;
  }

  static int intOr(Object? v, {int fallback = 0}) {
    final n = numberOrNull(v);
    if (n == null) return fallback;
    return n.round();
  }

  static double doubleOr(Object? v, {double fallback = 0}) {
    final n = numberOrNull(v);
    return n?.toDouble() ?? fallback;
  }

  static double? doubleOrNull(Object? v) => numberOrNull(v)?.toDouble();

  static bool boolOr(Object? v, {bool fallback = false}) => v is bool ? v : fallback;

  static bool? boolOrNull(Object? v) {
    if (v is bool) return v;
    if (v is num) return v != 0;
    if (v is String) {
      if (v == 'true') return true;
      if (v == 'false') return false;
    }
    return null;
  }

  /// A JSON object as a mutable `String`-keyed map. Anything else yields `{}`.
  static Map<String, Object?> map(Object? v) {
    if (v is Map<String, Object?>) return Map<String, Object?>.of(v);
    if (v is Map) {
      // `Map<dynamic, dynamic>` only happens when we bypass decode; normalise it.
      final out = <String, Object?>{};
      v.forEach((key, value) {
        if (key is String) out[key] = value;
      });
      return out;
    }
    return <String, Object?>{};
  }

  /// A JSON array. Non-arrays and non-iterables yield an empty list.
  static List<Object?> list(Object? v) {
    if (v is List<Object?>) return List<Object?>.of(v);
    if (v is List) return List<Object?>.of(v);
    return const <Object?>[];
  }

  /// A JSON array coerced element-wise to `T`; elements [parse] rejects
  /// (by returning `null`) are dropped rather than throwing.
  static List<T> listOf<T>(Object? v, T? Function(Object? raw) parse) {
    final out = <T>[];
    for (final raw in list(v)) {
      final parsed = parse(raw);
      if (parsed != null) out.add(parsed);
    }
    return out;
  }

  /// A JSON array of strings, with non-string elements dropped.
  ///
  /// Used for id lists (`state.selection`, `container.order`): coercing a
  /// number to `''` there would invent an object id that does not exist, so a
  /// malformed element is dropped instead.
  static List<String> stringList(Object? v) {
    final out = <String>[];
    for (final raw in list(v)) {
      if (raw is String && raw.isNotEmpty) out.add(raw);
    }
    return out;
  }

  /// A `String -> String` map (e.g. `objectGlyphs`, `actionMeaning`).
  static Map<String, String> stringMap(Object? v) {
    final out = <String, String>{};
    map(v).forEach((key, value) {
      if (value is String) out[key] = value;
    });
    return out;
  }
}
