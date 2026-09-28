/// The hint button and the hint surface it opens.
///
/// `/api/hint` is throttled server-side and returns a one-line nudge plus its
/// source (`laya` or the built-in heuristic). The source is shown, because a
/// hint from the local coach and a hint from a canned heuristic are worth
/// different amounts of trust.
library;

import 'package:flutter/material.dart';

import '../models/provider.dart';
import '../theme/palette.dart';

class HintButton extends StatelessWidget {
  const HintButton({
    required this.onPressed,
    required this.hint,
    required this.source,
    required this.used,
    this.busy = false,
    this.compact = false,
    super.key,
  });

  final VoidCallback? onPressed;
  final String? hint;
  final CoachSource? source;
  final int used;
  final bool busy;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Material(
      color: hint == null
          ? colors.surface
          : Color.lerp(colors.surface, colors.accent, 0.16)!,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 12, vertical: compact ? 7 : 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (busy)
                SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: colors.accent),
                )
              else
                Icon(
                  hint == null ? Icons.lightbulb_outline_rounded : Icons.lightbulb_rounded,
                  size: 16,
                  color: hint == null ? colors.muted : colors.accent,
                ),
              const SizedBox(width: 6),
              Text(
                hint == null ? 'Hint' : 'Hint $used',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: hint == null ? colors.onSurface : colors.accent,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The expanded hint card, with its provenance and a dismiss affordance.
class HintCard extends StatelessWidget {
  const HintCard({required this.hint, required this.source, required this.onDismiss, super.key});

  final String hint;
  final CoachSource? source;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, colors.accent, 0.12)!,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colors.accent.withValues(alpha: 0.45)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'HINT',
                      style: TextStyle(
                        fontSize: 8.5,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.3,
                        color: colors.accent,
                      ),
                    ),
                    if (source != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: source!.isLlm
                              ? colors.primary.withValues(alpha: 0.2)
                              : colors.muted.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(5),
                        ),
                        child: Text(
                          source!.label,
                          style: TextStyle(
                            fontSize: 8.5,
                            fontWeight: FontWeight.w800,
                            color: source!.isLlm ? colors.primary : colors.muted,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  hint,
                  style: TextStyle(fontSize: 12.5, height: 1.35, color: colors.onSurface),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onDismiss,
            icon: const Icon(Icons.close_rounded, size: 16),
            visualDensity: VisualDensity.compact,
            tooltip: 'Dismiss hint',
          ),
        ],
      ),
    );
  }
}
