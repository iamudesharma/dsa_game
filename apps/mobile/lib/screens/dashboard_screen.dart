import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/learning.dart';
import '../models/json.dart';
import '../services/api_client.dart';
import '../state/auth_controller.dart';
import '../state/catalogue_controller.dart';
import '../state/game_controller.dart';
import '../widgets/learning_markdown.dart';
import 'auth_screen.dart';
import 'chat_screen.dart';
import 'play_screen.dart';
import 'problem_screen.dart';
import 'debrief_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});
  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  LearningDashboard? _data;
  List<PracticeRecord> _records = [];
  List<Map<String, Object?>> _plans = [];
  String _error = '', _planError = '', _topic = '';
  String? _cursor, _account;
  bool _loading = false, _planLoading=false;
  DateTimeRange? _dates;
  int _epoch = 0, _historyEpoch = 0;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final id = context.watch<AuthController>().user?.id;
    if (_account == id) return;
    _account = id;
    _epoch++;
    _data = null;
    _records = [];
    _plans = [];
    if (id != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  Future<void> _load() async {
    final epoch = _epoch;
    setState(() {_loading = true;_error='';});
    unawaited(_loadPlans());
    try {
      final d = await context.read<ApiClient>().learningDashboard();
      if (mounted && epoch == _epoch) setState(() => _data = d);
      await _history();

    } catch (e) {
      if (mounted && epoch == _epoch) setState(() => _error = '$e');
    } finally {
      if (mounted && epoch == _epoch) setState(() => _loading = false);
    }
  }

  Future<void> _loadPlans() async {
    final epoch = _epoch;
    if(mounted)setState(()=>_planLoading=true);
    try {
      final plans = await context.read<ApiClient>().learningPlans();
      if (mounted && epoch == _epoch) {
        setState(() {
          _plans = plans;
          _planError = '';
        });
      }
    } catch (e) {
      if (mounted && epoch == _epoch) setState(() => _planError = '$e');
    } finally {if(mounted&&epoch==_epoch)setState(()=>_planLoading=false);}
  }

  Future<void> _history({bool more = false}) async {
    final epoch = _epoch, historyEpoch = ++_historyEpoch;
    try {
      final p = await context.read<ApiClient>().learningHistory(
        topic: _topic,
        cursor: more ? _cursor : null,
        from: _dates?.start.millisecondsSinceEpoch,
        to: _dates?.end
            .add(const Duration(days: 1))
            .subtract(const Duration(milliseconds: 1))
            .millisecondsSinceEpoch,
      );
      if (mounted && epoch == _epoch && historyEpoch == _historyEpoch) {
        setState(() {
          _records = more ? [..._records, ...p.items] : p.items;
          _cursor = p.nextCursor;
          _error = '';
        });
      }
    } catch (e) {
      if (mounted && epoch == _epoch) setState(() => _error = '$e');
    }
  }

  String _title(String id) =>
      context.read<CatalogueController>().catalogue?.problemById(id)?.title ??
      id;
  Future<void> _open(PracticeRecord r) async {
    try {
      final api = context.read<ApiClient>();
      if (r.outcome == 'playing') {
        final catalogue = context.read<CatalogueController>();
        if (catalogue.catalogue == null) await catalogue.load();
        if (!mounted) return;
        final p = catalogue.catalogue?.problemById(r.problemId);
        if (p == null) return;
        await context.read<GameController>().restore(r.gameId, p);
        if (mounted) {
          await Navigator.of(
            context,
          ).push(MaterialPageRoute<void>(builder: (_) => const PlayScreen()));
        }
      } else {
        final catalogue = context.read<CatalogueController>();
        if (catalogue.catalogue == null) await catalogue.load();
        if (!mounted) return;
        final p = catalogue.catalogue?.problemById(r.problemId);
        if (p != null) {
          await context.read<GameController>().restore(r.gameId, p);
        }
        final d = await api.fetchDebrief(r.gameId);
        if (mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => DebriefScreen(debrief: d)),
          );
        }
      }
      if (mounted) await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  void _problem(String id) {
    final p = context.read<CatalogueController>().catalogue?.problemById(id);
    if (p != null) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ProblemScreen(
            topic: context
                .read<CatalogueController>()
                .catalogue!
                .topics
                .firstWhere((t) => t.id == p.topic.wire),
            initialProblemId: p.id,
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    if (!auth.signedIn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Progress')),
        body: Center(
          child: FilledButton(
            onPressed: () => Navigator.of(
              context,
            ).push(MaterialPageRoute<bool>(builder: (_) => const AuthScreen())),
            child: const Text('Sign in to see your history'),
          ),
        ),
      );
    }
    final d = _data, recommendation = d?.recommendation;
    final recent = d?.records.take(10).toList() ?? <PracticeRecord>[];
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your progress'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading && d == null) const LinearProgressIndicator(),
            if (_error.isNotEmpty)
              Text(
                _error,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            if (recommendation != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Your next step',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(Json.str(recommendation['reason'])),
                      FilledButton(
                        onPressed: () {
                          final id = Json.str(recommendation['gameId']);
                          if (id.isNotEmpty) {
                            _open(d!.records.firstWhere((r) => r.gameId == id));
                          } else {
                            _problem(Json.str(recommendation['problemId']));
                          }
                        },
                        child: Text(
                          '${recommendation['gameId'] != null ? 'Resume: ' : ''}${_title(Json.str(recommendation['problemId']))}',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            OutlinedButton(
              onPressed: () => ChatScreen.open(
                context,
                prompt: 'Review my practice history. What should I study next?',
              ),
              child: const Text('Discuss my progress'),
            ),
            Text(
              'Last ${recent.length} runs: ${recent.fold(0, (n, r) => n + r.mistakes)} mistakes · ${recent.fold(0, (n, r) => n + r.hints)} hints',
            ),
            const Text(
              'Completion is a milestone. Repeated independent practice gives stronger evidence.',
            ),
            if (d != null) ...[
              const SizedBox(height: 16),
              const Text(
                'Topics',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              for (final t in d.topics)
                ListTile(
                  title: Text(Json.str(t['topic'])),
                  subtitle: Text(
                    '${t['completed']}/${t['total']} completed · ${t['mistakes']} mistakes · ${t['hints']} hints',
                  ),
                  trailing: IconButton(
                    tooltip: 'Discuss topic',
                    icon: const Icon(Icons.chat_bubble_outline),
                    onPressed: () => ChatScreen.open(
                      context,
                      prompt: 'Review my ${t['topic']} practice history.',
                    ),
                  ),
                ),
              const Text(
                'Practice schedule',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              for (final r in d.reviews)
                ListTile(
                  title: Text(_title(Json.str(r['problemId']))),
                  subtitle: Text(
                    Json.intOr(r['dueAt']) <=
                            DateTime.now().millisecondsSinceEpoch
                        ? 'Due now'
                        : 'Due ${DateTime.fromMillisecondsSinceEpoch(Json.intOr(r['dueAt'])).toLocal().toString().split(' ').first}',
                  ),
                  trailing: TextButton(
                    onPressed: () => _problem(Json.str(r['problemId'])),
                    child: const Text('Review'),
                  ),
                ),
            ],
            const Text(
              'Practice history',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            DropdownButtonFormField<String>(
              initialValue: _topic,
              decoration: const InputDecoration(labelText: 'Topic'),
              items: [
                const DropdownMenuItem(value: '', child: Text('All topics')),
                for (final t in d?.topics ?? <Map<String, Object?>>[])
                  DropdownMenuItem(
                    value: Json.str(t['topic']),
                    child: Text(Json.str(t['topic'])),
                  ),
              ],
              onChanged: (v) {
                setState(() => _topic = v ?? '');
                _history();
              },
            ),
            TextButton(
              onPressed: () async {
                final dates = await showDateRangePicker(
                  context: context,
                  firstDate: DateTime(2020),
                  lastDate: DateTime.now(),
                  initialDateRange: _dates,
                );
                if (dates != null) {
                  setState(() => _dates = dates);
                  await _history();
                }
              },
              child: Text(
                _dates == null
                    ? 'Filter dates'
                    : '${_dates!.start.toString().split(' ').first} – ${_dates!.end.toString().split(' ').first}',
              ),
            ),
            if (_dates != null)
              TextButton(
                onPressed: () {
                  setState(() => _dates = null);
                  _history();
                },
                child: const Text('Clear date filter'),
              ),
            if (_records.isEmpty)
              const Text(
                'No runs match. Play a signed-in mission to record your practice.',
              ),
            for (final r in _records)
              Card(
                child: ListTile(
                  title: Text(_title(r.problemId)),
                  subtitle: Text(
                    '${r.difficulty} · ${r.mistakes} mistakes · ${r.hints} hints',
                  ),
                  onTap: () => _open(r),
                  trailing: IconButton(
                    tooltip: 'Discuss run',
                    icon: const Icon(Icons.chat_bubble_outline),
                    onPressed: () => ChatScreen.open(
                      context,
                      prompt:
                          'Discuss this practice run. What should I improve?',
                      reference: {'type': 'run', 'gameId': r.gameId},
                    ),
                  ),
                ),
              ),
            if (_cursor != null)
              TextButton(
                onPressed: () => _history(more: true),
                child: const Text('Load more runs'),
              ),
            const Text(
              'Saved study plans',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            if (_planError.isNotEmpty) ...[
              Text(_planError),
              TextButton(
                onPressed: _loadPlans,
                child: const Text('Retry plans'),
              ),
            ],
            if(_planLoading)const Text('Loading saved plans…'),
            if (_plans.isEmpty && _planError.isEmpty&&!_planLoading)
              const Text('Create and save a study plan in Chat.'),
            for (final p in _plans)
              ExpansionTile(
                title: Text(Json.str(p['title'])),
                children: [
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: LearningMarkdown(text: Json.str(p['content'])),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
