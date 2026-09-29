/// The small robot guide: onboarding, hints and celebrations.
///
/// Purely presentational — it renders validated guidance text handed to it by
/// the caller and never invents algorithm advice of its own. Built from
/// composed shapes so it needs no image assets.
library;

import 'package:flutter/material.dart';

class RobotGuide extends StatelessWidget {
  const RobotGuide({super.key, this.text, this.size = 52});

  /// Optional guidance line shown next to the robot.
  final String? text;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        CustomPaint(
          size: Size(size, size * 1.1),
          painter: _RobotPainter(),
        ),
        if (text != null && text!.isNotEmpty) ...[
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text!,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.85),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _RobotPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final outline = Paint()
      ..color = const Color(0xFF24344B)
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.055
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final body = Paint()..color = const Color(0xFFF5CC76);
    final visor = Paint()..color = const Color(0xFF24344B);
    final eye = Paint()..color = const Color(0xFFFFF6E4);

    final cx = w / 2;
    // Antenna.
    canvas.drawLine(Offset(cx, w * 0.28), Offset(cx, w * 0.12), outline);
    canvas.drawCircle(Offset(cx, w * 0.08), w * 0.07, Paint()..color = const Color(0xFFEF946B));
    // Body.
    final bodyRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(w * 0.12, w * 0.28, w * 0.76, w * 0.55),
      Radius.circular(w * 0.18),
    );
    canvas.drawRRect(bodyRect, body);
    canvas.drawRRect(bodyRect, outline);
    // Visor + eyes.
    final visorRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(w * 0.26, w * 0.43, w * 0.48, w * 0.24),
      Radius.circular(w * 0.1),
    );
    canvas.drawRRect(visorRect, visor);
    canvas.drawCircle(Offset(w * 0.4, w * 0.55), w * 0.05, eye);
    canvas.drawCircle(Offset(w * 0.6, w * 0.55), w * 0.05, eye);
    // Legs.
    canvas.drawLine(Offset(w * 0.32, w * 0.83), Offset(w * 0.32, w * 0.98), outline);
    canvas.drawLine(Offset(w * 0.68, w * 0.83), Offset(w * 0.68, w * 0.98), outline);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
