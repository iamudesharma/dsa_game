/// Layout + painting for linked-list boards.
///
/// Node positions are computed in Dart rather than left to a `Wrap` so the
/// painter and the hit-test agree on where every node is. Edges are routed
/// orthogonally (with a vertical jog when the list wraps) because a curved
/// bezier through a 44px cell reads as noise on a phone.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/state.dart';

/// Where each node sits, in board-local coordinates.
class NodeLayout {
  const NodeLayout({required this.ids, required this.rects, required this.cellSize, required this.badgeSpace});

  factory NodeLayout.compute({
    required List<String> ids,
    required double width,
    double maxCellWidth = 76,
    double minCellWidth = 46,
    double cellHeight = 48,
    double gap = 30,
    double rowGap = 34,
    double badgeSpace = 14,
  }) {
    if (ids.isEmpty) {
      return const NodeLayout(ids: [], rects: {}, cellSize: Size.zero, badgeSpace: 0);
    }
    // Fit as many per row as possible at a legible width.
    var cols = 1;
    while (cols < ids.length && (cellWidthFor(width, cols + 1, minCellWidth, maxCellWidth, gap)) > 0) {
      cols++;
    }
    final cellWidth = cellWidthFor(width, cols, minCellWidth, maxCellWidth, gap);
    final rects = <String, Rect>{};
    for (var i = 0; i < ids.length; i++) {
      final row = i ~/ cols;
      final col = i % cols;
      final left = col * (cellWidth + gap) + (width - (cellWidth * cols + gap * (cols - 1))) / 2;
      final top = row * (cellHeight + rowGap) + badgeSpace;
      rects[ids[i]] = Rect.fromLTWH(left, top, cellWidth, cellHeight);
    }
    return NodeLayout(
      ids: ids,
      rects: Map.unmodifiable(rects),
      cellSize: Size(cellWidth, cellHeight),
      badgeSpace: badgeSpace,
    );
  }

  static double cellWidthFor(
    double width,
    int cols,
    double minCellWidth,
    double maxCellWidth,
    double gap,
  ) {
    if (cols <= 1) return math.min(width, maxCellWidth);
    final available = width - gap * (cols - 1);
    final ideal = available / cols;
    // Too many columns would squeeze the labels; the caller reduces `cols`
    // instead. A non-positive width means "this column count does not fit".
    return ideal < minCellWidth ? -1 : math.min(ideal, maxCellWidth);
  }

  final List<String> ids;
  final Map<String, Rect> rects;
  final Size cellSize;
  final double badgeSpace;

  double get width => cellSize.width;

  double get height {
    if (rects.isEmpty) return 0;
    return rects.values.map((r) => r.bottom).reduce(math.max) + badgeSpace;
  }

  /// The node under [point], or `null`.
  String? hitTest(Offset point, {double slop = 8}) {
    for (final entry in rects.entries) {
      if (entry.value.inflate(slop).contains(point)) return entry.key;
    }
    return null;
  }

  /// Straight-line distance from a node's edge, used to bias hit-testing
  /// towards the node the player is aiming at.
  Offset anchorOf(String id, {bool towards = true}) {
    final rect = rects[id];
    if (rect == null) return Offset.zero;
    return towards
        ? Offset(rect.right, rect.center.dy)
        : Offset(rect.left, rect.center.dy);
  }
}

/// Draws `next` / `prev` edges and, while the player is dragging, a live
/// pointer from the source node to the current finger position.
class LinkPainter extends CustomPainter {
  const LinkPainter({
    required this.layout,
    required this.links,
    required this.nextColor,
    required this.prevColor,
    required this.dimmed,
    this.dragFromId,
    this.dragPoint,
    this.dragColor,
    this.snapTargetId,
  });

  final NodeLayout layout;
  final List<Link> links;
  final Color nextColor;
  final Color prevColor;

  /// Ids drawn faint (not part of the current list).
  final Set<String> dimmed;

  final String? dragFromId;
  final Offset? dragPoint;
  final Color? dragColor;
  final String? snapTargetId;

