/// The linked-list field notebook: reading material, two first-party
/// questions, five-language reference code, and saved answer drafts.
///
/// Drafts are stored on-device through the same [ProgressBackend] as mission
/// progress (separate keys — drafts never touch completion). Solved markers
/// are *derived* from mission completion, so winning the mapped game marks
/// the question solved with no second source of truth.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../adventure/progress_store.dart';
import '../adventure/robot_guide.dart';
import '../state/catalogue_controller.dart';
import '../state/game_controller.dart';
import '../theme/palette.dart';
import '../widgets/common.dart';
import 'play_screen.dart';

const List<String> notebookLanguages = [
  'javascript',
  'typescript',
  'python',
  'java',
  'cpp',
];

const Map<String, String> languageLabels = {
  'javascript': 'JavaScript',
  'typescript': 'TypeScript',
  'python': 'Python',
  'java': 'Java',
  'cpp': 'C++',
};

class NotebookQuestion {
  const NotebookQuestion({
    required this.id,
    required this.title,
    required this.gameProblemId,
    required this.prompt,
    required this.objective,
  });

  final String id;
  final String title;
  final String gameProblemId;
  final String prompt;
  final String objective;
}

const List<NotebookQuestion> notebookQuestions = [
  NotebookQuestion(
    id: 'count-nodes',
    title: 'Count the nodes',
    gameProblemId: 'linked-list-traversal',
    prompt: 'Given the head of a singly linked list, return how many nodes it contains. Follow next pointers until you reach null; do not assume the list has an index or a stored length.',
    objective: 'Practice moving a cursor through one node at a time and stopping at null.',
  ),
  NotebookQuestion(
    id: 'reverse-list',
    title: 'Reverse a singly linked list',
    gameProblemId: 'reverse-linked-list',
    prompt: 'Given the head of a singly linked list, reverse its next links in place and return the new head. Keep the rest of the list reachable while you change each pointer.',
    objective:
        'Practice saving the next node before rewiring the current node.',
  ),
];

const List<Map<String, String>> notebookReadings = [
  {
    'title': 'Singly linked lists in JavaScript',
    'source': 'trekhleb/javascript-algorithms',
    'href': 'https://github.com/trekhleb/javascript-algorithms/tree/master/src/data-structures/linked-list',
    'note':
        'A linked-list overview with implementation notes and further reading.',
  },
  {
    'title': 'Singly linked list in Python',
    'source': 'TheAlgorithms/Python',
    'href': 'https://github.com/TheAlgorithms/Python/blob/master/data_structures/linked_list/singly_linked_list.py',
    'note': 'A worked Python implementation in an MIT-licensed algorithms collection.',
  },
];

/// Reference solutions, one per question per language. Shown only after the
/// learner has attempted the question or opens the reference explicitly —
/// never as the first thing on the page.
const Map<String, Map<String, String>> notebookExamples = {
  'count-nodes': {
    'javascript': 'function length(head) {\n  let count = 0;\n  let current = head;\n  while (current !== null) {\n    count++;\n    current = current.next;\n  }\n  return count;\n}',
    'typescript': 'function length<T>(head: Node<T> | null): number {\n  let count = 0;\n  let current = head;\n  while (current !== null) {\n    count++;\n    current = current.next;\n  }\n  return count;\n}',
    'python': 'def length(head):\n    count = 0\n    current = head\n    while current is not None:\n        count += 1\n        current = current.next\n    return count',
    'java': 'int length(Node head) {\n  int count = 0;\n  Node current = head;\n  while (current != null) {\n    count++;\n    current = current.next;\n  }\n  return count;\n}',
    'cpp': 'int length(Node* head) {\n  int count = 0;\n  Node* current = head;\n  while (current != nullptr) {\n    ++count;\n    current = current->next;\n  }\n  return count;\n}',
  },
  'reverse-list': {
    'javascript': 'function reverseList(head) {\n  let previous = null;\n  let current = head;\n  while (current !== null) {\n    const next = current.next;\n    current.next = previous;\n    previous = current;\n    current = next;\n  }\n  return previous;\n}',
    'typescript': 'function reverseList<T>(head: Node<T> | null): Node<T> | null {\n  let previous: Node<T> | null = null;\n  let current = head;\n  while (current !== null) {\n    const next = current.next;\n    current.next = previous;\n    previous = current;\n    current = next;\n  }\n  return previous;\n}',
    'python': 'def reverse_list(head):\n    previous = None\n    current = head\n    while current is not None:\n        next_node = current.next\n        current.next = previous\n        previous = current\n        current = next_node\n    return previous',
    'java': 'Node reverseList(Node head) {\n  Node previous = null;\n  Node current = head;\n  while (current != null) {\n    Node next = current.next;\n    current.next = previous;\n    previous = current;\n    current = next;\n  }\n  return previous;\n}',
    'cpp': 'Node* reverseList(Node* head) {\n  Node* previous = nullptr;\n  Node* current = head;\n  while (current != nullptr) {\n    Node* next = current->next;\n    current->next = previous;\n    previous = current;\n    current = next;\n  }\n  return previous;\n}',
  },
};

