/// Illustrated scenery for each topic world, drawn with [CustomPainter].
///
/// Decorative only: real game values always remain accessible widgets elsewhere.
/// The scenes echo the web client's SVG worlds (orchard crates, sorting bench,
/// stack blocks, queue figures, observatory beacon, railway carriages) so the
/// two clients feel like one adventure.
library;

import 'package:flutter/material.dart';

import '../models/enums.dart';
import 'worlds.dart';

class WorldScene extends StatelessWidget {
  const WorldScene({required this.world, this.height = 120, super.key});

  final WorldDefinition world;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(painter: _WorldPainter(world)),
    );
  }
}

class _WorldPainter extends CustomPainter {
  _WorldPainter(this.world);

  final WorldDefinition world;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final ink = Paint()
      ..color = const Color(0xFF24344B)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final accent = Paint()..color = world.color;
    // Ground.
    canvas.drawOval(Rect.fromCenter(center: Offset(w / 2, h * 0.88), width: w * 0.8, height: h * 0.14), accent..style = PaintingStyle.fill);
    accent.style = PaintingStyle.stroke;
    switch (world.topic) {
      case DsaTopic.arrays:
        _crates(canvas, w, h, ink);
      case DsaTopic.sorting:
        _bench(canvas, w, h, ink);
      case DsaTopic.stack:
        _tower(canvas, w, h, ink);
      case DsaTopic.queue:
        _line(canvas, w, h, ink);
      case DsaTopic.binarySearch:
        _observatory(canvas, w, h, ink);
      case DsaTopic.linkedList:
        _railway(canvas, w, h, ink);
      case DsaTopic.hashTable:
        _bazaar(canvas, w, h, ink);
      case DsaTopic.strings:
        _atelier(canvas, w, h, ink);
      case DsaTopic.trees:
        _canopy(canvas, w, h, ink);
      case DsaTopic.heap:
        _foundry(canvas, w, h, ink);
      case DsaTopic.graphs:
        _archipelago(canvas, w, h, ink);
      case DsaTopic.dp:
        _observatorySteps(canvas, w, h, ink);
      case DsaTopic.backtracking:
        _maze(canvas, w, h, ink);
      case DsaTopic.greedy:
        _frontier(canvas, w, h, ink);
      case DsaTopic.bitManip:
        _forge(canvas, w, h, ink);
      case DsaTopic.trie:
        _grove(canvas, w, h, ink);
    }
  }

  void _rr(Canvas c, Rect r, double radius, Color fill, Paint ink) {
    final rr = RRect.fromRectAndRadius(r, Radius.circular(radius));
    c.drawRRect(rr, Paint()..color = fill);
    c.drawRRect(rr, ink);
  }

  /// Numbered crates in clearly indexed slots.
  void _crates(Canvas c, double w, double h, Paint ink) {
    const fills = [Color(0xFFEAC28B), Color(0xFFF5CD7D), Color(0xFFEAC28B)];
    for (var i = 0; i < 3; i++) {
      final x = w * (0.2 + 0.22 * i);
      final r = Rect.fromLTWH(x, h * 0.38, w * 0.16, h * 0.42);
      _rr(c, r, 5, fills[i], ink);
      c.drawLine(Offset(x + 5, h * 0.44), Offset(x + w * 0.16 - 5, h * 0.74), ink..strokeWidth = 2);
      c.drawLine(Offset(x + w * 0.16 - 5, h * 0.44), Offset(x + 5, h * 0.74), ink);
      ink.strokeWidth = 3;
    }
  }

  /// Pieces moving along a sorting bench.
  void _bench(Canvas c, double w, double h, Paint ink) {
    final bench = Rect.fromLTWH(w * 0.14, h * 0.68, w * 0.72, h * 0.1);
    _rr(c, bench, 5, const Color(0xFFC08A61), ink);
    const heights = [0.22, 0.34, 0.48, 0.3];
    const fills = [Color(0xFFEFAA66), Color(0xFFED8368), Color(0xFF9FBF98), Color(0xFF91AFD8)];
    for (var i = 0; i < 4; i++) {
      final bh = h * heights[i];
      _rr(c, Rect.fromLTWH(w * (0.2 + 0.15 * i), h * 0.68 - bh, w * 0.11, bh), 5, fills[i], ink);
    }
  }

  /// Blocks added and removed at the top.
  void _tower(Canvas c, double w, double h, Paint ink) {
    const fills = [Color(0xFFA496CD), Color(0xFFC1B4E3), Color(0xFFE0CEF0)];
    for (var i = 0; i < 3; i++) {
      _rr(c, Rect.fromLTWH(w * 0.35, h * (0.62 - 0.19 * i), w * 0.3, h * 0.17), 6, fills[2 - i], ink);
    }
    // Drop arrow above the top block.
    c.drawLine(Offset(w * 0.5, h * 0.02), Offset(w * 0.5, h * 0.12), ink);
    c.drawLine(Offset(w * 0.46, h * 0.08), Offset(w * 0.5, h * 0.12), ink);
    c.drawLine(Offset(w * 0.54, h * 0.08), Offset(w * 0.5, h * 0.12), ink);
  }

  /// Characters entering at the rear, leaving at the front.
  void _line(Canvas c, double w, double h, Paint ink) {
    const fills = [Color(0xFF8FC8BD), Color(0xFFF5CD7D), Color(0xFFE5A3A1), Color(0xFFAABBE7)];
    for (var i = 0; i < 4; i++) {
      final x = w * (0.16 + 0.18 * i);
      _rr(c, Rect.fromLTWH(x, h * 0.5, w * 0.13, h * 0.3), 10, fills[i], ink);
      c.drawCircle(Offset(x + w * 0.065, h * 0.4), w * 0.045, Paint()..color = const Color(0xFFFFF3DB));
      c.drawCircle(Offset(x + w * 0.065, h * 0.4), w * 0.045, ink);
    }
    c.drawLine(Offset(w * 0.06, h * 0.6), Offset(w * 0.12, h * 0.6), ink);
    c.drawLine(Offset(w * 0.88, h * 0.6), Offset(w * 0.94, h * 0.6), ink);
  }

  /// Numbered beacons inside a visibly shrinking search range.
  void _observatory(Canvas c, double w, double h, Paint ink) {
    // Telescope.
    final scope = RRect.fromRectAndRadius(Rect.fromLTWH(w * 0.38, h * 0.3, w * 0.32, h * 0.2), const Radius.circular(6));
    c.drawRRect(scope, Paint()..color = const Color(0xFF94ACE0));
    c.drawRRect(scope, ink);
    // Tripod.
    c.drawLine(Offset(w * 0.5, h * 0.5), Offset(w * 0.42, h * 0.85), ink);
    c.drawLine(Offset(w * 0.5, h * 0.5), Offset(w * 0.58, h * 0.85), ink);
    // Range brackets + beacon.
    c.drawLine(Offset(w * 0.14, h * 0.3), Offset(w * 0.14, h * 0.7), ink);
    c.drawLine(Offset(w * 0.86, h * 0.3), Offset(w * 0.86, h * 0.7), ink);
    c.drawCircle(Offset(w * 0.24, h * 0.5), 6, Paint()..color = const Color(0xFFF6CD79));
    c.drawCircle(Offset(w * 0.24, h * 0.5), 6, ink);
    c.drawCircle(Offset(w * 0.78, h * 0.28), 3, Paint()..color = const Color(0xFFF6CD79));
  }

  /// Connected carriages with explicit directional links.
  void _railway(Canvas c, double w, double h, Paint ink) {
    c.drawLine(Offset(w * 0.08, h * 0.8), Offset(w * 0.92, h * 0.8), ink);
    const fills = [Color(0xFFD897B1), Color(0xFFEDC188), Color(0xFF9EC8BC)];
    for (var i = 0; i < 3; i++) {
      final x = w * (0.12 + 0.28 * i);
      _rr(c, Rect.fromLTWH(x, h * 0.42, w * 0.22, h * 0.32), 8, fills[i], ink);
      if (i < 2) {
        final y = h * 0.58;
        c.drawLine(Offset(x + w * 0.22, y), Offset(x + w * 0.28, y), ink);
        c.drawLine(Offset(x + w * 0.255, y - 5), Offset(x + w * 0.28, y), ink);
        c.drawLine(Offset(x + w * 0.255, y + 5), Offset(x + w * 0.28, y), ink);
      }
    }
  }

  /// Market buckets: some hold a count, some stand empty.
  void _bazaar(Canvas c, double w, double h, Paint ink) {
    const fills = [Color(0xFFE8C87E), Color(0xFFD9B36A), Color(0xFFE8C87E), Color(0xFFD9B36A)];
    for (var i = 0; i < 4; i++) {
      final x = w * (0.1 + 0.2 * i);
      _rr(c, Rect.fromLTWH(x, h * 0.5, w * 0.15, h * 0.3), 6, fills[i], ink);
      if (i.isEven) {
        c.drawCircle(Offset(x + w * 0.075, h * 0.62), 3.5, Paint()..color = const Color(0xFF7A5C2E));
      }
    }
  }

  /// Letter beads on a string, read from both ends toward the middle.
  void _atelier(Canvas c, double w, double h, Paint ink) {
    c.drawLine(Offset(w * 0.08, h * 0.55), Offset(w * 0.92, h * 0.55), ink);
    for (var i = 0; i < 5; i++) {
      final x = w * (0.16 + 0.17 * i);
      final middle = i == 2;
      c.drawCircle(Offset(x, h * 0.55), middle ? 11 : 8, Paint()..color = middle ? const Color(0xFF9FC7A8) : const Color(0xFFFFF3DB));
      c.drawCircle(Offset(x, h * 0.55), middle ? 11 : 8, ink);
    }
  }

  /// One canopy triangle over a trunk: branch down from the root.
  void _canopy(Canvas c, double w, double h, Paint ink) {
    c.drawLine(Offset(w * 0.5, h * 0.82), Offset(w * 0.5, h * 0.5), ink);
    final canopy = Path()
      ..moveTo(w * 0.5, h * 0.12)
      ..lineTo(w * 0.78, h * 0.55)
      ..lineTo(w * 0.22, h * 0.55)
      ..close();
    c.drawPath(canopy, Paint()..color = const Color(0xFF9FC7A8));
    c.drawPath(canopy, ink);
    c.drawCircle(Offset(w * 0.5, h * 0.34), 4, Paint()..color = const Color(0xFFFFF3DB));
    c.drawCircle(Offset(w * 0.5, h * 0.34), 4, ink);
  }

  /// A foundry pile: the k largest stay on top.
  void _foundry(Canvas c, double w, double h, Paint ink) {
    const rows = [1, 2, 3];
    for (var row = 0; row < 3; row++) {
      for (var i = 0; i < rows[row]; i++) {
        final x = w * (0.5 + (i - (rows[row] - 1) / 2) * 0.18);
        final y = h * (0.3 + row * 0.2);
        c.drawCircle(Offset(x, y), 9, Paint()..color = const Color(0xFFE3A9BC));
        c.drawCircle(Offset(x, y), 9, ink);
      }
    }
  }

  /// Three islands joined by dotted bridges.
  void _archipelago(Canvas c, double w, double h, Paint ink) {
    final islands = [Offset(w * 0.2, h * 0.6), Offset(w * 0.5, h * 0.42), Offset(w * 0.8, h * 0.6)];
    for (var i = 0; i + 1 < islands.length; i++) {
      final a = islands[i];
      final b = islands[i + 1];
      for (var t = 0.15; t < 0.9; t += 0.18) {
        c.drawCircle(Offset(a.dx + (b.dx - a.dx) * t, a.dy + (b.dy - a.dy) * t), 1.8, Paint()..color = const Color(0xFF24344B));
      }
    }
    for (final spot in islands) {
      c.drawOval(Rect.fromCenter(center: spot, width: w * 0.22, height: h * 0.16), Paint()..color = const Color(0xFFA9CCE8));
      c.drawOval(Rect.fromCenter(center: spot, width: w * 0.22, height: h * 0.16), ink);
    }
  }

  /// Observatory steps: small answers climbing to a big one.
  void _observatorySteps(Canvas c, double w, double h, Paint ink) {
    for (var i = 0; i < 4; i++) {
      final step = Rect.fromLTWH(w * (0.14 + 0.17 * i), h * (0.72 - 0.12 * i), w * 0.15, h * (0.1 + 0.12 * i));
      _rr(c, step, 4, Color.lerp(const Color(0xFFD9CFF0), const Color(0xFF5D4A7D), i / 3)!, ink);
    }
    c.drawCircle(Offset(w * 0.82, h * 0.2), 5, Paint()..color = const Color(0xFFF6CD79));
    c.drawCircle(Offset(w * 0.82, h * 0.2), 5, ink);
  }

  /// A fork with one path crossed out: choose, explore, undo.
  void _maze(Canvas c, double w, double h, Paint ink) {
    c.drawLine(Offset(w * 0.2, h * 0.8), Offset(w * 0.45, h * 0.5), ink);
    c.drawLine(Offset(w * 0.45, h * 0.5), Offset(w * 0.3, h * 0.2), ink);
    c.drawLine(Offset(w * 0.45, h * 0.5), Offset(w * 0.72, h * 0.3), ink);
    final bad = Offset(w * 0.3, h * 0.2);
    c.drawLine(Offset(bad.dx - 7, bad.dy - 7), Offset(bad.dx + 7, bad.dy + 7), ink);
    c.drawLine(Offset(bad.dx - 7, bad.dy + 7), Offset(bad.dx + 7, bad.dy - 7), ink);
    c.drawCircle(Offset(w * 0.72, h * 0.3), 6, Paint()..color = const Color(0xFF9FC7A8));
    c.drawCircle(Offset(w * 0.72, h * 0.3), 6, ink);
  }

  /// One long arrow to a flag: how far can you reach?
  void _frontier(Canvas c, double w, double h, Paint ink) {
    c.drawLine(Offset(w * 0.12, h * 0.6), Offset(w * 0.78, h * 0.6), ink);
    c.drawLine(Offset(w * 0.7, h * 0.53), Offset(w * 0.78, h * 0.6), ink);
    c.drawLine(Offset(w * 0.7, h * 0.67), Offset(w * 0.78, h * 0.6), ink);
    c.drawLine(Offset(w * 0.82, h * 0.6), Offset(w * 0.82, h * 0.3), ink);
    final flag = Path()
      ..moveTo(w * 0.82, h * 0.3)
      ..lineTo(w * 0.94, h * 0.36)
      ..lineTo(w * 0.82, h * 0.42)
      ..close();
    c.drawPath(flag, Paint()..color = const Color(0xFF9FC7A8));
    c.drawPath(flag, ink);
  }

  /// Bit blocks: filled and outline squares folding down to one.
  void _forge(Canvas c, double w, double h, Paint ink) {
    for (var i = 0; i < 5; i++) {
      final r = Rect.fromLTWH(w * (0.12 + 0.15 * i), h * 0.45, w * 0.11, h * 0.22);
      if (i.isEven) {
        c.drawRect(r, Paint()..color = const Color(0xFF9AA1B5));
      }
      c.drawRect(r, ink);
    }
    c.drawCircle(Offset(w * 0.5, h * 0.78), 5, Paint()..color = const Color(0xFFF6CD79));
    c.drawCircle(Offset(w * 0.5, h * 0.78), 5, ink);
  }

  /// A grove sapling: one root, shared branches, leaf completions.
  void _grove(Canvas c, double w, double h, Paint ink) {
    final root = Offset(w * 0.5, h * 0.78);
    final forks = [Offset(w * 0.3, h * 0.5), Offset(w * 0.5, h * 0.44), Offset(w * 0.7, h * 0.5)];
    for (final fork in forks) {
      c.drawLine(root, fork, ink);
      c.drawLine(fork, Offset(fork.dx - 0.08 * w, fork.dy - h * 0.18), ink);
      c.drawLine(fork, Offset(fork.dx + 0.08 * w, fork.dy - h * 0.18), ink);
      for (final dx in [-0.08, 0.08]) {
        final leaf = Offset(fork.dx + dx * w, fork.dy - h * 0.18);
        c.drawCircle(leaf, 4, Paint()..color = const Color(0xFF9FC7A8));
        c.drawCircle(leaf, 4, ink);
      }
    }
    c.drawCircle(root, 5, Paint()..color = const Color(0xFFFFF3DB));
    c.drawCircle(root, 5, ink);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
