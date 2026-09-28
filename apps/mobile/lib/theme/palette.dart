/// Runtime theming from `spec.visual.palette`.
///
/// The app ships one dark Material 3 theme; the *play* and *debrief* screens
/// re-theme themselves with the generated spec's palette, so each generated
/// game looks like its own world. Colour parsing is defensive because the
/// palette arrives from an LLM: an unparseable string falls back to the neutral
/// shell palette rather than throwing during build.
library;

import 'package:flutter/material.dart';

import '../models/spec.dart';

/// Parses `#RGB`, `#RRGGBB`, `#AARRGGBB` and a small set of CSS colour names.
Color? tryParseColor(String raw) {
  var text = raw.trim();
  if (text.isEmpty) return null;
  if (!text.startsWith('#')) {
    final named = _cssColors[text.toLowerCase()];
    if (named != null) return named;
    return null;
  }
  text = text.substring(1);
  // Tolerate an `rgb(...)` / stray prefix by taking the last hex-looking run.
  if (RegExp(r'[^0-9a-fA-F]').hasMatch(text)) return null;
  final value = int.tryParse(text, radix: 16);
  if (value == null) return null;
  return switch (text.length) {
    3 => Color(0xFF000000 | _expand(value)),
    6 => Color(0xFF000000 | value),
    8 => Color(value),
    _ => null,
  };
}

/// `#abc` -> `0xAABBCC`.
int _expand(int rgb) {
  var out = 0;
  for (final shift in [12, 8, 4]) {
    out |= ((rgb >> shift) & 0xF) * 0x11 << (shift - 4);
  }
  return out;
}

const _cssColors = <String, Color>{
  'black': Color(0xFF000000),
  'white': Color(0xFFFFFFFF),
  'red': Color(0xFFF2545B),
  'crimson': Color(0xFFDC143C),
  'orange': Color(0xFFFF8C42),
  'gold': Color(0xFFF2C14E),
  'yellow': Color(0xFFFFD166),
  'green': Color(0xFF4CC38A),
  'teal': Color(0xFF2EC4B6),
  'cyan': Color(0xFF48CAE4),
  'blue': Color(0xFF6C8CFF),
  'indigo': Color(0xFF7B61FF),
  'purple': Color(0xFFB565D9),
  'magenta': Color(0xFFE85AA8),
  'pink': Color(0xFFFF8FAB),
  'brown': Color(0xFF8D6E4A),
  'grey': Color(0xFF9AA4B2),
  'gray': Color(0xFF9AA4B2),
  'silver': Color(0xFFC0C8D4),
  'navy': Color(0xFF16213E),
  'charcoal': Color(0xFF1B1F24),
  'slate': Color(0xFF2A3038),
  'forest': Color(0xFF2D6A4F),
  'ocean': Color(0xFF1B6CA8),
  'blood': Color(0xFF7F1D1D),
  'royal': Color(0xFF4C1D95),
  'neon': Color(0xFF39FF14),
};

/// Resolved theme colours, with guaranteed non-null values.
class GameColors extends ThemeExtension<GameColors> {
  const GameColors({
    required this.background,
    required this.surface,
    required this.primary,
    required this.accent,
    required this.success,
    required this.danger,
    required this.onSurface,
    required this.muted,
  });

  /// Builds the extension from a spec palette, substituting the neutral shell
  /// for any colour the spec got wrong.
  factory GameColors.from(Palette palette, {required Brightness brightness}) {
    Color pick(String raw, Color fallback) => tryParseColor(raw) ?? fallback;
    final background = pick(palette.background, _shellBackground);
    final primary = pick(palette.primary, _shellPrimary);
    final accent = pick(palette.accent, _shellAccent);
    final success = pick(palette.success, _shellSuccess);
    final danger = pick(palette.danger, _shellDanger);
    // Derive the surface from the spec background so the board sits in the
    // generated world instead of a grey box, but keep it dark enough for the
    // dark theme: blend 18% white, clamped.
    final surface = Color.lerp(background, Colors.white, brightness == Brightness.dark ? 0.10 : 0.86)!;
    return GameColors(
      background: background,
      surface: surface,
      primary: primary,
      accent: accent,
      success: success,
      danger: danger,
      onSurface: brightness == Brightness.dark ? const Color(0xFFF2F5F9) : const Color(0xFF101418),
      muted: Color.lerp(surface, brightness == Brightness.dark ? Colors.white : Colors.black, 0.45)!,
    );
  }

  static const _shellBackground = Color(0xFF0E1116);
  static const _shellPrimary = Color(0xFF6C8CFF);
  static const _shellAccent = Color(0xFFF2C14E);
  static const _shellSuccess = Color(0xFF4CC38A);
  static const _shellDanger = Color(0xFFF2545B);

  final Color background;
  final Color surface;
  final Color primary;
  final Color accent;
  final Color success;
  final Color danger;
  final Color onSurface;
  final Color muted;

