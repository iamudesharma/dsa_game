import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/learning.dart';
import '../models/json.dart';
import '../services/api_client.dart';
import '../adventure/progress_store.dart';

class ChatController extends ChangeNotifier {
  ChatController(this.api, this.keys, this.accountId);
  final ApiClient api;
  final KeyValueStore keys;
  final String accountId;
  List<LearningThread> threads = [];
  List<LearningMessage> messages = [];
  String? threadId, nextThreads;
  String draft = '', partial = '', status = '', error = '', query = '';
  bool busy = false, loading = false;
  Map<String, Object?> context = {
    'history': true,
    'resume': false,
    'target': false,
  };
  Completer<void>? _abort;
  bool _disposed = false;
  int _epoch = 0;
  int _searchEpoch = 0;
  static int _counter = 0;
  String? _pendingId, _pendingText;
  String get _draftKey => 'chat-draft:$accountId:${threadId ?? 'new'}';
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void changeDraft(String value) {
    draft = value;
    unawaited(keys.writeKey(_draftKey, value));
    _notify();
  }

  Future<void> initialize({
    String? id,
    String? prompt,
    Map<String, Object?>? reference,
  }) async {
    await refresh();
    await open(id);
    if (prompt != null) changeDraft(prompt);
    if (reference != null) {
      context['reference'] = reference;
      _notify();
    }
  }

  Future<void> refresh({bool more = false}) async {
    final search = ++_searchEpoch;
    try {
      final p = await api.learningThreads(
        query: query,
        cursor: more ? nextThreads : null,
      );
      if (_disposed || search != _searchEpoch) return;
      threads = more ? [...threads, ...p.items] : p.items;
      nextThreads = p.nextCursor;
      _notify();
    } catch (e) {
      error = '$e';
      _notify();
    }
  }

  Future<void> open(String? id) async {
    final epoch = ++_epoch;
    stop();
    threadId = id;
    context = {'history': true, 'resume': false, 'target': false};
    messages = [];
    partial = '';
    error = '';
    busy = false;
    loading = true;
    _notify();
    try {
      final saved = await keys.readKey(_draftKey);
      if (epoch != _epoch || _disposed) return;
      draft = saved ?? '';
      if (id != null) {
        String? cursor;
        do {
          final p = await api.learningMessages(id, cursor: cursor);
          if (epoch != _epoch || _disposed) return;
          messages.addAll(p.items);
          cursor = p.nextCursor;
        } while (cursor != null);
      }
    } catch (e) {
      if (epoch == _epoch) error = '$e';
    }
    if (epoch == _epoch) {
      final users = messages.where((m) => m.role == 'user');
      if (users.isNotEmpty && users.last.data['context'] is Map) {
        context = Json.map(users.last.data['context']);
      }
      loading = false;
      _notify();
    }
  }

  Future<void> send({bool regenerate = false}) async {
    if (busy || loading) return;
    final users = messages.where((m) => m.role == 'user');
    final text = regenerate
        ? (users.isEmpty ? '' : users.last.text)
        : draft.trim();
    if (text.isEmpty) return;
    busy = true;
    error = '';
    partial = '';
    status = 'Sending…';
    _notify();
    final epoch = _epoch;
    final abort = Completer<void>();
    _abort = abort;
    try {
      if (threadId == null) {
        final t = await api.createLearningThread();
        if (epoch != _epoch || _disposed) return;
        await keys.writeKey(_draftKey, '');
        threadId = t.id;
      }
      final rid = !regenerate && _pendingText == text && _pendingId != null
          ? _pendingId!
          : 'mobile-${DateTime.now().microsecondsSinceEpoch}-${_counter++}';
      if (!regenerate) {
        _pendingId = rid;
        _pendingText = text;
        changeDraft('');
        if (!messages.any((m) => m.requestId == rid)) {
          messages.add(
            LearningMessage.from({
              'id': 'pending-$rid',
              'requestId': rid,
              'role': 'user',
              'text': text,
              'context': Map<String, Object?>.from(context),
            }),
          );
        }
        _notify();
      }
      await for (final e in api.streamLearning(threadId!, {
        'text': text,
        'requestId': rid,
        'context': context,
        'regenerate': regenerate,
      }, abort.future)) {
        if (epoch != _epoch || _disposed) return;
        switch (Json.str(e['type'])) {
          case 'text':
            partial += Json.str(e['text']);
            break;
          case 'status':
            status = Json.str(e['message']);
            break;
          case 'error':
            error = Json.str(e['message']);
            break;
          case 'complete':
            if (e['message'] is Map) {
              final message = LearningMessage.from(e['message']);
              messages = [
                ...messages.where((m) => m.id != message.id),
                message,
              ];
              partial = '';
            }
            _pendingId = null;
            _pendingText = null;
            break;
        }
        _notify();
      }
    } catch (e) {
      if (!abort.isCompleted && epoch == _epoch) {
        error = '$e';
        if (draft.isEmpty && !regenerate) changeDraft(text);
      }
    } finally {
      if (epoch == _epoch && !_disposed) {
        busy = false;
        status = '';
        _abort = null;
        final id = threadId;
        if (id != null) {
          try {
            final all = <LearningMessage>[];
            String? cursor;
            do {
              final p = await api.learningMessages(id, cursor: cursor);
              all.addAll(p.items);
              cursor = p.nextCursor;
            } while (cursor != null);
            if (epoch == _epoch && !_disposed) {
              messages = all;
              partial = '';
            }
          } catch (e) {
            error = '$e';
          }
        }
        await refresh();
        _notify();
      }
    }
  }

  void stop() {
    if (_abort != null && !_abort!.isCompleted) {
      _abort!.complete();
      final id = threadId;
      if (id != null) {
        unawaited(api.cancelLearning(id).catchError((Object _) {}));
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    stop();
    super.dispose();
  }
}
