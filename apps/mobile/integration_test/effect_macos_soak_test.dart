import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../tool/effect_soak.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('five-minute native transport and ownership soak', (
    tester,
  ) async {
    await runEffectSoak();
  }, timeout: const Timeout(Duration(minutes: 10)));
}
