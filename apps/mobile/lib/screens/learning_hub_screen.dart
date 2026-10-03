import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../state/catalogue_controller.dart';
import '../state/auth_controller.dart';
import '../adventure/progress_store.dart';
import '../models/json.dart';
import '../widgets/learning_markdown.dart';
import 'patterns_screen.dart';
import 'tracks_screen.dart';
import 'learn_screen.dart';
import 'problem_screen.dart';
import 'chat_screen.dart';

class LearningHubScreen extends StatefulWidget {
  const LearningHubScreen({super.key});
  @override
  State<LearningHubScreen> createState() => _LearningHubScreenState();
}

class _LearningHubScreenState extends State<LearningHubScreen> {
  List<Map<String, Object?>>? _lessons;
  String _error = '', _query = '';
  Map<String, String> _drafts = {};
  String? _scope;
  final _search = TextEditingController();
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final scope = context.watch<AuthController>().user?.id ?? 'guest';
    if (_scope == scope) return;
    _scope = scope;
    _drafts = {};
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load() async {
    final scope = _scope;
    try {
      final api = context.read<ApiClient>(),
          keys = context.read<AdventureController>().keyValueStore;
      final data = await api.lessons();
      final drafts = <String, String>{};
      for (final l in data) {
        final topic = Json.str(l['topic']);
        drafts[topic] = await keys.readKey('topic-notebook:$topic') ?? '';
      }
      if (mounted && scope == _scope) {
        setState(() {
          _lessons = data;
          _drafts = drafts;
          _error = '';
        });
      }
    } catch (e) {
      if (mounted && scope == _scope) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Your field notebook')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => const PatternsScreen()),
              ),
              child: const Text('Patterns'),
            ),
            OutlinedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => const TracksScreen()),
              ),
              child: const Text('Interview tracks'),
            ),
            OutlinedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => const LearnScreen()),
              ),
              child: const Text('Linked-list lab'),
            ),
          ],
        ),
        TextField(
          controller: _search,
          decoration: const InputDecoration(labelText: 'Find a concept'),
          onChanged: (v) => setState(() => _query = v),
        ),
        if (_error.isNotEmpty) ...[
          Text(_error),
          TextButton(onPressed: _load, child: const Text('Retry lessons')),
        ],
        if (_lessons == null && _error.isEmpty) const LinearProgressIndicator(),
        if (_lessons != null &&
            !_lessons!.any(
              (l) => '${l['title']} ${l['topic']}'.toLowerCase().contains(
                _query.toLowerCase(),
              ),
            ))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Column(
              children: [
                const Text('No concepts match your search.'),
                TextButton(
                  onPressed: () => setState(() {
                    _query = '';
                    _search.clear();
                  }),
                  child: const Text('Show all concepts'),
                ),
              ],
            ),
          ),
        for (final l in _lessons ?? <Map<String, Object?>>[])
          if ('${l['title']} ${l['topic']}'.toLowerCase().contains(
            _query.toLowerCase(),
          ))
            ExpansionTile(
              title: Text(Json.str(l['title'])),
              children: [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(Json.str(l['concept'])),
                      const SizedBox(height: 8),
                      Text('Worked example: ${l['example']}'),
                      LearningMarkdown(text: '```python\n${l['code']}\n```'),
                      TextFormField(
                        key: ValueKey('$_scope:${l['topic']}'),
                        initialValue: _drafts[Json.str(l['topic'])] ?? '',
                        decoration: const InputDecoration(
                          labelText: 'Your explanation',
                        ),
                        minLines: 2,
                        maxLines: 5,
                        onChanged: (v) {
                          _drafts[Json.str(l['topic'])] = v;
                          context
                              .read<AdventureController>()
                              .keyValueStore
                              .writeKey('topic-notebook:${l['topic']}', v);
                        },
                      ),
                      OutlinedButton(
                        onPressed: () => ChatScreen.open(
                          context,
                          prompt:
                              'Explain ${l['title']}. Give me an example and ask a practice question.',
                        ),
                        child: const Text('Discuss in Chat'),
                      ),
                      for (final t
                          in context
                                  .watch<CatalogueController>()
                                  .catalogue
                                  ?.topics ??
                              [])
                        if (t.id == l['topic'])
                          for (final p in t.problems)
                            TextButton(
                              onPressed: () => Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => ProblemScreen(
                                    topic: t,
                                    initialProblemId: p.id,
                                  ),
                                ),
                              ),
                              child: Text('${p.title} →'),
                            ),
                    ],
                  ),
                ),
              ],
            ),
      ],
    ),
  );
}
