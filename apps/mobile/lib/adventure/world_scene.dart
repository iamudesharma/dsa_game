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

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