const Map<String, Map<String, String>> notebookStarters = {
  'count-nodes': {
    'javascript': 'function length(head) {\n  // TODO: count each node reached from head\n}',
    'typescript': 'function length<T>(head: Node<T> | null): number {\n  // TODO: count each node reached from head\n}',
    'python': 'def length(head):\n    # TODO: count each node reached from head\n    pass',
    'java': 'int length(Node head) {\n  // TODO: count each node reached from head\n}',
    'cpp': 'int length(Node* head) {\n  // TODO: count each node reached from head\n}',
  },
  'reverse-list': {
    'javascript': 'function reverseList(head) {\n  // TODO: keep previous and current pointers\n}',
    'typescript': 'function reverseList<T>(head: Node<T> | null): Node<T> | null {\n  // TODO: keep previous and current pointers\n}',
    'python': 'def reverse_list(head):\n    # TODO: keep previous and current pointers\n    return None',
    'java': 'Node reverseList(Node head) {\n  // TODO: keep previous and current pointers\n}',
    'cpp': 'Node* reverseList(Node* head) {\n  // TODO: keep previous and current pointers\n}',
  },
};

String draftKey(String questionId, String language) =>
    'play-the-algorithms:draft:$questionId:$language';

/// Tiny draft store over the generic [ProgressBackend]. Draft keys never
/// overlap adventure progress keys, so saving code cannot mint or erase a
/// stamp.
class DraftStore extends ChangeNotifier {
  DraftStore(this._store);

  final KeyValueStore _store;
  final Map<String, String> _cache = {};
  final Set<String> _loaded = {};

  String draft(String questionId, String language) =>
      _cache[draftKey(questionId, language)] ??
      notebookStarters[questionId]?[language] ??
      '';

  Future<void> load(String questionId, String language) async {
    final key = draftKey(questionId, language);
    if (_loaded.contains(key)) return;
    _loaded.add(key);
    try {
      final raw = await _store.readKey(key);
      if (raw != null) {
        _cache[key] = raw;
        notifyListeners();
      }
    } catch (_) {
      // Drafts are a nicety; the starter text is already showing.
    }
  }

  Future<void> save(String questionId, String language, String text) async {
    final key = draftKey(questionId, language);
    _cache[key] = text;
    notifyListeners();
    try {
      await _store.writeKey(key, text);
    } catch (_) {
      // Keep the in-memory draft; the next load retries from storage.
    }
  }
}

class LearnScreen extends StatefulWidget {
  const LearnScreen({super.key});

  @override
  State<LearnScreen> createState() => _LearnScreenState();
}

class _LearnScreenState extends State<LearnScreen> {
  String _language = 'javascript';
  DraftStore? _drafts;

  DraftStore _storeOf(BuildContext context) {
    final store = context.read<AdventureController>().keyValueStore;
    return _drafts ??= DraftStore(store);
  }

  @override
  void dispose() {
    _drafts?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final completed = context.watch<AdventureController>().progress.completed;
    return Scaffold(
      appBar: AppBar(title: const Text('Field notebook')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
              decoration: BoxDecoration(
                color: colors.surface,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Linked lists, page one.',
                    style: TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                      color: colors.onSurface,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const RobotGuide(
                    text: 'No indexing here — you follow pointers one node at a time. Read a little, then play it.',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const SectionHeading(
              title: 'to read',
              icon: Icons.menu_book_outlined,
            ),
            const SizedBox(height: 8),
            for (final reading in notebookReadings)
              _ReadingCard(reading: reading),
            const SizedBox(height: 16),
            const SectionHeading(
              title: 'to try',
              icon: Icons.edit_note_rounded,
            ),
            const SizedBox(height: 4),
            Text(
              'Solve each prompt by carrying out the algorithm on a generated list. Winning the game marks it solved here.',
              style: TextStyle(fontSize: 12, color: colors.muted),
            ),
            const SizedBox(height: 8),
            for (final question in notebookQuestions)
              _QuestionCard(
                question: question,
                solved: completed.containsKey(question.gameProblemId),
                language: _language,
                onLanguage: (lang) => setState(() => _language = lang),
                drafts: _storeOf(context),
              ),
          ],
        ),
      ),
    );
  }
}

