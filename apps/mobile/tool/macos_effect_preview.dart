/// Native preview against a disposable API without changing device account data.
library;

import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/state/auth_controller.dart';
import 'package:flutter/widgets.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    DsaGameApp(
      api: ApiClient(),
      authTokenStore: MemoryTokenStore(),
      adventureBackend: MemoryBackend(),
    ),
  );
}
