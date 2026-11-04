/// Sequential native checks share one build; PROFILE_WIDGETS enables a short
/// instrumented catalogue trace instead of the uninstrumented 135-board sweep.
library;

import 'effect_macos_benchmark_test.dart' as benchmark;
import 'effect_macos_catalogue_test.dart' as catalogue;
import 'effect_transport_test.dart' as transport;

void main() {
  benchmark.main();
  transport.main();
  catalogue.main();
}
