/// The account hub: Resume · Target · Interview prep, behind sign-in.
///
/// Same contract as the web `/account` page. Resume ingest on mobile is the
/// manual form plus paste + deterministic parse — the server only ever
/// receives text, and binary PDF/DOCX extraction stays a web-only affordance
/// (paste the extracted text here and the same parser runs).
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../adventure/progress_store.dart';

import 'package:provider/provider.dart';

import '../models/account.dart';
import '../services/api_client.dart';
import '../services/api_exception.dart';
import '../state/auth_controller.dart';
import '../state/catalogue_controller.dart';
import '../theme/palette.dart';
import '../widgets/common.dart';
import 'auth_screen.dart';
import 'problem_screen.dart';
import 'chat_screen.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({this.initialTab = 0, this.kitId, super.key});
  final int initialTab;
  final String? kitId;

  /// Pushes the account screen, sending signed-out users through sign-in
  /// first. Returns without doing anything when sign-in is abandoned.
  static Future<void> open(BuildContext context) async {
    final auth = context.read<AuthController>();
    if (!auth.signedIn) {
      final ok = await Navigator.of(
        context,
      ).push<bool>(MaterialPageRoute<bool>(builder: (_) => const AuthScreen()));
      if (ok != true || !context.mounted) return;
    }
    if (!context.mounted) return;
    await Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => const AccountScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return DefaultTabController(
      length: 3,
      initialIndex: initialTab,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Your profile'),
          actions: [
            IconButton(
              onPressed: () async {
                await auth.logout();
                if (context.mounted) {
                  Navigator.of(context).popUntil((r) => r.isFirst);
                }
              },
              icon: const Icon(Icons.logout_rounded),
              tooltip: 'Sign out (${auth.user?.email ?? ''})',
            ),
          ],
          bottom: const TabBar(
            tabs: [
              Tab(
                text: 'Resume',
                icon: Icon(Icons.description_outlined, size: 18),
              ),
              Tab(
                text: 'Target',
                icon: Icon(Icons.track_changes_rounded, size: 18),
              ),
              Tab(
                text: 'Interview',
                icon: Icon(Icons.forum_outlined, size: 18),
              ),
            ],
          ),
        ),
        body: SafeArea(
          child: TabBarView(
            children: [
              _ResumeTab(),
              _TargetTab(),
              _InterviewTab(kitId: kitId),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------- resume

/// Manual structured form (the source of truth) + paste/parse (the fast
/// path). Empty rows are dropped on save so the strict server schema never
/// sees a blank title.
class _ResumeTab extends StatefulWidget {
  const _ResumeTab();

  @override
  State<_ResumeTab> createState() => _ResumeTabState();
}

class _ResumeTabState extends State<_ResumeTab>
    with AutomaticKeepAliveClientMixin {
  Resume? _resume;
  KeyValueStore? _draftKeys;
  String _savedResume = '';
  final Map<String, String> _skillIds = {};
  bool _adopting = false;
  final Set<TextEditingController> _observed = {};
  ApiException? _error;
  bool _loading = true;
  bool _saving = false;
  bool _parsing = false;
  List<String> _unparsed = const [];
  String? _extractionSource;
  int _rejectedCount = 0;

  final _summary = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _paste = TextEditingController();
  final _skills = TextEditingController();
  final _expControllers = <String, _ExpControllers>{};
  final _projControllers = <String, _ProjControllers>{};
  final _eduControllers = <String, _EduControllers>{};

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _persistDraft();
    _summary.dispose();
    _name.dispose();
    _email.dispose();
    _paste.dispose();
    _skills.dispose();
    for (final c in _expControllers.values) {
      c.dispose();
    }
    for (final c in _projControllers.values) {
      c.dispose();
    }
    for (final c in _eduControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      _draftKeys = context.read<AdventureController>().keyValueStore;
      final resume = await api.fetchResume();
      final raw = await _draftKeys?.readKey('resume-draft');
      if (!mounted) return;
      _savedResume = jsonEncode(resume.toJson());
      try {
        _adopt(raw == null ? resume : Resume.from(jsonDecode(raw)));
      } catch (_) {
        _adopt(resume);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _adopt(Resume resume) {
    _adopting = true;
    _skillIds
      ..clear()
      ..addEntries(
        resume.skills.map((skill) => MapEntry(skill.name, skill.id)),
      );
    for (final c in _expControllers.values) {
      c.dispose();
    }
    for (final c in _projControllers.values) {
      c.dispose();
    }
    for (final c in _eduControllers.values) {
      c.dispose();
    }
    _expControllers.clear();
    _projControllers.clear();
    _eduControllers.clear();
    _resume = resume;
    _summary.text = resume.summary;
    _name.text = resume.contact.name;
    _email.text = resume.contact.email;
    _skills.text = resume.skills.map((s) => s.name).join(', ');
    for (final e in resume.experience) {
      _expControllers[e.id] = _ExpControllers(e);
    }
    for (final p in resume.projects) {
      _projControllers[p.id] = _ProjControllers(p);
    }
    for (final e in resume.education) {
      _eduControllers[e.id] = _EduControllers(e);
    }
    _adopting = false;
  }

  void _persistDraft() {
    if (_adopting || _resume == null || _draftKeys == null) return;
    unawaited(
      _draftKeys!.writeKey('resume-draft', jsonEncode(_collect().toJson())),
    );
  }

  void _listenDrafts() {
    final controls = [
      _summary,
      _name,
      _email,
      _skills,
      for (final e in _expControllers.values) ...[
        e.title,
        e.company,
        e.start,
        e.end,
        e.bullets,
      ],
      for (final p in _projControllers.values) ...[
        p.name,
        p.description,
        p.tech,
      ],
      for (final e in _eduControllers.values) ...[e.school, e.degree],
    ];
    for (final c in controls) {
      if (_observed.add(c)) {
        c.addListener(() {
          _persistDraft();
          if (mounted && !_adopting) setState(() {});
        });
      }
    }
  }

  Resume _collect() {
    final skills = _skills.text
        .split(RegExp(r'[,;\n]'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .take(60)
        .toSet()
        .map(
          (s) => Skill(
            id: _skillIds.putIfAbsent(s, () => newAccountId('skill')),
            name: s,
          ),
        )
        .toList();
    final experience = <Experience>[];
    for (final entry in _expControllers.entries) {
      final c = entry.value;
      final title = c.title.text.trim();
      final company = c.company.text.trim();
      final bullets = c.bullets.text
          .split('\n')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .take(12)
          .toList();
      if (title.isEmpty && company.isEmpty && bullets.isEmpty) continue;
      experience.add(
        Experience(
          id: entry.key,
          title: title.isEmpty ? 'Role' : title,
          company: company.isEmpty ? 'Company' : company,
          start: c.start.text.trim(),
          end: c.end.text.trim().isEmpty ? 'Present' : c.end.text.trim(),
          bullets: bullets,
        ),
      );
    }
    final projects = <Project>[];
    for (final entry in _projControllers.entries) {
      final c = entry.value;
      if (c.name.text.trim().isEmpty && c.description.text.trim().isEmpty) {
        continue;
      }
      projects.add(
        Project(
          id: entry.key,
          name: c.name.text.trim().isEmpty ? 'Project' : c.name.text.trim(),
          description: c.description.text.trim(),
          tech: c.tech.text
              .split(',')
              .map((s) => s.trim())
              .where((s) => s.isNotEmpty)
              .take(20)
              .toList(),
        ),
      );
    }
    final education = <Education>[];
    for (final entry in _eduControllers.entries) {
      final c = entry.value;
      if (c.school.text.trim().isEmpty && c.degree.text.trim().isEmpty) {
        continue;
      }
      education.add(
        Education(
          id: entry.key,
          school: c.school.text.trim(),
          degree: c.degree.text.trim(),
        ),
      );
    }
    return Resume(
      summary: _summary.text.trim(),
      contact: ResumeContact(
        name: _name.text.trim(),
        email: _email.text.trim(),
      ),
      experience: experience,
      education: education,
      projects: projects,
      skills: skills,
    );
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = await context.read<ApiClient>().saveResume(_collect());
      if (!mounted) return;
      _adopt(saved);
      _savedResume = jsonEncode(_collect().toJson());
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Resume saved.')));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _parse({required bool save}) async {
    final text = _paste.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _parsing = true;
      _error = null;
    });
    try {
      final res = await context.read<ApiClient>().parseResume(text, save: save);
      if (!mounted) return;
      _adopt(res.resume);
      setState(() {
        _unparsed = res.unparsed;
        _extractionSource = res.source;
        _rejectedCount = res.rejected.length;
      });
      if (save) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Extracted and saved.')));
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _parsing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _resume == null) {
      return Padding(
        padding: const EdgeInsets.all(18),
        child: ApiErrorCard(
          error: _error!,
          onRetry: _load,
          retryLabel: 'Reload resume',
        ),
      );
    }
    _listenDrafts();
    final colors = context.gameColors;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
      children: [
        Text(
          _resume != null && jsonEncode(_collect().toJson()) == _savedResume
              ? 'Resume saved'
              : 'Unsaved resume changes — review before saving.',
        ),
        _SectionCard(
          title: 'Import',
          subtitle: 'Paste your resume, then review the extracted fields below before saving.',
          child: Column(
            children: [
              TextField(
                controller: _paste,
                minLines: 3,
                maxLines: 6,
                decoration: const InputDecoration(
                  labelText: 'Paste resume text',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilledButton(
                    onPressed: _parsing ? null : () => _parse(save: false),
                    child: Text(
                      _parsing ? 'Extracting…' : 'Extract for review',
                    ),
                  ),
                ],
              ),
              if (_extractionSource != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'Extracted by ${_extractionSource == 'model' ? 'the language model' : 'the built-in parser'}'
                    '${_rejectedCount > 0 ? ' · $_rejectedCount invented field(s) dropped' : ''}',
                    style: TextStyle(fontSize: 11.5, color: colors.muted),
                  ),
                ),
              if (_unparsed.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  "Couldn't place ${_unparsed.length} line(s) — copy them into the form below:",
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: colors.onSurface,
                  ),
                ),
                for (final line in _unparsed.take(8))
                  Text(
                    '• $line',
                    style: TextStyle(fontSize: 11.5, color: colors.muted),
                  ),
              ],
            ],
          ),
        ),
        _SectionCard(
          title: 'Basics',
          child: Column(
            children: [
              TextField(
                controller: _name,
                decoration: const InputDecoration(
                  labelText: 'Name',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Email',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _summary,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Summary',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        _SectionCard(
          title: 'Experience',
          trailing: IconButton(
            onPressed: () => setState(() {
              final id = newAccountId('exp');
              _expControllers[id] = _ExpControllers.empty();
            }),
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Add role',
          ),
          child: _expControllers.isEmpty
              ? Text(
                  'No roles yet. Add one, or import above.',
                  style: TextStyle(fontSize: 12.5, color: colors.muted),
                )
              : Column(
                  children: [
                    for (final entry in _expControllers.entries)
                      _EntryTile(
                        title: entry.value.title.text.isEmpty
                            ? 'New role'
                            : entry.value.title.text,
                        onDelete: () => setState(() {
                          entry.value.dispose();
                          _expControllers.remove(entry.key);
                        }),
                        child: Column(
                          children: [
                            TextField(
                              controller: entry.value.title,
                              decoration: const InputDecoration(
                                labelText: 'Title',
                                border: OutlineInputBorder(),
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: entry.value.company,
                              decoration: const InputDecoration(
                                labelText: 'Company',
                                border: OutlineInputBorder(),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: entry.value.start,
                                    decoration: const InputDecoration(
                                      labelText: 'Start',
                                      hintText: '2021',
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: TextField(
                                    controller: entry.value.end,
                                    decoration: const InputDecoration(
                                      labelText: 'End',
                                      hintText: 'Present',
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: entry.value.bullets,
                              minLines: 2,
                              maxLines: 5,
                              decoration: const InputDecoration(
                                labelText: 'Highlights (one per line)',
                                border: OutlineInputBorder(),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        _SectionCard(
          title: 'Skills',
          subtitle: 'Comma separated.',
          child: TextField(
            controller: _skills,
            minLines: 1,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Python, SQL, …',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        _SectionCard(
          title: 'Projects',
          trailing: IconButton(
            onPressed: () => setState(() {
              final id = newAccountId('proj');
              _projControllers[id] = _ProjControllers.empty();
            }),
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Add project',
          ),
          child: _projControllers.isEmpty
              ? Text(
                  'No projects yet.',
                  style: TextStyle(fontSize: 12.5, color: colors.muted),
                )
              : Column(
                  children: [
                    for (final entry in _projControllers.entries)
                      _EntryTile(
                        title: entry.value.name.text.isEmpty
                            ? 'New project'
                            : entry.value.name.text,
                        onDelete: () => setState(() {
                          entry.value.dispose();
                          _projControllers.remove(entry.key);
                        }),
                        child: Column(
                          children: [
                            TextField(
                              controller: entry.value.name,
                              decoration: const InputDecoration(
                                labelText: 'Name',
                                border: OutlineInputBorder(),
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: entry.value.description,
                              minLines: 2,
                              maxLines: 4,
                              decoration: const InputDecoration(
                                labelText: 'Description',
                                border: OutlineInputBorder(),
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: entry.value.tech,
                              decoration: const InputDecoration(
                                labelText: 'Tech (comma separated)',
                                border: OutlineInputBorder(),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        _SectionCard(
          title: 'Education',
          trailing: IconButton(
            onPressed: () => setState(() {
              final id = newAccountId('edu');
              _eduControllers[id] = _EduControllers.empty();
            }),
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Add education',
          ),
          child: _eduControllers.isEmpty
              ? Text(
                  'No education yet.',
                  style: TextStyle(fontSize: 12.5, color: colors.muted),
                )
              : Column(
                  children: [
                    for (final entry in _eduControllers.entries)
                      _EntryTile(
                        title: entry.value.school.text.isEmpty
                            ? 'New education'
                            : entry.value.school.text,
                        onDelete: () => setState(() {
                          entry.value.dispose();
                          _eduControllers.remove(entry.key);
                        }),
                        child: Column(
                          children: [
                            TextField(
                              controller: entry.value.school,
                              decoration: const InputDecoration(
                                labelText: 'School',
                                border: OutlineInputBorder(),
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: entry.value.degree,
                              decoration: const InputDecoration(
                                labelText: 'Degree',
                                border: OutlineInputBorder(),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        if (_error != null)
          ApiErrorCard(
            error: _error!,
            onRetry: _save,
            retryLabel: 'Save again',
          ),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded, size: 18),
          label: Text(_saving ? 'Saving…' : 'Save resume'),
        ),
      ],
    );
  }
}

class _ExpControllers {
  _ExpControllers(Experience e)
    : title = TextEditingController(text: e.title),
      company = TextEditingController(text: e.company),
      start = TextEditingController(text: e.start),
      end = TextEditingController(text: e.end),
      bullets = TextEditingController(text: e.bullets.join('\n'));

  _ExpControllers.empty()
    : title = TextEditingController(),
      company = TextEditingController(),
      start = TextEditingController(),
      end = TextEditingController(text: 'Present'),
      bullets = TextEditingController();

  final TextEditingController title;
  final TextEditingController company;
  final TextEditingController start;
  final TextEditingController end;
  final TextEditingController bullets;

  void dispose() {
    title.dispose();
    company.dispose();
    start.dispose();
    end.dispose();
    bullets.dispose();
  }
}

class _ProjControllers {
  _ProjControllers(Project p)
    : name = TextEditingController(text: p.name),
      description = TextEditingController(text: p.description),
      tech = TextEditingController(text: p.tech.join(', '));

  _ProjControllers.empty()
    : name = TextEditingController(),
      description = TextEditingController(),
      tech = TextEditingController();

  final TextEditingController name;
  final TextEditingController description;
  final TextEditingController tech;

  void dispose() {
    name.dispose();
    description.dispose();
    tech.dispose();
  }
}

class _EduControllers {
  _EduControllers(Education e)
    : school = TextEditingController(text: e.school),
      degree = TextEditingController(text: e.degree);

  _EduControllers.empty()
    : school = TextEditingController(),
      degree = TextEditingController();

  final TextEditingController school;
  final TextEditingController degree;

  void dispose() {
    school.dispose();
    degree.dispose();
  }
}

class _EntryTile extends StatelessWidget {
  const _EntryTile({
    required this.title,
    required this.child,
    required this.onDelete,
  });

  final String title;
  final Widget child;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    // The section card paints its own background, so the tile needs a
    // Material of its own — otherwise the ListTile ink assertions fire.
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: Text(
          title,
          style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              onPressed: onDelete,
              icon: const Icon(Icons.delete_outline_rounded, size: 19),
              tooltip: 'Remove',
            ),
            const Icon(Icons.expand_more_rounded),
          ],
        ),
        children: [
          Padding(padding: const EdgeInsets.only(bottom: 12), child: child),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------- target

/// Goal + target company + seniority + focus areas. Company process facts come
/// from the deterministic registry; the model only ever rephrases them.
class _TargetTab extends StatefulWidget {
  const _TargetTab();

  @override
  State<_TargetTab> createState() => _TargetTabState();
}

class _TargetTabState extends State<_TargetTab>
    with AutomaticKeepAliveClientMixin {
  List<CompanyProfile> _companies = const [];
  Target? _saved;
  KeyValueStore? _draftKeys;
  bool _adopting = false;
  Target _collectTarget() => Target(
    goal: _goal.text.trim(),
    companyId: _companyId,
    customCompany: _custom.text.trim(),
    seniority: _seniority,
    focusAreas: List.unmodifiable(_focusAreas),
  );
  void _persistTarget() {
    if (!_adopting && _draftKeys != null) {
      unawaited(
        _draftKeys!.writeKey(
          'target-draft',
          jsonEncode(_collectTarget().toJson()),
        ),
      );
    }
  }

  void _draftChanged() {
    _persistTarget();
    if (mounted) setState(() {});
  }

  ApiException? _error;
  bool _loading = true;
  bool _saving = false;

  final _goal = TextEditingController();
  final _custom = TextEditingController();
  final _focusInput = TextEditingController();
  String _companyId = 'faang-general';
  Seniority _seniority = Seniority.mid;
  final _focusAreas = <String>[];

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _goal.addListener(_draftChanged);
    _custom.addListener(_draftChanged);
    _load();
  }

  @override
  void dispose() {
    _persistTarget();
    _goal.dispose();
    _custom.dispose();
    _focusInput.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final api = context.read<ApiClient>();
    _draftKeys = context.read<AdventureController>().keyValueStore;
    try {
      final results = await Future.wait([
        api.fetchCompanies(),
        api.fetchTarget(),
      ]);

      final raw = await _draftKeys?.readKey('target-draft');
      if (!mounted) return;
      setState(() {
        _companies = results[0] as List<CompanyProfile>;
        final target = results[1] as Target?;
        _saved = target;
        if (target != null) _adopt(target);
        if (raw != null) {
          try {
            _adopt(Target.from(jsonDecode(raw)));
          } catch (_) {}
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _adopt(Target target) {
    _adopting = true;
    _goal.text = target.goal;
    _companyId = target.companyId;
    _custom.text = target.customCompany;
    _seniority = target.seniority;
    _focusAreas
      ..clear()
      ..addAll(target.focusAreas);
    _adopting = false;
  }

  CompanyProfile? get _company =>
      _companies.where((c) => c.id == _companyId).firstOrNull;

  Future<void> _save() async {
    if (_goal.text.trim().isEmpty) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = await context.read<ApiClient>().saveTarget(
        Target(
          goal: _goal.text.trim(),
          companyId: _companyId,
          customCompany: _custom.text.trim(),
          seniority: _seniority,
          focusAreas: List.unmodifiable(_focusAreas),
        ),
      );
      if (!mounted) return;
      setState(() => _saved = saved);
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Target saved.')));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final colors = context.gameColors;
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _saved == null && _companies.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(18),
        child: ApiErrorCard(
          error: _error!,
          onRetry: _load,
          retryLabel: 'Reload',
        ),
      );
    }
    final company = _company;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
      children: [
        Text(
          _saved != null &&
                  jsonEncode(_collectTarget().toJson()) ==
                      jsonEncode(_saved!.toJson())
              ? 'Target saved'
              : 'Unsaved target changes',
        ),
        _SectionCard(
          title: 'Your goal',
          subtitle: 'One sentence: what role are you preparing for?',
          child: TextField(
            controller: _goal,
            decoration: const InputDecoration(
              hintText: 'Backend engineer at an AI lab',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        _SectionCard(
          title: 'Target company',
          subtitle: 'Profiles are curated data — the generator rephrases them but never invents process facts.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<String>(
                initialValue: company != null ? _companyId : 'custom',
                decoration: const InputDecoration(border: OutlineInputBorder()),
                items: [
                  for (final c in _companies)
                    DropdownMenuItem(value: c.id, child: Text(c.label)),
                  const DropdownMenuItem(
                    value: 'custom',
                    child: Text('Custom company…'),
                  ),
                ],
                onChanged: (v) => setState(() {
                  _companyId = v ?? 'custom';
                  _persistTarget();
                }),
              ),
              if (company == null || _companyId == 'custom') ...[
                const SizedBox(height: 10),
                TextField(
                  controller: _custom,
                  decoration: const InputDecoration(
                    labelText: 'Company name',
                    hintText: 'Acme Robotics',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Custom companies use generic axes: coding, behavioral, and past-work depth.',
                  style: TextStyle(fontSize: 11.5, color: colors.muted),
                ),
              ],
              if (company != null) ...[
                const SizedBox(height: 10),
                Text(
                  '${company.label} looks for',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: colors.onSurface,
                  ),
                ),
                for (final axis in company.hiringAxes)
                  Text(
                    '• ${axis.label}',
                    style: TextStyle(fontSize: 12, color: colors.muted),
                  ),
                const SizedBox(height: 6),
                Text(
                  'Rounds',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: colors.onSurface,
                  ),
                ),
                for (final round in company.rounds)
                  Text(
                    '• ${round.name}: ${round.focus}',
                    style: TextStyle(fontSize: 12, color: colors.muted),
                  ),
              ],
            ],
          ),
        ),
        _SectionCard(
          title: 'Seniority & focus',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final s in Seniority.values)
                    ChoiceChip(
                      selected: _seniority == s,
                      onSelected: (_) => setState(() {
                        _seniority = s;
                        _persistTarget();
                      }),
                      label: Text(s.label),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final f in _focusAreas)
                    Chip(
                      label: Text(f, style: const TextStyle(fontSize: 12)),
                      onDeleted: () => setState(() => _focusAreas.remove(f)),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _focusInput,
                      decoration: const InputDecoration(
                        hintText: 'Add a focus area',
                        border: OutlineInputBorder(),
                      ),
                      onSubmitted: (_) => _addFocus(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: _addFocus,
                    icon: const Icon(Icons.add_rounded),
                    tooltip: 'Add focus area',
                  ),
                ],
              ),
            ],
          ),
        ),
        if (_error != null)
          ApiErrorCard(
            error: _error!,
            onRetry: _save,
            retryLabel: 'Save again',
          ),
        FilledButton.icon(
          onPressed: (_saving || _goal.text.trim().isEmpty) ? null : _save,
          icon: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded, size: 18),
          label: Text(_saving ? 'Saving…' : 'Save target'),
        ),
      ],
    );
  }

  void _addFocus() {
    final value = _focusInput.text.trim();
    if (value.isEmpty ||
        _focusAreas.contains(value) ||
        _focusAreas.length >= 12) {
      return;
    }
    setState(() {
      _focusAreas.add(value);
      _focusInput.clear();
    });
  }
}

// ---------------------------------------------------------------- interview

/// Grounded question cards with source chips and one-tap practice boards.
class _InterviewTab extends StatefulWidget {
  const _InterviewTab({this.kitId});
  final String? kitId;

  @override
  State<_InterviewTab> createState() => _InterviewTabState();
}

class _InterviewTabState extends State<_InterviewTab>
    with AutomaticKeepAliveClientMixin {
  Resume? _resume;
  InterviewKit? _kit;
  List<InterviewKitSummary> _history = const [];
  ApiException? _error;
  bool _loading = true;
  bool _generating = false;
  bool _opening = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final api = context.read<ApiClient>();
    try {
      final results = await Future.wait([
        api.fetchResume(),
        api.fetchInterviewKits(),
      ]);
      if (!mounted) return;
      setState(() {
        _resume = results[0] as Resume;
        _history = results[1] as List<InterviewKitSummary>;
      });
      if (widget.kitId != null) {
        final kit = await api.fetchInterviewKit(widget.kitId!);
        if (mounted) setState(() => _kit = kit);
      }
      setState(() {});
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _generate({required bool newAngle}) async {
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final kit = await api.generateInterview(newAngle: newAngle);
      if (!mounted) return;
      setState(() => _kit = kit);
      try {
        final history = await api.fetchInterviewKits();
        if (mounted) setState(() => _history = history);
      } on ApiException {
        // History is secondary; the kit is what matters.
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _generating = false);
    }
  }

  Future<void> _openKit(String id) async {
    setState(() {
      _opening = true;
      _error = null;
    });
    try {
      final kit = await context.read<ApiClient>().fetchInterviewKit(id);
      if (mounted) setState(() => _kit = kit);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  void _openPractice(BuildContext context, String problemId) {
    final catalogue = context.read<CatalogueController>().catalogue;
    final problem = catalogue?.problemById(problemId);
    if (problem == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Open the map first so the catalogue loads, then try again.',
          ),
        ),
      );
      return;
    }
    final topic = catalogue!.topics.firstWhere(
      (t) => t.problems.any((p) => p.id == problemId),
      orElse: () => catalogue.topics.first,
    );
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            ProblemScreen(topic: topic, initialProblemId: problemId),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final colors = context.gameColors;
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _resume == null) {
      return Padding(
        padding: const EdgeInsets.all(18),
        child: ApiErrorCard(
          error: _error!,
          onRetry: _load,
          retryLabel: 'Reload',
        ),
      );
    }
    final kit = _kit;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
      children: [
        _SectionCard(
          title: 'Generate questions',
          subtitle: 'Grounded in your resume and target — each card shows its source.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: _generating || _opening
                        ? null
                        : () => _generate(newAngle: false),
                    icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                    label: Text(
                      _generating
                          ? 'Generating…'
                          : (kit == null
                                ? 'Generate my questions'
                                : 'Regenerate'),
                    ),
                  ),
                  if (kit != null)
                    OutlinedButton(
                      onPressed: _generating || _opening
                          ? null
                          : () => _generate(newAngle: true),
                      child: const Text('New angle'),
                    ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                ApiErrorCard(
                  error: _error!,
                  onRetry: () => _generate(newAngle: false),
                  retryLabel: 'Try again',
                ),
              ],
              if (kit != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '${kit.questions.length} questions · ${kit.usedTier == 'template' ? 'Built-in practice set (AI generation unavailable)' : 'AI generated, checked against your saved context'}',
                    style: TextStyle(fontSize: 11, color: colors.muted),
                  ),
                ),
            ],
          ),
        ),
        if (kit != null)
          for (final q in kit.questions)
            Column(
              children: [
                _QuestionCard(
                  question: q,
                  sourceLabel: _resume?.sourceLabel(q.sourceRef) ?? q.sourceRef,
                  onPractice: q.practiceProblemId == null
                      ? null
                      : () => _openPractice(context, q.practiceProblemId!),
                ),
                TextButton.icon(
                  onPressed: () => ChatScreen.open(
                    context,
                    prompt:
                        'Practise this interview question with me one step at a time: ${q.prompt}',
                    reference: {
                      'type': 'interview',
                      'kitId': kit.kitId,
                      'questionId': q.id,
                    },
                  ),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text('Practise in Chat'),
                ),
              ],
            ),
        if (_history.isNotEmpty)
          _SectionCard(
            title: 'Past kits',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final h in _history)
                  TextButton.icon(
                    onPressed: _opening || _generating
                        ? null
                        : () => _openKit(h.kitId),
                    icon: const Icon(Icons.history),
                    label: Text(
                      '${DateTime.fromMillisecondsSinceEpoch(h.createdAt).toLocal().toString().split('.').first} · ${h.count} questions · ${h.usedTier}',
                      style: TextStyle(fontSize: 11.5, color: colors.muted),
                    ),
                  ),
                if (_opening) const LinearProgressIndicator(),
              ],
            ),
          ),
      ],
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.question,
    required this.sourceLabel,
    this.onPractice,
  });

  final InterviewQuestion question;
  final String sourceLabel;
  final VoidCallback? onPractice;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(13, 11, 13, 11),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              MiniLabel(
                text: question.type.label,
                icon: Icons.forum_outlined,
                color: colors.primary,
              ),
              MiniLabel(
                text: question.difficulty,
                icon: Icons.speed_rounded,
                color: colors.muted,
              ),
              MiniLabel(
                text: 'from: $sourceLabel',
                icon: Icons.link_rounded,
                color: colors.muted,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            question.prompt,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 5),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'Why this question: ',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: colors.onSurface,
                  ),
                ),
                TextSpan(
                  text: question.whyItFits,
                  style: TextStyle(fontSize: 12, color: colors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(height: 3),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'What they listen for: ',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: colors.onSurface,
                  ),
                ),
                TextSpan(
                  text: question.listeningFor,
                  style: TextStyle(fontSize: 12, color: colors.muted),
                ),
              ],
            ),
          ),
          if (question.followUps.isNotEmpty) ...[
            const SizedBox(height: 5),
            for (final f in question.followUps)
              Text('• $f', style: TextStyle(fontSize: 12, color: colors.muted)),
          ],
          if (onPractice != null) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: onPractice,
                icon: const Icon(Icons.play_arrow_rounded, size: 17),
                label: const Text('Practise this'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ shared

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.title,
    this.subtitle,
    this.trailing,
    required this.child,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(13, 11, 13, 13),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                    color: colors.onSurface,
                  ),
                ),
              ),
              ?trailing,
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 3),
            Text(
              subtitle!,
              style: TextStyle(
                fontSize: 11.5,
                height: 1.35,
                color: colors.muted,
              ),
            ),
          ],
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}
