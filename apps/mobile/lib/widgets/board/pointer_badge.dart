/// The visual identity of an algorithm pointer (lo / mid / hi / i / j / best /
/// node / prev). One source of truth so the board, the algorithm strip and the
/// trace rail all colour the same pointer the same way.
library;

import 'package:flutter/material.dart';

import '../../models/state.dart';
import '../../theme/palette.dart';

Color pointerColor(GameColors colors, CursorPointer pointer) => switch (pointer) {
  CursorPointer.lo => colors.primary,
  CursorPointer.mid => colors.accent,
  CursorPointer.hi => _mix(colors.primary, Colors.purple, 0.65),
  CursorPointer.i => _mix(colors.primary, Colors.teal, 0.7),
  CursorPointer.j => _mix(colors.primary, Colors.pink, 0.7),
  CursorPointer.best => colors.success,
  CursorPointer.node => colors.accent,
  CursorPointer.prevNode => colors.muted,
};

Color _mix(Color a, Color b, double t) => Color.lerp(a, b, t)!;

/// A pointer chip drawn over the thing it points at.
class PointerBadge extends StatelessWidget {
  const PointerBadge({required this.pointer, required this.color, this.dense = false, super.key});

  final CursorPointer pointer;
  final Color color;

  /// [dense] drops the horizontal padding for tight layouts.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 4 : 6, vertical: 1),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(6),
        boxShadow: [
          BoxShadow(color: color.withValues(alpha: 0.45), blurRadius: 6, spreadRadius: -1),
        ],
      ),
      child: Text(
        pointer.badge,
        textAlign: TextAlign.center,
        style: TextStyle(
          color: _readable(color),
          fontSize: dense ? 9 : 10,
          fontWeight: FontWeight.w800,
          height: 1.25,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}

Color _readable(Color background) =>
    background.computeLuminance() > 0.6 ? const Color(0xFF0B0E12) : Colors.white;