class _ReadingCard extends StatelessWidget {
  const _ReadingCard({required this.reading});

  final Map<String, String> reading;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            reading['title']!,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            reading['source']!,
            style: TextStyle(fontSize: 11, color: colors.muted),
          ),
          const SizedBox(height: 4),
          Text(
            reading['note']!,
            style: TextStyle(fontSize: 12, color: colors.muted),
          ),
          const SizedBox(height: 4),
          SelectableText(
            reading['href']!,
            style: TextStyle(
              fontSize: 10.5,
              fontFamily: 'monospace',
              color: colors.primary,
            ),
          ),
        ],
      ),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.question,
    required this.solved,
    required this.language,
    required this.onLanguage,
    required this.drafts,
  });

  final NotebookQuestion question;
  final bool solved;
  final String language;
  final ValueChanged<String> onLanguage;
  final DraftStore drafts;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: solved
              ? colors.success.withValues(alpha: 0.5)
              : colors.muted.withValues(alpha: 0.22),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                solved
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 17,
                color: solved ? colors.success : colors.muted,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  question.title,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w900,
                    color: colors.onSurface,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            question.prompt,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.4,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            question.objective,
            style: TextStyle(fontSize: 11.5, color: colors.muted),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final lang in notebookLanguages)
                ChoiceChip(
                  selected: language == lang,
                  onSelected: (_) => onLanguage(lang),
                  label: Text(
                    languageLabels[lang]!,
                    style: const TextStyle(fontSize: 11.5),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          _DraftEditor(question: question, language: language, drafts: drafts),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => _playGame(context),
                  icon: const Icon(Icons.play_arrow_rounded, size: 17),
                  label: const Text('Play this algorithm'),
                ),
              ),
              const SizedBox(width: 8),
              _ReferenceButton(question: question, language: language),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _playGame(BuildContext context) async {
    final catalogue = context.read<CatalogueController>().catalogue;
    final problem = catalogue?.problemById(question.gameProblemId);
    if (problem == null) return;
    final game = context.read<GameController>();
    await game.generate(problem, routeWish: false);
    if (!context.mounted || !game.hasGame) return;
    await Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => const PlayScreen()));
  }
}

class _DraftEditor extends StatefulWidget {
  const _DraftEditor({
    required this.question,
    required this.language,
    required this.drafts,
  });

  final NotebookQuestion question;
  final String language;
  final DraftStore drafts;

  @override
  State<_DraftEditor> createState() => _DraftEditorState();
}

class _DraftEditorState extends State<_DraftEditor> {
  late final TextEditingController _controller;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: widget.drafts.draft(widget.question.id, widget.language),
    );
    widget.drafts.load(widget.question.id, widget.language).then((_) {
      if (!mounted) return;
      setState(() {
        _controller.text = widget.drafts.draft(
          widget.question.id,
          widget.language,
        );
        _loaded = true;
      });
    });
  }

  @override
  void didUpdateWidget(covariant _DraftEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.language != widget.language ||
        oldWidget.question.id != widget.question.id) {
      _loaded = false;
      _controller.text = widget.drafts.draft(
        widget.question.id,
        widget.language,
      );
      widget.drafts.load(widget.question.id, widget.language).then((_) {
        if (!mounted) return;
        setState(() {
          _controller.text = widget.drafts.draft(
            widget.question.id,
            widget.language,
          );
          _loaded = true;
        });
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      maxLines: 8,
      minLines: 5,
      style: const TextStyle(
        fontSize: 12,
        fontFamily: 'monospace',
        height: 1.4,
      ),
      decoration: InputDecoration(
        hintText: _loaded
            ? 'Write your solution…'
            : 'Loading your saved draft…',
      ),
      onChanged: (text) =>
          widget.drafts.save(widget.question.id, widget.language, text),
    );
  }
}

class _ReferenceButton extends StatelessWidget {
  const _ReferenceButton({required this.question, required this.language});

  final NotebookQuestion question;
  final String language;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: () => showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (sheetContext) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.7,
          builder: (_, scroll) => ListView(
            controller: scroll,
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
            children: [
              Text(
                'Worked answer · ${languageLabels[language]}',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                  color: Theme.of(sheetContext).colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Available after attempting the question — compare, don\'t copy.',
                style: TextStyle(
                  fontSize: 11.5,
                  color: Theme.of(sheetContext).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(sheetContext)
                      .colorScheme
                      .surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: SelectableText(
                  notebookExamples[question.id]?[language] ?? '',
                  style: const TextStyle(
                    fontSize: 12,
                    fontFamily: 'monospace',
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      child: const Text('Answer'),
    );
  }
}
