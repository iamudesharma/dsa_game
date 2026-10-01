/// Mobile client for the DSA learning game.
///
/// The whole app is four controllers — auth, the catalogue, the game in
/// flight, and adventure progress — over one [ApiClient]. `main()` reads the base URL from
/// `--dart-define=API_BASE_URL=...` (defaulting to `http://127.0.0.1:8787`, which
/// is right for the iOS simulator, the desktop builds and `flutter run` on the
/// laptop itself) and installs the neutral shell theme, which each generated
/// game then overrides with its own palette.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'adventure/progress_store.dart';
import 'screens/topic_screen.dart';
import 'services/api_client.dart';
import 'state/auth_controller.dart';
import 'state/catalogue_controller.dart';
import 'state/game_controller.dart';
import 'theme/palette.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations(const [
    // Portrait-first: the board, the action bar and the debrief are all laid
    // out for a thumb on a phone, and landscape would strand the controls at
    // the top of the screen.
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  // Progression storage is best-effort: when platform storage is unavailable
  // the app still runs, with progress kept for the session.
  ProgressBackend backend;
  try {
    backend = AdventureKeyBackend(SharedPreferencesStore(await SharedPreferences.getInstance()));
  } catch (_) {
    backend = MemoryBackend();
  }
  runApp(DsaGameApp(adventureBackend: backend));
}

class DsaGameApp extends StatefulWidget {
  const DsaGameApp({this.api, this.adventureBackend, this.authTokenStore, super.key});

  /// Injected by tests so the whole tree can run against a mocked transport;
  /// production leaves it null and gets a client built from [ApiConfig].
  final ApiClient? api;

  /// Injected by tests so progression runs on memory; production passes the
  /// platform-storage backend built in [main].
  final ProgressBackend? adventureBackend;

  /// Injected by tests so sign-in runs on memory. Production leaves it null
  /// and the auth controller persists the session token in platform storage —
  /// which never completes under `flutter_test`, so widget tests must pass
  /// a [MemoryTokenStore] here rather than pumping the real one.
  final TokenStore? authTokenStore;

  @override
  State<DsaGameApp> createState() => _DsaGameAppState();
}

class _DsaGameAppState extends State<DsaGameApp> {
  late final ApiClient _api;
  late final bool _ownsApi;
  late final AuthController _auth;
  late final CatalogueController _catalogue;
  late final GameController _game;
  late final AdventureController _adventure;

  @override
  void initState() {
    super.initState();
    _ownsApi = widget.api == null;
    _api = widget.api ?? ApiClient(config: ApiConfig.defaults);
    _auth = AuthController(_api, tokenStore: widget.authTokenStore);
    _catalogue = CatalogueController(_api);
    _game = GameController(_api);
    _adventure = AdventureController(widget.adventureBackend ?? MemoryBackend());
    // Wins mirror server-side while signed in; first sign-in merges.
    // Local stays the truth either way.
    _auth.attachAdventure(_adventure);
    _auth.boot();
  }

  @override
  void dispose() {
    _auth.dispose();
    _game.dispose();
    _catalogue.dispose();
    _adventure.dispose();
    if (_ownsApi) _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _api),
        ChangeNotifierProvider<AuthController>.value(value: _auth),
        ChangeNotifierProvider<CatalogueController>.value(value: _catalogue),
        ChangeNotifierProvider<GameController>.value(value: _game),
        ChangeNotifierProvider<AdventureController>.value(value: _adventure),
      ],
      child: MaterialApp(
        title: 'DSA by playing',
        debugShowCheckedModeBanner: false,
        theme: buildShellTheme(),
        home: const TopicScreen(),
      ),
    );
  }
}
