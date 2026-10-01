/// The progression controller: [AdventureProgress] in memory, JSON in
/// platform storage, graceful degradation when storage is unavailable.
///
/// The storage backend is an interface so tests run on an in-memory fake and
/// production uses `shared_preferences`. A failed read resets to fresh
/// progress with [warning] set; a failed write keeps the in-memory state and
/// sets [warning] — play is never blocked on persistence.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'progress.dart';
import 'worlds.dart';

const String adventureStorageKey = 'play-the-algorithms:adventure:v1';

/// Key-value storage surface. Implemented by [SharedPreferencesStore] in
/// production and [MemoryBackend] in tests. Adventure progress uses one fixed
/// key; notebook drafts use one key per question and language — separate keys
/// so saving code can never mint or erase a stamp.
abstract class KeyValueStore {
  Future<String?> readKey(String key);
  Future<bool> writeKey(String key, String raw);
}

/// Production store over `shared_preferences`.
class SharedPreferencesStore implements KeyValueStore {
  const SharedPreferencesStore(this._prefs);

  final SharedPreferences _prefs;

  @override
  Future<String?> readKey(String key) async {
    try {
      return _prefs.getString(key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> writeKey(String key, String raw) async {
    try {
      return await _prefs.setString(key, raw);
    } catch (_) {
      return false;
    }
  }
}

/// Minimal storage surface the progression controller needs.
abstract class ProgressBackend {
  Future<String?> read();
  Future<bool> write(String raw);
}

/// Adapts a [KeyValueStore] to the single adventure-progress key.
class AdventureKeyBackend implements ProgressBackend {
  const AdventureKeyBackend(this._store);

  final KeyValueStore _store;

  @override
  Future<String?> read() => _store.readKey(adventureStorageKey);

  @override
  Future<bool> write(String raw) => _store.writeKey(adventureStorageKey, raw);
}

/// Volatile backend: the default for widget tests and the fallback when
/// platform storage throws during setup. Progress lives for the session.
class MemoryBackend implements KeyValueStore, ProgressBackend {
  MemoryBackend({String? seed}) {
    if (seed != null) _values[adventureStorageKey] = seed;
  }

  final Map<String, String> _values = {};

  /// Makes reads throw, simulating blocked storage.
  bool failReads = false;

  /// Makes writes report failure, simulating a full or blocked store.
  bool failWrites = false;

  @override
  Future<String?> readKey(String key) async {
    if (failReads) throw StateError('blocked');
    return _values[key];
  }

  @override
  Future<bool> writeKey(String key, String raw) async {
    if (failWrites) return false;
    _values[key] = raw;
    return true;
  }

  @override
  Future<String?> read() => readKey(adventureStorageKey);

  @override
  Future<bool> write(String raw) => writeKey(adventureStorageKey, raw);
}

class AdventureController extends ChangeNotifier {
  AdventureController(this._backend, {this._clock}) {
    _load();
  }

  final ProgressBackend _backend;
  final DateTime Function()? _clock;

  AdventureProgress _progress = AdventureProgress.fresh();
  bool _ready = false;
  bool _warning = false;
  bool _disposed = false;

  AdventureProgress get progress => _progress;
  bool get ready => _ready;
  bool get warning => _warning;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  /// Raw key access for sibling features (notebook drafts) that share the
  /// underlying store but must never flow through progress logic.
  KeyValueStore? get keyValueStore => _backend is KeyValueStore ? _backend as KeyValueStore : null;

  Future<void> _load() async {
    try {
      final raw = await _backend.read();
      if (raw == null) {
        _ready = true;
        _notify();
        return;
      }
      final parsed = AdventureProgress.fromJson(jsonDecode(raw));
      _progress = parsed.progress;
      if (parsed.warning) _warning = true;
    } catch (_) {
      _progress = AdventureProgress.fresh();
      _warning = true;
    }
    _ready = true;
    _notify();
  }

  Future<void> _save() async {
    try {
      final ok = await _backend.write(jsonEncode(_progress.toJson()));
      if (!ok) _warning = true;
    } catch (_) {
      _warning = true;
    }
    _notify();
  }

  /// Records a win. [knownProblemIds] is the catalogue's problem id set, so a
  /// typo can never mint a stamp.
  void recordWin(Set<String> knownProblemIds, {required String problemId, required String phase}) {
    final next = recordCompletion(
      _progress,
      knownProblemIds,
      problemId: problemId,
      phase: phase,
      clock: _clock,
    );
    if (identical(next, _progress)) return;
    _progress = next;
    _save();
  }

  /// Selects a cosmetic map frame. Only `'default'` or a fully-completed
  /// world's topic wire value is accepted; anything unearned is ignored.
  void selectFrame(String frame, Map<WorldDefinition, List<String>> missionIds) {
    if (frame != 'default') {
      final earned = completedWorlds(_progress, missionIds).any((w) => w.topic.wire == frame);
      if (!earned) return;
    }
    if (_progress.mapFrame == frame) return;
    _progress = AdventureProgress(completed: _progress.completed, mapFrame: frame);
    _save();
  }

  /// Adopts a server-side completion union (first-login merge). Entries already
  /// stamped locally keep their local timestamp; new ids are added. Saves only
  /// when the union actually adds something.
  void mergeCompleted(Map<String, String> server) {
    var changed = false;
    final merged = Map<String, String>.of(_progress.completed);
    server.forEach((id, stamp) {
      if (!merged.containsKey(id) && DateTime.tryParse(stamp) != null) {
        merged[id] = stamp;
        changed = true;
      }
    });
    if (!changed) return;
    _progress = AdventureProgress(completed: Map.unmodifiable(merged), mapFrame: _progress.mapFrame);
    _save();
  }
}
