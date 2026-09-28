/// Code viewer for `debrief.pseudocode` and `debrief.code`.
///
/// The point of this widget is that a line is a *place*, not a decoration:
/// lines the player actually reached are tinted, lines a mistake ran on are
/// tinted harder and marked, and tapping any line shows the moves that landed
/// on it. Text stays selectable, because a player will want to copy the real
/// implementation out of here.
library;

import 'package:flutter/material.dart';

import '../../models/trace.dart';
import '../../theme/palette.dart';

class CodeBlock extends StatelessWidget {
  const CodeBlock({
    required this.lines,
    required this.frames,
    this.language,
    this.selectedLine,
    this.onSelectLine,
    this.title,
    this.maxHeight = 260,
    super.key,
  });

  final List<String> lines;

  /// The frames that hit each line, indexed by 1-based `codeLine`.
  final List<TraceFrame> frames;

  final String? language;
  final int? selectedLine;
  final ValueChanged<int>? onSelectLine;
  final String? title;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    if (lines.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Color.lerp(colors.surface, Colors.black, 0.2)!,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: colors.muted.withValues(alpha: 0.2)),
        ),
        child: Text(
          'The server did not send this block.',
          style: TextStyle(fontSize: 11.5, color: colors.muted),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Wrap(
            // A `Wrap`, not a `Row`: the legend plus the language tag does not
            // fit a 390px phone on one line, and a clipped legend is worse
            // than one that wraps.
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (title != null)
                Text(
                  title!.toUpperCase(),
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                    color: colors.muted,
                  ),
                ),
              if (language != null) MiniTag(text: language!, color: colors.primary),
              _Legend(color: colors.success, label: 'you reached this'),
              _Legend(color: colors.danger, label: 'a mistake ran here'),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: Color.lerp(colors.surface, Colors.black, 0.28)!,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: colors.muted.withValues(alpha: 0.2)),
          ),
          clipBehavior: Clip.antiAlias,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: maxHeight),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < lines.length; i++)
                    _CodeLine(
                      number: i + 1,
                      code: lines[i],
                      hits: _framesFor(i + 1),
                      selected: selectedLine == i + 1,
                      onTap: onSelectLine == null ? null : () => onSelectLine!(i + 1),
                    ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  List<TraceFrame> _framesFor(int line) =>
      frames.where((f) => f.codeLine == line).toList(growable: false);
}

class _CodeLine extends StatelessWidget {
  const _CodeLine({
    required this.number,
    required this.code,
    required this.hits,
    required this.selected,
    this.onTap,
  });

  final int number;
  final String code;
  final List<TraceFrame> hits;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final mistakes = hits.where((f) => !f.correct).length;
    final reached = hits.isNotEmpty;

    Color? background;
    Color? border;
    if (mistakes > 0) {
      background = colors.danger.withValues(alpha: 0.16);
      border = colors.danger;
    } else if (reached) {
      background = colors.success.withValues(alpha: 0.10);
      border = colors.success;
    }
    if (selected) {
      background = Color.lerp(background ?? Colors.transparent, colors.primary, 0.18);
      border = colors.primary;
    }

    return GestureDetector(
      onTap: onTap,
      child: Container(
        color: background,
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              padding: const EdgeInsets.symmetric(vertical: 1),
              decoration: BoxDecoration(
                color: Color.lerp(colors.surface, colors.onSurface, 0.05),
                border: Border(
                  right: BorderSide(color: (border ?? colors.muted).withValues(alpha: 0.35)),
                  bottom: border == null
                      ? BorderSide(color: colors.muted.withValues(alpha: 0.10))
                      : BorderSide.none,
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Text(
                      '$number',
                      style: TextStyle(
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: reached ? border : colors.muted.withValues(alpha: 0.7),
                      ),
                    ),
                  ),
                  if (mistakes > 0)
                    Padding(
                      padding: const EdgeInsets.only(right: 3),
                      child: Icon(Icons.close_rounded, size: 10, color: border),
                    )
                  else if (reached)
                    Padding(
                      padding: const EdgeInsets.only(right: 4),
                      child: Icon(Icons.check_rounded, size: 10, color: border),
                    ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(9, 1, 9, 1),
                child: SelectableText(
                  code.isEmpty ? ' ' : code,
                  style: TextStyle(
                    fontSize: 11.5,
                    height: 1.4,
                    fontFamily: 'monospace',
                    color: reached ? colors.onSurface : colors.onSurface.withValues(alpha: 0.62),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(fontSize: 9, color: context.gameColors.muted),
        ),
      ],
    );
  }
}

class MiniTag extends StatelessWidget {
  const MiniTag({required this.text, required this.color, super.key});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: color),
      ),
    );
  }
}

/// Caption under a code block describing what happened on [line].
class CodeLineExplainer extends StatelessWidget {
  const CodeLineExplainer({required this.line, required this.frames, required this.onClose, super.key});

  final int line;
  final List<TraceFrame> frames;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final onThisLine = frames.where((f) => f.codeLine == line).toList(growable: false);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 7),
      padding: const EdgeInsets.fromLTRB(10, 8, 6, 9),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, colors.primary, 0.12)!,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: colors.primary.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'LINE $line',
                style: TextStyle(
                  fontSize: 8.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                  color: colors.primary,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                onThisLine.isEmpty
                    ? 'you never reached this line'
                    : '${onThisLine.length} of your moves ran here',
                style: TextStyle(fontSize: 10.5, color: colors.muted),
              ),
              const Spacer(),
              IconButton(
                onPressed: onClose,
                icon: const Icon(Icons.close_rounded, size: 14),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          if (onThisLine.isNotEmpty)
            for (final frame in onThisLine.take(4))
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      frame.correct ? Icons.check_rounded : Icons.close_rounded,
                      size: 11,
                      color: frame.correct ? colors.success : colors.danger,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${frame.dsaOp.wire} · ${frame.note}',
                        style: TextStyle(fontSize: 10.5, height: 1.3, color: colors.onSurface),
                      ),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}
