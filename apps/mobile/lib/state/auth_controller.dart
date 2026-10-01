/// Session state for the whole app.
///
/// Play stays anonymous: this only gates resume/interview. The token lives in
/// platform storage (`shared_preferences`, best-effort like everything else
/// in this client); on boot a stored token revalidates against
/// `/api/auth/me`, and the first sign-in merges device-local progress
/// server-side. Wins after that mirror up best-effort — local is the truth.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../adventure/progress_store.dart';
import '../models/account.dart';
import '../services/api_client.dart';
import '../services/api_exception.dart';

const String _tokenKey = 'dsa-auth-token';

/// Token persistence surface. Production uses `shared_preferences` through
/// [SharedPreferencesTokenStore]; tests use [MemoryTokenStore].
abstract class TokenStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();
}

class SharedPreferencesTokenStore implements TokenStore {
  @override
  Future<String?> read() async {
    try {
      return (await SharedPreferences.getInstance()).getString(_tokenKey);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String token) async {
    try {
      await (await SharedPreferences.getInstance()).setString(_tokenKey, token);
    } catch (_) {
      // Private-mode style failure: the in-memory session still works.
    }
  }

  @override
  Future<void> clear() async {
    try {
      await (await SharedPreferences.getInstance()).remove(_tokenKey);
    } catch (_) {
      // ignore
    }
  }
}

class MemoryTokenStore implements TokenStore {
  String? _token;

  @override
  Future<String?> read() async => _token;

  @override
  Future<void> write(String token) async => _token = token;

  @override
  Future<void> clear() async => _token = null;
}

class AuthController extends ChangeNotifier {
  AuthController(this._api, {TokenStore? tokenStore}) : _tokens = tokenStore ?? SharedPreferencesTokenStore();

  final ApiClient _api;
  final TokenStore _tokens;

  AuthUser? _user;
  bool _ready = false;
  bool _busy = false;
  ApiException? _error;
  bool _disposed = false;

  AdventureController? _adventure;
  Map<String, String> _lastPosted = const {};
  bool _posting = false;
  String? _syncedUserId;

  AuthUser? get user => _user;
  bool get signedIn => _user != null;
  bool get ready => _ready;
  bool get busy => _busy;
  ApiException? get error => _error;

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _adventure?.removeListener(_onAdventureChanged);
    super.dispose();
  }

  /// Revalidates a stored token. A dead token clears silently — signed-out is
  /// a normal state, not an error worth surfacing.
  Future<void> boot() async {
    final token = await _tokens.read();
    if (token == null || token.isEmpty) {
      _ready = true;
      _notify();
      return;
    }
    _api.setAuthToken(token);
    try {
      final me = await _api.me();
      _user = me.user;
      _syncedUserId = me.user.id;
      // Adopt whatever the server already holds (other device played since).
      _adventure?.mergeCompleted(me.progress);
      _lastPosted = Map<String, String>.of(_adventure?.progress.completed ?? me.progress);
    } on ApiException {
      _api.setAuthToken(null);
      await _tokens.clear();
      _user = null;
    }
    _ready = true;
    _notify();
  }

  /// Watches adventure progress so wins mirror server-side while signed in.
  /// Local is the truth; a failed post is dropped, never retried loudly.
  void attachAdventure(AdventureController adventure) {
    if (identical(_adventure, adventure)) return;
    _adventure?.removeListener(_onAdventureChanged);
    _adventure = adventure;
    adventure.addListener(_onAdventureChanged);
  }

  void _onAdventureChanged() {
    final adventure = _adventure;
    final user = _user;
    if (adventure == null || user == null || _posting) return;
    final completed = adventure.progress.completed;
    if (_mapsEqual(completed, _lastPosted)) return;
    _posting = true;
    _lastPosted = Map<String, String>.of(completed);
    unawaited(
      _api.pushProgress(completed).then((_) {}).catchError((_) {}).whenComplete(() {
        _posting = false;
        // A win that landed mid-post posts on the next change notification.
      }),
    );
  }

  static bool _mapsEqual(Map<String, String> a, Map<String, String> b) {
    if (a.length != b.length) return false;
    for (final entry in a.entries) {
      if (b[entry.key] != entry.value) return false;
    }
    return true;
  }

  /// First-login merge: pushes the device-local map, adopts the union.
  /// Runs once per sign-in; sign-out leaves local play untouched.
  Future<void> _mergeAfterSignIn() async {
    final adventure = _adventure;
    final user = _user;
    if (adventure == null || user == null || _syncedUserId == user.id) return;
    _syncedUserId = user.id;
    try {
      final union = await _api.pushProgress(adventure.progress.completed);
      adventure.mergeCompleted(union);
      _lastPosted = Map<String, String>.of(adventure.progress.completed);
    } on ApiException {
      // Offline or expired: local play continues; merge retries next sign-in.
      _syncedUserId = null;
    }
  }

  Future<bool> signup({required String email, required String password}) async {
    if (_busy) return false;
    _busy = true;
    _error = null;
    _notify();
    try {
      final res = await _api.signup(email: email.trim(), password: password);
      await _adoptSession(res);
      return true;
    } on ApiException catch (e) {
      _error = e;
      return false;
    } finally {
      _busy = false;
      _notify();
    }
  }

  Future<bool> login({required String email, required String password}) async {
    if (_busy) return false;
    _busy = true;
    _error = null;
    _notify();
    try {
      final res = await _api.login(email: email.trim(), password: password);
      await _adoptSession(res);
      return true;
    } on ApiException catch (e) {
      _error = e;
      return false;
    } finally {
      _busy = false;
      _notify();
    }
  }

  Future<void> _adoptSession(AuthResult res) async {
    _api.setAuthToken(res.token);
    await _tokens.write(res.token);
    _user = res.user;
    _notify();
    await _mergeAfterSignIn();
  }

  Future<void> logout() async {
    if (_busy) return;
    _busy = true;
    _notify();
    try {
      await _api.logout();
    } on ApiException {
      // Server already forgot us or unreachable; clear locally regardless.
    }
    _api.setAuthToken(null);
    await _tokens.clear();
    _user = null;
    _syncedUserId = null;
    _lastPosted = const {};
    _busy = false;
    _notify();
  }

  void clearError() {
    _error = null;
    _notify();
  }

  @visibleForTesting
  void seedSessionForTest(AuthUser user, String token) {
    _api.setAuthToken(token);
    _user = user;
    _ready = true;
    _notify();
  }
}
