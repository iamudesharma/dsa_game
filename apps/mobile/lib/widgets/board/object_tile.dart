/// One `GameObject`, drawn as a themed tile.
///
/// The eight [ObjectState]s each have to be *legible at a glance* — a player
/// should never have to read a legend to know that a row is now out of the
/// search space. `eliminated` in particular is dimmed, desaturated and struck
/// through, which reads as "gone" even at 32px.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';

class ObjectTile extends StatelessWidget {
  const ObjectTile({
    required this.object,
    required this.spec,
    this.selected = false,
    this.highlighted = false,
    this.dimmed = false,
    this.width,
    this.height = 46,
    this.showLabel = true,
    this.dense = false,
    super.key,
  });

  final GameObject object;
  final GameSpec spec;

  /// The object is in `state.selection`.
  final bool selected;

  /// The object is part of `outcome.expected` — the "do this instead" hint.
  final bool highlighted;

  /// Drawn faint because it is not currently actionable (wrong kind, locked).
  final bool dimmed;

  final double? width;
  final double height;
  final bool showLabel;

  /// Tighter typography for long boards.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final visual = _style(context, colors);

    return Semantics(
      excludeSemantics: true,
      label:
          '${object.label}, value ${object.value}, ${object.state.name}${highlighted ? ', recommended' : ''}',
      selected: selected,
      child: AnimatedContainer(
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
        width: width,
        height: height,
        // A dimmed tile is not actionable right now (wrong kind / locked by the
        // oracle), so it recedes instead of competing for attention.
        foregroundDecoration: dimmed
            ? BoxDecoration(color: Colors.black.withValues(alpha: 0.35))
            : null,
        decoration: BoxDecoration(
          color: visual.fill,
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: visual.border, width: visual.borderWidth),
          boxShadow: visual.selected
              ? [
                  BoxShadow(
                    color: colors.primary.withValues(alpha: 0.35),
                    blurRadius: 12,
                    spreadRadius: -2,
                  ),
                ]
              : null,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(11),
          child: Stack(
            // A loose stack sized by its content, not `StackFit.expand`: the pool
            // puts tiles inside a horizontal ListView, where an expanding child
            // would ask for infinite width. The badges below are `Positioned`, so
            // they overlay whatever size the content settles on.
            children: [
              Padding(
                padding: EdgeInsets.symmetric(horizontal: showLabel ? 4 : 2),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: _Glyph(
                        visual: object.visual,
                        glyph: spec.visual.glyphFor(object.kind),
                        color: visual.foreground,
                        fontSize: dense ? 13 : 16,
                      ),
                    ),
                    if (showLabel &&
                        !(object.visual is TextVisual &&
                            (object.visual as TextVisual).text ==
                                object.label)) ...[
                      const SizedBox(height: 1),
                      // Cap the label so an unconstrained parent (the pool's
                      // ListView) cannot stretch a tile to its full text width.
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 88),
                        child: Text(
                          object.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: visual.foreground,
                            fontSize: dense ? 9.5 : 11,
                            fontWeight: FontWeight.w700,
                            height: 1.15,
                            decoration: visual.struck
                                ? TextDecoration.lineThrough
                                : null,
                            decorationColor: visual.foreground,
                            decorationThickness: 1.6,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              // The strike-through is drawn over whatever the content sized to.
              if (visual.struck)
                const Positioned.fill(
                  child: CustomPaint(painter: _StrikePainter()),
                ),
              if (visual.badge != null)
                Positioned(top: 1, right: 1, child: visual.badge!),
              if (highlighted)
                Positioned.fill(
                  child: IgnorePointer(
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(11),
                        border: Border.all(
                          color: colors.accent.withValues(alpha: 0.9),
                          width: 2,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  _ObjectStyle _style(BuildContext context, GameColors colors) {
    final state = object.state;
    final base = _ObjectStyle(
      fill: colors.surface,
      border: colors.muted.withValues(alpha: 0.35),
      foreground: colors.onSurface,
    );

    return switch (state) {
      ObjectState.idle => base,
      ObjectState.selected => _ObjectStyle(
        fill: Color.lerp(colors.surface, colors.primary, 0.22)!,
        border: colors.primary,
        borderWidth: 2,
        foreground: colors.onSurface,
        selected: true,
      ),
      ObjectState.eliminated => _ObjectStyle(
        fill: Color.lerp(colors.surface, Colors.black, 0.35)!,
        border: colors.muted.withValues(alpha: 0.28),
        foreground: colors.muted.withValues(alpha: 0.55),
        struck: true,
        badge: const _MiniBadge('✕', Color(0xFF9AA4B2)),
      ),
      ObjectState.matched => _ObjectStyle(
        fill: Color.lerp(colors.surface, colors.success, 0.20)!,
        border: colors.success,
        foreground: colors.onSurface,
        badge: _MiniBadge('✓', colors.success),
      ),
      ObjectState.swapped => _ObjectStyle(
        fill: Color.lerp(colors.surface, colors.accent, 0.24)!,
        border: colors.accent,
        borderWidth: 2,
        foreground: colors.onSurface,
        badge: _MiniBadge('⇄', colors.accent),
      ),
      ObjectState.locked => _ObjectStyle(
        fill: Color.lerp(colors.surface, Colors.black, 0.2)!,
        border: colors.muted.withValues(alpha: 0.5),
        foreground: colors.muted,
        badge: _MiniBadge('🔒', colors.muted),
      ),
      ObjectState.current => _ObjectStyle(
        fill: Color.lerp(colors.surface, colors.accent, 0.18)!,
        border: colors.accent,
        borderWidth: 2,
        foreground: colors.onSurface,
        selected: true,
        badge: _MiniBadge('▶', colors.accent),
      ),
      ObjectState.visited => _ObjectStyle(
        fill: Color.lerp(colors.surface, colors.onSurface, 0.07)!,
        border: colors.muted.withValues(alpha: 0.55),
        foreground: colors.onSurface,
      ),
      ObjectState.revealed => _ObjectStyle(
        fill: Color.lerp(colors.surface, colors.onSurface, 0.05)!,
        border: colors.muted,
        foreground: colors.onSurface,
        badge: _MiniBadge('?', colors.muted),
      ),
    };
  }
}

class _ObjectStyle {
  const _ObjectStyle({
    required this.fill,
    required this.border,
    required this.foreground,
    this.borderWidth = 1,
    this.selected = false,
    this.struck = false,
    this.badge,
  });

  final Color fill;
  final Color border;
  final Color foreground;
  final double borderWidth;
  final bool selected;
  final bool struck;
  final Widget? badge;
}

class _Glyph extends StatelessWidget {
  const _Glyph({
    required this.visual,
    required this.glyph,
    required this.color,
    required this.fontSize,
  });

  final ObjectVisual? visual;
  final String glyph;
  final Color color;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return switch (visual) {
      BarVisual(:final height) => LayoutBuilder(
        builder: (context, constraints) => Align(
          alignment: Alignment.bottomCenter,
          child: FractionallySizedBox(
            heightFactor: height.clamp(0.08, 1.0),
            child: Container(
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.75),
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(3),
                ),
              ),
            ),
          ),
        ),
      ),
      EmojiVisual(:final glyph) => Text(
        glyph,
        style: TextStyle(fontSize: fontSize),
        maxLines: 1,
      ),
      TextVisual(:final text) => Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.clip,
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
      ShapeVisual(:final shape) => CustomPaint(
        size: Size.square(fontSize * 1.5),
        painter: _ShapePainter(shape: shape, color: color),
      ),
      null => Text(
        glyph,
        style: TextStyle(fontSize: fontSize, color: color),
        maxLines: 1,
      ),
    };
  }
}

class _ShapePainter extends CustomPainter {
  const _ShapePainter({required this.shape, required this.color});

  final String shape;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = shape == 'bar' ? PaintingStyle.fill : PaintingStyle.stroke
      ..strokeWidth = 2;
    final w = size.width;
    final h = size.height;
    final rect = Rect.fromLTWH(w * 0.15, h * 0.15, w * 0.7, h * 0.7);
    switch (shape) {
      case 'square':
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(3)),
          paint,
        );
      case 'hex':
        final path = Path();
        for (var i = 0; i < 6; i++) {
          final angle = (i / 6) * math.pi * 2 - math.pi / 2;
          final x = w / 2 + (w * 0.38) * math.cos(angle);
          final y = h / 2 + (h * 0.38) * math.sin(angle);
          if (i == 0) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
        }
        path.close();
        canvas.drawPath(path, paint);
      case 'star':
        final path = Path();
        for (var i = 0; i < 10; i++) {
          final radius = i.isEven ? w * 0.42 : w * 0.19;
          final angle = (i / 10) * math.pi * 2 - math.pi / 2;
          final x = w / 2 + radius * math.cos(angle);
          final y = h / 2 + radius * math.sin(angle);
          if (i == 0) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
        }
        path.close();
        canvas.drawPath(path, paint);
      default:
        canvas.drawOval(rect, paint);
    }
  }

  @override
  bool shouldRepaint(_ShapePainter old) =>
      old.shape != shape || old.color != color;
}

/// The two diagonal lines that read as "crossed out".
class _StrikePainter extends CustomPainter {
  const _StrikePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.16)
      ..strokeWidth = 2.5;
    canvas.drawLine(Offset(0, size.height), Offset(size.width, 0), paint);
  }

  @override
  bool shouldRepaint(_StrikePainter oldDelegate) => false;
}

class _MiniBadge extends StatelessWidget {
  const _MiniBadge(this.glyph, this.color);

  final String glyph;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(1.5),
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: Text(
        glyph,
        style: TextStyle(
          fontSize: 8,
          height: 1.1,
          fontWeight: FontWeight.w900,
          color: color.computeLuminance() > 0.6
              ? const Color(0xFF0B0E12)
              : Colors.white,
        ),
      ),
    );
  }
}
