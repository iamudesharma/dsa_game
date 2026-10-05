import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../adventure/progress_store.dart';
import '../models/learning.dart';
import '../models/api.dart';
import '../models/json.dart';
import '../models/problem.dart';
import '../services/api_client.dart';
import '../state/auth_controller.dart';
import '../state/catalogue_controller.dart';
import '../state/chat_controller.dart';
import '../state/game_controller.dart';
import '../widgets/learning_markdown.dart';
import 'auth_screen.dart';
import 'play_screen.dart';
import 'account_screen.dart';
import 'debrief_screen.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({this.prompt, this.reference, this.threadId, super.key});
  final String? prompt, threadId;
  final Map<String, Object?>? reference;
  static Future<void> open(
    BuildContext context, {
    String? prompt,
    Map<String, Object?>? reference,
  }) async {
    if (!context.read<AuthController>().signedIn) {
      final ok = await Navigator.of(context)
          .push<bool>(MaterialPageRoute(builder: (_) => const AuthScreen()));
      if (ok != true || !context.mounted) return;
    }
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChatScreen(prompt: prompt, reference: reference),
      ),
    );
  }

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  ChatController? _chat;
  final _input = TextEditingController(), _scroll = ScrollController();
  String? _actionBusy;
  Completer<void>? _actionAbort;
  bool _atBottom = true;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scroll.addListener(
      () => _atBottom =
          !_scroll.hasClients ||
          _scroll.position.maxScrollExtent - _scroll.offset < 80,
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final account = context.watch<AuthController>().user?.id;
    if (_chat?.accountId == account) return;
    _chat?.removeListener(_changed);
    _chat?.dispose();
    _chat = null;
    _input.clear();
    if (account != null) {
      _chat = ChatController(
        context.read<ApiClient>(),
        context.read<AdventureController>().keyValueStore,
        account,
      )..addListener(_changed);
      unawaited(
        _chat!.initialize(
          id: widget.threadId,
          prompt: widget.prompt,
          reference: widget.reference,
        ),
      );
    }
  }

  void _changed() {
    if (!mounted) return;
    final c = _chat!;
    if (_input.text != c.draft) {
      _input.value = TextEditingValue(
        text: c.draft,
        selection: TextSelection.collapsed(offset: c.draft.length),
      );
    }
    setState(() {});
    if (_atBottom) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scroll.hasClients) {
          _scroll.jumpTo(_scroll.position.maxScrollExtent);
        }
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) _chat?.stop();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _chat?.removeListener(_changed);
    _chat?.dispose();
    if (_actionAbort?.isCompleted == false) _actionAbort!.complete();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _action(LearningMessage m, int i, {bool instant = false}) async {
    final c = _chat!, a = m.actions[i];
    final abort = Completer<void>();
    _actionAbort = abort;
    setState(() => _actionBusy = '${m.id}:$i');
    try {
      final result = await c.api.learningAction(
        c.threadId!,
        m.id,
        i,
        instant: instant,
        abortTrigger: abort.future,
      );
      if (!mounted || _chat != c) return;
      if (a.type == 'game') {
        final catalogue = context.read<CatalogueController>();
        if (catalogue.catalogue == null) await catalogue.load();
        if (!mounted || _chat != c) return;
        final problem = catalogue.catalogue?.problemById(a.problemId);
        if (problem == null) throw StateError('This game is unavailable.');
        final gameId = Json.str(result['gameId']);
        await context.read<GameController>().restore(gameId, problem);
        if (!mounted || _chat != c) return;
        await Navigator.of(context)
            .push(MaterialPageRoute<void>(builder: (_) => const PlayScreen()));
      } else if (a.type == 'interview') {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) =>
                AccountScreen(initialTab: 2, kitId: Json.str(result['kitId'])),
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Study plan saved to Progress.')),
        );
      }
    } catch (e) {
      if (mounted) setState(() => c.error = '$e');
    } finally {
      if (mounted) {
        setState(() {
          _actionBusy = null;
          _actionAbort = null;
        });
      }
    }
  }

  Future<void> _manage(LearningThread t, bool remove) async {
    final title = TextEditingController(text: t.title), c = _chat!;
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(remove ? 'Delete conversation?' : 'Rename conversation'),
        content: remove
            ? Text('Delete “${t.title}” and its messages?')
            : TextField(
                controller: title,
                autofocus: true,
                maxLength: 160,
                decoration: const InputDecoration(labelText: 'Title'),
              ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () =>
                Navigator.pop(ctx, remove ? 'delete' : title.text.trim()),
            child: Text(remove ? 'Delete' : 'Save'),
          ),
        ],
      ),
    );
    title.dispose();
    if (value == null || value.isEmpty) return;
    try {
      if (remove) {
        await c.api.deleteLearningThread(t.id);
        if (c.threadId == t.id) await c.open(null);
      } else {
        await c.api.renameLearningThread(t.id, value);
      }
      await c.refresh();
    } catch (e) {
      if (mounted) setState(() => c.error = '$e');
    }
  }

  void _conversations() {
    final c = _chat!;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => SafeArea(
          child: SizedBox(
            height: MediaQuery.sizeOf(ctx).height * .75,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: TextField(
                    decoration: const InputDecoration(
                      labelText: 'Search conversations',
                    ),
                    onChanged: (q) async {
                      c.query = q;
                      await c.refresh();
                      if (ctx.mounted) update(() {});
                    },
                  ),
                ),
                Expanded(
                  child: ListView(
                    children: [
                      for (final t in c.threads)
                        ListTile(
                          title: Text(t.title),
                          selected: t.id == c.threadId,
                          onTap: () {
                            Navigator.pop(ctx);
                            unawaited(c.open(t.id));
                          },
                          trailing: PopupMenuButton<bool>(
                            onSelected: (remove) {
                              Navigator.pop(ctx);
                              unawaited(_manage(t, remove));
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(
                                value: false,
                                child: Text('Rename'),
                              ),
                              const PopupMenuItem(
                                value: true,
                                child: Text('Delete'),
                              ),
                            ],
                          ),
                        ),
                      if (c.nextThreads != null)
                        TextButton(
                          onPressed: () async {
                            await c.refresh(more: true);
                            if (ctx.mounted) update(() {});
                          },
                          child: const Text('Load more'),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = _chat;
    if (c == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Chat')),
        body: Center(
          child: FilledButton(
            onPressed: () => ChatScreen.open(
              context,
              prompt: widget.prompt,
              reference: widget.reference,
            ),
            child: const Text('Sign in to Chat'),
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('DSA & career tutor'),
        actions: [
          IconButton(
            tooltip: 'Conversations',
            onPressed: _conversations,
            icon: Semantics(label: 'Conversations', child: Icon(Icons.history)),
          ),
          IconButton(
            tooltip: 'New chat',
            onPressed: c.busy ? null : () => c.open(null),
            icon: Semantics(
              label: 'New chat',
              child: Icon(Icons.add_comment_outlined),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxHeight < 240;
            return Column(
              children: [
                if (!compact)
                  ExpansionTile(
                    title: Text(
                      'Context: ${c.context['history'] == true ? 'practice history' : 'conversation'}${c.context['resume'] == true ? ', resume' : ''}${c.context['target'] == true ? ', target' : ''}${c.context['reference'] != null ? ', selected item' : ''}',
                    ),
                    children: [
                      for (final key in ['history', 'resume', 'target'])
                        CheckboxListTile(
                          title: Text(
                            key == 'history'
                                ? 'Practice history'
                                : key == 'resume'
                                ? 'Resume (without contact details)'
                                : 'Interview target',
                          ),
                          value: c.context[key] == true,
                          onChanged: c.busy
                              ? null
                              : (v) => setState(() => c.context[key] = v),
                        ),
                      if (c.context['reference'] != null)
                        TextButton(
                          onPressed: () =>
                              setState(() => c.context.remove('reference')),
                          child: const Text('Remove selected item'),
                        ),
                    ],
                  ),
                Expanded(
                  child: c.loading
                      ? const Center(child: CircularProgressIndicator())
                      : ListView(
                          controller: _scroll,
                          padding: const EdgeInsets.all(16),
                          children: [
                            if (c.messages.isEmpty && !c.busy) ...[
                              const Text(
                                'What would you like to explore?',
                                style: TextStyle(
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              for (final prompt in [
                                'Explain binary search with an example.',
                                'Review my practice. What should I study next?',
                                'Prepare me for a backend interview.',
                                'Create a 7-day DSA study plan.',
                              ])
                                Padding(
                                  padding: const EdgeInsets.only(top: 8),
                                  child: OutlinedButton(
                                    onPressed: () => c.changeDraft(prompt),
                                    child: Text(prompt),
                                  ),
                                ),
                            ],
                            for (final m in c.messages) _message(c, m),
                            if (c.busy)
                              Card(
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: LearningMarkdown(
                                    text: c.partial.isEmpty
                                        ? c.status
                                        : c.partial,
                                  ),
                                ),
                              ),
                          ],
                        ),
                ),
                if (!_atBottom && !compact)
                  TextButton(
                    onPressed: () {
                      _atBottom = true;
                      if (_scroll.hasClients) {
                        _scroll.jumpTo(_scroll.position.maxScrollExtent);
                      }
                    },
                    child: const Text('Jump to latest'),
                  ),
                if (c.error.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      c.error,
                      semanticsLabel: 'Error: ${c.error}',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                if (!compact &&
                    c.messages.any((m) => m.role == 'user') &&
                    !c.busy)
                  TextButton(
                    onPressed: () => c.send(regenerate: true),
                    child: Text(
                      c.messages.last.status == 'failed' ||
                              c.messages.last.status == 'interrupted'
                          ? 'Retry last question'
                          : 'Regenerate',
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _input,
                          minLines: 1,
                          maxLines: compact ? 1 : 5,
                          maxLength: 8000,
                          decoration: const InputDecoration(
                            labelText: 'Your message',
                            hintText:
                                'DSA, practice history, or interview prep',
                            counterText: '',
                          ),
                          onChanged: c.changeDraft,
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        tooltip: c.busy ? 'Stop response' : 'Send message',
                        onPressed: c.busy
                            ? c.stop
                            : c.loading || c.draft.trim().isEmpty
                            ? null
                            : () => c.send(),
                        icon: Semantics(
                          label: c.busy ? 'Stop response' : 'Send message',
                          child: Icon(c.busy ? Icons.stop : Icons.send),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _message(ChatController c, LearningMessage m) => Card(
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${m.role == 'user' ? 'You' : 'Tutor'}${m.status != 'complete' ? ' · ${m.status}' : ''}',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          LearningMarkdown(text: m.text),
          if (m.role == 'assistant') ...[
            TextButton.icon(
              onPressed: () => Clipboard.setData(ClipboardData(text: m.text)),
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy answer'),
            ),
            for (var i = 0; i < m.actions.length; i++)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        context
                                .read<CatalogueController>()
                                .catalogue
                                ?.problemById(m.actions[i].problemId)
                                ?.title ??
                            m.actions[i].title,
                      ),
                      Text(
                        m.actions[i].type == 'game'
                            ? '${Difficulty.parse(m.actions[i].difficulty).label} difficulty'
                            : m.actions[i].type == 'interview'
                            ? 'Uses your saved interview target'
                            : 'Save to Progress',
                      ),
                      Wrap(
                        spacing: 8,
                        children: [
                          FilledButton(
                            onPressed: c.busy || _actionBusy != null
                                ? null
                                : () => _action(m, i),
                            child: Text(
                              _actionBusy == '${m.id}:$i'
                                  ? 'Generating…'
                                  : m.actions[i].type == 'plan'
                                  ? 'Save plan'
                                  : 'Generate and open',
                            ),
                          ),
                          if (_actionBusy == '${m.id}:$i')
                            TextButton(
                              onPressed: () {
                                if (_actionAbort?.isCompleted == false) {
                                  _actionAbort!.complete();
                                }
                              },
                              child: const Text('Cancel preparation'),
                            ),
                          if (m.actions[i].type == 'game')
                            OutlinedButton(
                              onPressed: c.busy || _actionBusy != null
                                  ? null
                                  : () => _action(m, i, instant: true),
                              child: const Text('Instant practice'),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            if (m.sources.isNotEmpty)
              ExpansionTile(
                title: const Text('Evidence used'),
                children: [
                  for (final source in m.sources)
                    ListTile(
                      title: Text(Json.str(source['label'])),
                      onTap: () => _openSource(Json.str(source['href'])),
                    ),
                ],
              ),
          ],
        ],
      ),
    ),
  );
  Future<void> _openSource(String href) async {
    try {
      final parts = Uri.parse(href).pathSegments;
      if (parts.length < 2) return;
      final api = context.read<ApiClient>();
      if (parts.first == 'debrief') {
        final raw = await api.fetchGame(parts[1]);
        if (!mounted) return;
        final p = context.read<CatalogueController>().catalogue?.problemById(
          Json.str(raw['problemId']),
        );
        if (p != null) {
          await context.read<GameController>().restore(parts[1], p);
        }
        final d = await api.fetchDebrief(parts[1]);
        if (mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => DebriefScreen(debrief: d)),
          );
        }
      } else if (parts.first == 'play') {
        final raw = await api.fetchGame(parts[1]);
        if (!mounted) return;
        final problem = context
            .read<CatalogueController>()
            .catalogue
            ?.problemById(Json.str(raw['problemId']));
        if (problem == null) return;
        context.read<GameController>().adoptGenerated(
          GenerateResponse.from({...raw, 'attempts': [], 'notes': []}),
          problem,
          difficulty: Difficulty.parse(raw['difficulty']),
        );
        await Navigator.of(context)
            .push(MaterialPageRoute<void>(builder: (_) => const PlayScreen()));
      } else if (parts.first == 'account') {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => AccountScreen(
              initialTab: 2,
              kitId: Uri.parse(href).queryParameters['kit'],
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _chat?.error = '$e');
    }
  }
}
