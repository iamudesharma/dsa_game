/// Keep host desktop events out of synthetic native journeys.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void configureNativeTest(IntegrationTestWidgetsFlutterBinding binding) {
  binding.shouldPropagateDevicePointerEvents = false;
  setUpAll(() async {
    const delay = int.fromEnvironment('NATIVE_SETUP_DELAY_MS');
    if (delay > 0) {
      debugPrint('NATIVE_PREPARE_VISIBILITY');
      // Allow the OS accessibility observer and foreground window to settle
      // before WidgetTester records its initial platform semantics handles.
      await Future<void>.delayed(const Duration(milliseconds: delay));
      debugPrint(
        'NATIVE_READY:semantics=${binding.debugOutstandingSemanticsHandles}',
      );
    }
  });
}
