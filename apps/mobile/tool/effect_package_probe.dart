/// Characterizes published effect_core cleanup diagnostics without HTTP/UI.
library;

import 'dart:io';
import 'dart:convert';

import 'package:effect_core/effect_core.dart' as fx;

Object causeDetails(fx.Cause<String> cause) => switch (cause) {
  fx.Expected(:final error) => {'kind': 'expected', 'error': error},
  fx.Defect(:final error) => {'kind': 'defect', 'error': error.toString()},
  fx.Interrupted() => {'kind': 'interrupted'},
  fx.Sequential(:final first, :final second) => {
    'kind': 'sequential',
    'first': causeDetails(first),
    'second': causeDetails(second),
  },
};
Future<void> main() async {
  final results = <String, Object?>{};
  for (final timed in [false, true]) {
    final runtime = fx.Runtime(fx.Unit.value);
    var releases = 0;
    final body = fx.Effect.acquireUseRelease<int, int, String, fx.Unit>(
      fx.Effect.succeed(1),
      (_) => timed
          ? fx.Effect.sleep<String, fx.Unit>(const Duration(seconds: 1))
                .map((_) => 42)
          : fx.Effect.succeed(42),
      (_, _) => fx.Effect.sync<Object?, String, fx.Unit>(() {
        releases++;
        throw StateError('release-defect-marker');
      }),
    );
    try {
      final exit = await runtime.runExit(
        timed
            ? body.timeout(const Duration(milliseconds: 10), () => 'deadline')
            : body,
      );
      results[timed ? 'timeout' : 'normal'] = {
        'release_count': releases,
        'cause': exit is fx.Failure<int, String>
            ? causeDetails(exit.cause)
            : 'success',
        'cause_type': exit is fx.Failure<int, String>
            ? exit.cause.runtimeType.toString()
            : 'success',
      };
    } finally {
      await runtime.shutdown();
    }
  }
  stdout.writeln(jsonEncode(results));
}