  @override
  void paint(Canvas canvas, Size size) {
    for (final link in links) {
      final from = layout.rects[link.from];
      final to = layout.rects[link.to];
      if (from == null || to == null) continue;
      // A rewired list can hold both a `next` and a `prev` edge between the
      // same pair; drawing both is correct, but only once each.
      final faint = dimmed.contains(link.from) || dimmed.contains(link.to);
      final color = faint ? nextColor.withValues(alpha: 0.18) : (link.kind == LinkKind.next ? nextColor : prevColor);
      final path = route(from, to, link.kind);
      canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = faint ? 1.2 : 2
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round,
      );
      _arrowHead(canvas, path, color, faint ? 0.18 : 0.9);
    }

    final from = dragFromId;
    final point = dragPoint;
    if (from != null && point != null && layout.rects[from] != null) {
      final color = dragColor ?? nextColor;
      final target = snapTargetId == null ? null : layout.rects[snapTargetId!];
      final path = target != null
          ? _routeBetween(layout.rects[from]!, target, snapForward: true)
          : Path()
            ..moveTo(layout.rects[from]!.center.dx, layout.rects[from]!.center.dy)
            ..lineTo(point.dx, point.dy);
      canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.4
          ..strokeCap = StrokeCap.round,
      );
      if (target == null) {
        canvas.drawCircle(point, 5, Paint()..color = color.withValues(alpha: 0.55));
      } else {
        canvas.drawRRect(
          RRect.fromRectAndRadius(target.inflate(3), const Radius.circular(13)),
          Paint()
            ..color = color
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2,
        );
      }
    }
  }

  /// `next` edges leave from the right, `prev` edges from the left.
  Path route(Rect from, Rect to, LinkKind kind) =>
      _routeBetween(from, to, snapForward: kind == LinkKind.next);

  static Path _routeBetween(Rect from, Rect to, {required bool snapForward}) {
    final path = Path();
    final sameRow = (from.center.dy - to.center.dy).abs() < 2;
    final start = Offset(
      snapForward ? from.right : from.left,
      from.center.dy,
    );
    final end = Offset(
      snapForward ? to.left : to.right,
      to.center.dy,
    );
    path.moveTo(start.dx, start.dy);
    if (sameRow) {
      path.lineTo(end.dx, end.dy);
    } else {
      // Horizontal, vertical, horizontal — a right-angled jog that stays
      // readable even when the list wraps to a second row.
      final midX = (start.dx + end.dx) / 2;
      path.lineTo(midX, start.dy);
      path.lineTo(midX, end.dy);
      path.lineTo(end.dx, end.dy);
    }
    return path;
  }

  void _arrowHead(Canvas canvas, Path path, Color color, double opacity) {
    // `computeMetrics()` is a lazily computed iterable: asking `isEmpty` and
    // then `last` walks it twice and the second walk comes up empty, so
    // materialise it once.
    final metrics = path.computeMetrics().toList(growable: false);
    if (metrics.isEmpty) return;
    final metric = metrics.last;
    const length = 11.0;
    final tangent = metric.getTangentForOffset(math.max(0, metric.length - 0.5));
    if (tangent == null) return;
    final angle = tangent.angle;
    final tip = tangent.position;
    final paint = Paint()..color = color.withValues(alpha: opacity);
    canvas.drawPath(
      Path()
        ..moveTo(tip.dx, tip.dy)
        ..lineTo(
          tip.dx - length * math.cos(angle - 0.42),
          tip.dy - length * math.sin(angle - 0.42),
        )
        ..lineTo(
          tip.dx - length * math.cos(angle + 0.42),
          tip.dy - length * math.sin(angle + 0.42),
        )
        ..close(),
      paint,
    );
  }

  @override
  bool shouldRepaint(LinkPainter old) =>
      old.layout != layout ||
      old.links != links ||
      old.nextColor != nextColor ||
      old.prevColor != prevColor ||
      old.dragFromId != dragFromId ||
      old.dragPoint != dragPoint ||
      old.snapTargetId != snapTargetId ||
      old.dimmed != dimmed;
}