  @override
  GameColors copyWith({
    Color? background,
    Color? surface,
    Color? primary,
    Color? accent,
    Color? success,
    Color? danger,
    Color? onSurface,
    Color? muted,
  }) => GameColors(
    background: background ?? this.background,
    surface: surface ?? this.surface,
    primary: primary ?? this.primary,
    accent: accent ?? this.accent,
    success: success ?? this.success,
    danger: danger ?? this.danger,
    onSurface: onSurface ?? this.onSurface,
    muted: muted ?? this.muted,
  );

  @override
  GameColors lerp(ThemeExtension<GameColors>? other, double t) {
    if (other is! GameColors) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t)!;
    return GameColors(
      background: mix(background, other.background),
      surface: mix(surface, other.surface),
      primary: mix(primary, other.primary),
      accent: mix(accent, other.accent),
      success: mix(success, other.success),
      danger: mix(danger, other.danger),
      onSurface: mix(onSurface, other.onSurface),
      muted: mix(muted, other.muted),
    );
  }
}

/// The neutral shell theme used by the topic and problem screens, where no
/// spec exists yet. Also the fallback if a palette is unparseable.
ThemeData buildShellTheme() => buildTheme(Palette.fallback);

/// Material 3 dark theme driven by a generated palette.
ThemeData buildTheme(Palette palette) {
  const brightness = Brightness.dark;
  final colors = GameColors.from(palette, brightness: brightness);

  final scheme = ColorScheme(
    brightness: brightness,
    primary: colors.primary,
    onPrimary: _readableOn(colors.primary),
    primaryContainer: Color.lerp(colors.primary, Colors.black, 0.55),
    onPrimaryContainer: colors.onSurface,
    secondary: colors.accent,
    onSecondary: _readableOn(colors.accent),
    secondaryContainer: Color.lerp(colors.accent, Colors.black, 0.55),
    onSecondaryContainer: colors.onSurface,
    tertiary: colors.success,
    onTertiary: _readableOn(colors.success),
    tertiaryContainer: Color.lerp(colors.success, Colors.black, 0.6),
    onTertiaryContainer: colors.onSurface,
    error: colors.danger,
    onError: _readableOn(colors.danger),
    errorContainer: Color.lerp(colors.danger, Colors.black, 0.6),
    onErrorContainer: colors.onSurface,
    surface: colors.surface,
    onSurface: colors.onSurface,
    onSurfaceVariant: colors.muted,
    surfaceContainerHighest: Color.lerp(colors.surface, colors.onSurface, 0.10),
    surfaceContainerHigh: Color.lerp(colors.surface, colors.onSurface, 0.07),
    surfaceContainerLow: Color.lerp(colors.surface, colors.onSurface, 0.04),
    surfaceContainerLowest: colors.background,
    outline: Color.lerp(colors.muted, colors.background, 0.35),
    outlineVariant: Color.lerp(colors.muted, colors.background, 0.65),
    shadow: Colors.black,
    scrim: Colors.black,
    inverseSurface: colors.onSurface,
    onInverseSurface: colors.background,
    inversePrimary: colors.primary,
  );

  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: colors.background,
    splashFactory: InkSparkle.splashFactory,
  );

  return base.copyWith(
    extensions: <ThemeExtension<dynamic>>[colors],
    appBarTheme: AppBarTheme(
      backgroundColor: colors.background,
      foregroundColor: colors.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: colors.onSurface,
        fontSize: 19,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.1,
      ),
    ),
    cardTheme: CardThemeData(
      color: colors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Color.lerp(colors.surface, colors.onSurface, 0.06),
      side: BorderSide(color: scheme.outlineVariant),
      labelStyle: TextStyle(color: colors.onSurface, fontSize: 12, fontWeight: FontWeight.w600),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
    dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1, thickness: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Color.lerp(colors.surface, colors.onSurface, 0.05),
      hintStyle: TextStyle(color: colors.muted),
      labelStyle: TextStyle(color: colors.muted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: colors.primary, width: 1.6),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Color.lerp(colors.surface, Colors.black, 0.25),
      contentTextStyle: TextStyle(color: colors.onSurface),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        foregroundColor: colors.onSurface,
        side: BorderSide(color: scheme.outline),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: colors.primary),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: colors.primary, linearTrackColor: scheme.outlineVariant),
    textTheme: base.textTheme.apply(bodyColor: colors.onSurface, displayColor: colors.onSurface),
  );
}

/// Black or white, whichever reads better on [background].
Color _readableOn(Color background) =>
    background.computeLuminance() > 0.55 ? const Color(0xFF0B0E12) : Colors.white;

/// `GameColors` for the current [BuildContext], falling back to the shell
/// colours so widgets never need a null check.
extension GameColorsX on BuildContext {
  GameColors get gameColors => Theme.of(this).extension<GameColors>() ?? GameColors.from(Palette.fallback, brightness: Brightness.dark);

  /// The theme built for a spec palette, memoised by palette identity.
  static final Map<String, ThemeData> _cache = {};

  static ThemeData themed(Palette palette) =>
      _cache.putIfAbsent(palette.all.join('|'), () => buildTheme(palette));
}
