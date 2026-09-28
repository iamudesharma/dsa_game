/// The generation loading state.
///
/// Tier-1 generation takes seconds, sometimes tens of seconds, and it is the
/// most common first-run wait in the app. A naked `CircularProgressIndicator`
/// tells the player nothing, so this is a themed "summoning" panel: a
/// staggered list of stage messages, an animated glyph, and a live elapsed
/// timer. It respects `MediaQuery.disableAnimations` by swapping the
/// animation for a static one rather than removing the feedback.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/palette.dart';

class GenerationLoader extends StatefulWidget {
  const GenerationLoader({
    required this.problemTitle,
    this.tierNote,
    this.onCancel,
    this.compact = false,
    super.key,
  });

  final String problemTitle;

  /// e.g. "opencode tier" when the catalogue already told us what is available.
  final String? tierNote;

  final VoidCallback? onCancel;
  final bool compact;

  @override
  State<GenerationLoader> createState() => _GenerationLoaderState();
}

class _GenerationLoaderState extends State<GenerationLoader> with SingleTickerProviderStateMixin {
  static const _stages = <String>[
    'asking the game-master for a theme',
    'writing the story and the vocabulary',
    'choosing the interactions to use',
    'laying out the data you will work on',
    'wiring the algorithm pointers',
    'checking the spec is playable',
  ];

  static const _glyphs = <String>['✦', '❖', '⬢', '⟡', '✧', '❋'];

  late final AnimationController _controller;
  Timer? _timer;
  int _stage = 0;
  Duration _elapsed = Duration.zero;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();
    _timer = Timer.periodic(const Duration(milliseconds: 700), (_) {
      if (!mounted) return;
      setState(() {
        _stage = (_stage + 1) % _stages.length;
        _elapsed += const Duration(milliseconds: 700);
      });
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final seconds = _elapsed.inSeconds;

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(widget.compact ? 16 : 22),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, Colors.black, 0.25)!,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colors.primary.withValues(alpha: 0.4)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 64,
            height: 64,
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                final t = reduceMotion ? 0.5 : _controller.value;
                final glyph = _glyphs[_stage % _glyphs.length];
                return Transform.rotate(
                  angle: t * 6.2831853,
                  child: Container(
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: colors.primary.withValues(alpha: 0.14),
                      border: Border.all(
                        color: Color.lerp(colors.primary, colors.accent, t)!,
                        width: 2,
                      ),
                    ),
                    // Counter-rotate the glyph so it stays upright.
                    child: Transform.rotate(
                      angle: -t * 6.2831853,
                      child: Text(
                        glyph,
                        style: TextStyle(
                          fontSize: 22,
                          color: Color.lerp(colors.primary, colors.accent, t),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'Building ${widget.problemTitle}',
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.onSurface),
          ),
          const SizedBox(height: 4),
          Text(
            widget.tierNote ?? 'a provider tier is writing the spec',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: colors.muted),
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < _stages.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Row(
                children: [
                  SizedBox(
                    width: 16,
                    child: i <= _stage
                        ? Icon(
                            i < _stage ? Icons.check_rounded : Icons.more_horiz_rounded,
                            size: 13,
                            color: i < _stage ? colors.success : colors.accent,
                          )
                        : Icon(Icons.circle_outlined, size: 7, color: colors.muted.withValues(alpha: 0.4)),
                  ),
                  Expanded(
                    child: Text(
                      _stages[i],
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: i == _stage ? FontWeight.w800 : FontWeight.w500,
                        color: i <= _stage
                            ? colors.onSurface.withValues(alpha: i == _stage ? 1 : 0.65)
                            : colors.muted.withValues(alpha: 0.45),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _Elapsed(seconds: seconds),
              if (widget.onCancel != null) ...[
                const SizedBox(width: 10),
                TextButton(
                  onPressed: widget.onCancel,
                  child: const Text('Cancel', style: TextStyle(fontSize: 11.5)),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _Elapsed extends StatelessWidget {
  const _Elapsed({required this.seconds});

  final int seconds;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final slow = seconds > 12;
    return Text(
      '${seconds}s',
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w800,
        fontFamily: 'monospace',
        color: slow ? colors.accent : colors.muted,
      ),
    );
  }
}
