import 'package:effect_core/effect_core.dart' as fx;
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final defect in [false, true]) {
    test(
      'timeout retains ${defect ? 'defect' : 'expected'} cleanup without replay',
      () async {
        final runtime = fx.Runtime(fx.Unit.value);
        addTearDown(runtime.shutdown);
        var releases = 0, acquisitions = 0;
        final effect =
            fx.Effect.acquireUseRelease<int, fx.Unit, String, fx.Unit>(
                  fx.Effect.sync(() => ++acquisitions),
                  (_) => fx.Effect.sleep(const Duration(seconds: 1)),
                  (_, _) => fx.Effect.defer(() {
                    releases++;
                    if (defect) {
                      return fx.Effect.sync(() => throw StateError('cleanup'));
                    }
                    return fx.Effect.fail('cleanup');
                  }),
                )
                .timeout(const Duration(milliseconds: 10), () => 'deadline')
                .retry(fx.Schedule(recurrences: 2));
        final exit = await runtime.runExit(effect);
        expect(exit, isA<fx.Failure<fx.Unit, String>>());
        final cause =
            (exit as fx.Failure<fx.Unit, String>).cause
                as fx.Sequential<String>;
        expect((cause.first as fx.Expected<String>).error, 'deadline');
        if (defect) {
          final cleanup = cause.second as fx.Defect<String>;
          expect(cleanup.error, isA<StateError>());
          expect(cleanup.stackTrace.toString(), isNotEmpty);
        } else {
          expect((cause.second as fx.Expected<String>).error, 'cleanup');
        }
        expect(releases, 1);
        expect(acquisitions, 1);
      },
    );
  }
}
