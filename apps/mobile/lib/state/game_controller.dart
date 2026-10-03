/// The one game in flight: spec, state, outcome, phase, and the client-side
/// history that powers the rewind / trace-scrub affordances.
///
/// Two different "go back" features, deliberately kept apart:
///
///  * [history] is a read-only *scrub*. It holds a board snapshot after every
///    action the server returned, so the player can look back at what changed.
///    Scrubbing never mutates the game, and the play screen says so.
///  * [undoLastAction] is a real undo. It calls the server, because the oracle
///    owns the authoritative trace. Undoing only the board locally would leave
///    the undone action in the trace, and the debrief would then replay a step
///    the player has already taken back.
library;

import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../models/action.dart';
import '../models/guidance.dart';
import '../models/api.dart';
import '../models/problem.dart';
import '../models/provider.dart';
import '../models/spec.dart';
import '../models/state.dart';
import '../services/api_client.dart';
import '../services/api_exception.dart';

/// Where the player is in the generate → play → debrief loop.
enum GameStatus {
  idle,
  generating,
  playing,

  /// The game is over and a debrief is available.
  finished,

  /// Generation or an action failed. [GameController.error] explains it.
  failed,
}

/// One accepted action plus the board it produced.
class HistoryEntry {
  const HistoryEntry({
    required this.action,
    required this.outcome,
    required this.state,
  });

  final Action action;
  final ActionOutcome outcome;

  /// The state *after* this action was applied by the engine.
  final GameState state;

  bool get wasMistake => outcome.isMistake;
}

class GameController extends ChangeNotifier {
  GameController(this._api);

  final ApiClient _api;
  final _random = Random();
  int _generationEpoch = 0;
  Completer<void>? _generationAbort;
  void cancelGeneration() {
    _generationEpoch++;
    if (_generationAbort?.isCompleted == false) _generationAbort!.complete();
    _status = GameStatus.idle;
    notifyListeners();
  }

  // ---------------------------------------------------------------- identity

  String? _gameId;
  GameSpec? _spec;
  GameState? _state;
  TurnPrompt? _turnPrompt;
  TurnPrompt? get turnPrompt=>_turnPrompt;
  Debrief? _debrief;
  ProblemMeta? _problem;

  GameStatus _status = GameStatus.idle;
  ApiException? _error;

  // ------------------------------------------------------------- generation

  ProviderTier? _usedTier;
  List<ProviderAttempt> _attempts = const [];
  List<String> _notes = const [];
  int _seed = 0;
  Difficulty _difficulty = Difficulty.easy;
  String _wish = '';

  /// Result of the optional `/api/decide` routing of the player's wish.
  DecideResponse? _wishRouting;

  // ----------------------------------------------------------------- play

  ActionOutcome? _lastOutcome;
  List<HistoryEntry> _history = const [];
  bool _actionInFlight = false;
  bool _expectationRevealed = false;
  bool _hintInFlight = false;

  /// The history index currently being *viewed*, or `null` when live.
  int? _rewoundTo;

  String? _lastFlavour;
  String? _hint;
  CoachSource? _hintSource;
  int _hintsUsed = 0;

  /// Incremented on every completed game so a listener can tell "new debrief"
  /// from "the same debrief object".
  int _debriefEpoch = 0;

  // --------------------------------------------------------------- getters

  String? get gameId => _gameId;
  GameSpec? get spec => _spec;
  GameState? get state => _state;
  Debrief? get debrief => _debrief;
  ProblemMeta? get problem => _problem;
  GameStatus get status => _status;
  ApiException? get error => _error;
  ProviderTier? get usedTier => _usedTier;
  List<ProviderAttempt> get attempts => _attempts;
  List<String> get notes => _notes;
  int get seed => _seed;
  Difficulty get difficulty => _difficulty;
  String get wish => _wish;
  DecideResponse? get wishRouting => _wishRouting;
  ActionOutcome? get lastOutcome => _lastOutcome;
  List<HistoryEntry> get history => _history;
  bool get isActionInFlight => _actionInFlight;
  bool get isGenerating => _status == GameStatus.generating;
  bool get hasGame => _gameId != null && _state != null && _spec != null;

  /// True once the player has opened the "the algorithm expected…" affordance.
  bool get expectationRevealed => _expectationRevealed;

  /// True while a `/api/hint` request is outstanding.
  bool get hintInFlight => _hintInFlight;

  bool get isRewound => _rewoundTo != null;
  int? get rewoundTo => _rewoundTo;

  /// True when a real, server-side undo is possible: a game is open, it is
  /// still being played, and at least one action has been applied.
  ///
  /// The final move is not undoable because a finished game is handed to the
  /// debrief, and silently rewinding a completed run would be more confusing
  /// than helpful.
  bool get canUndo =>
      _gameId != null &&
      !_actionInFlight &&
      _status == GameStatus.playing &&
      _history.isNotEmpty;
  String? get lastFlavour => _lastFlavour;
  String? get hint => _hint;
  CoachSource? get hintSource => _hintSource;
  int get hintsUsed => _hintsUsed;
  int get debriefEpoch => _debriefEpoch;
  bool get isFinished => _status == GameStatus.finished;

  /// The state the board should draw: the rewound snapshot when the player is
  /// reviewing history, otherwise the live one.
  GameState? get visibleState {
    final index = _rewoundTo;
    if (index == null) return _state;
    if (index < 0 || index >= _history.length) return _state;
    return _history[index].state;
  }

  /// The history index a trace frame corresponds to, when the client has a
  /// snapshot for it. Frames produced before this session are `null`.
  int? historyIndexForTraceStep(int traceStep) {
    for (var i = 0; i < _history.length; i++) {
      if (_history[i].outcome.traceStep == traceStep) return i;
    }
    return null;
  }

  // -------------------------------------------------------------- settings

  void setDifficulty(Difficulty value) {
    if (_difficulty == value) return;
    _difficulty = value;
    notifyListeners();
  }

  void setWish(String value) {
    if (_wish == value) return;
    _wish = value;
    notifyListeners();
  }

  // ------------------------------------------------------------- generation

  /// Generates a game for [problem].
  ///
  /// Pass `forceNewSeed: true` (the "play a new version" button) to omit the
  /// seed entirely, which is how the contract requests "a random instance + a
  /// fresh theme".
  Future<void> generate(
    ProblemMeta problem, {
    bool forceNewSeed = false,
    bool routeWish = true,
    bool forceTemplate = false,
  }) async {
    final generation = ++_generationEpoch;
    if (_generationAbort?.isCompleted == false) _generationAbort!.complete();
    final abort = Completer<void>();
    _generationAbort = abort;
    _resetRun();
    _problem = problem;
    _status = GameStatus.generating;
    _error = null;
    notifyListeners();

    final trimmedWish = _wish.trim();
    DecideResponse? routing;
    // Route the wish first so the difficulty it implies is part of the
    // generate request. A routing failure is non-fatal: the wish still steers
    // the theme via `freeText`.
    if (routeWish && trimmedWish.isNotEmpty) {
      routing = await _routeWish(trimmedWish, problem);
      if (routing != null &&
          routing.source == CoachSource.heuristic &&
          routing.choice.isEmpty) {
        routing = null;
      }
    }
    if (generation != _generationEpoch) return;
    _wishRouting = routing;

    // A fresh seed means a new instance *and* a new theme, so the previous
    // seed is deliberately not resent.
    final seed = forceNewSeed || _seed == 0 ? null : _seed;
    final request = GenerateRequest(
      problemId: problem.id,
      seed: seed,
      difficulty: _difficulty,
      freeText: trimmedWish.isEmpty ? null : trimmedWish,
      forceTemplate: forceTemplate,
    );

    try {
      final response = await _api.generate(request, abortTrigger: abort.future);
      if (generation != _generationEpoch) return;
      _gameId = response.gameId;
      _spec = response.spec;
      _state = response.state;
      _turnPrompt=response.turnPrompt;
      _seed = response.seed;
      _usedTier = response.usedTier;
      _attempts = response.attempts;
      _notes = response.notes;
      _history = const [];
      _lastOutcome = null;
      _lastFlavour = _spec?.narration.correctFlavour.isNotEmpty == true
          ? _spec!.narration.correctFlavour.first
          : null;
      _status = response.state.isPlaying
          ? GameStatus.playing
          : GameStatus.finished;
      _debrief = null;
      _error = null;
      if (_status == GameStatus.finished) _debriefEpoch++;
    } on ApiException catch (e) {
      if (generation != _generationEpoch) return;
      _error = e;
      _status = GameStatus.failed;
    }
    notifyListeners();
  }

  void adoptGenerated(
    GenerateResponse response,
    ProblemMeta problem, {
    Difficulty? difficulty,
  }) {
    _resetRun();
    _problem = problem;
    _difficulty = difficulty ?? problem.defaultDifficulty;
    _gameId = response.gameId;
    _spec = response.spec;
    _state = response.state;
      _turnPrompt=response.turnPrompt;
    _seed = response.seed;
    _usedTier = response.usedTier;
    _attempts = response.attempts;
    _notes = response.notes;
    _status = response.state.isPlaying
        ? GameStatus.playing
        : GameStatus.finished;
    notifyListeners();
  }

  Future<void> restore(String id, ProblemMeta problem) async {
    final raw = await _api.fetchGame(id);
    adoptGenerated(
      GenerateResponse.from({
        ...raw,
        'gameId': id,
        'problemId': problem.id,
        'attempts': raw['attempts'] ?? [],
        'notes': raw['notes'] ?? [],
        'usedTier': raw['usedTier'] ?? 'template',
      }),
      problem,
      difficulty:Difficulty.parse(raw['difficulty']),
    );
  }

  /// Asks the coach (`POST /api/decide`) how to read the player's wish.
  ///
  /// The only decision the client genuinely needs is difficulty; everything
  /// else about the wish is passed straight through as `freeText` for theme
  /// steering. Returns `null` on failure so generation still proceeds.
  Future<DecideResponse?> _routeWish(String wish, ProblemMeta problem) async {
    try {
      return await _api.decide(
        DecideRequest(
          kind: DecisionKind.difficulty,
          stateText:
              'Problem: ${problem.title}. ${problem.learningObjective}\nPlayer wish: $wish',
          options: const {
            'easy': 'A gentle first run: short data, forgiving, one idea at a time.',
            'medium': 'A real workout: the usual data size, a couple of decisions per step.',
            'hard': 'Bring the pressure: largest data size, tight moves, little hand-holding.',
          },
          instructions:
              'Choose the difficulty that best matches what the player asked for in their wish. '
              'Answer with exactly one of the option keys.',
        ),
      );
    } on ApiException {
      return null;
    }
  }

  void _resetRun() {
    _turnPrompt=null;
    _gameId = null;
    _spec = null;
    _state = null;
    _debrief = null;
    _lastOutcome = null;
    _history = const [];
    _actionInFlight = false;
    _expectationRevealed = false;
    _rewoundTo = null;
    _lastFlavour = null;
    _hint = null;
    _hintSource = null;
    _hintsUsed = 0;
    _hintInFlight = false;
    _usedTier = null;
    _attempts = const [];
    _notes = const [];
    _wishRouting = null;
    _error = null;
  }

  // ------------------------------------------------------------------ play

  /// Sends [action] to the engine and folds the response into local state.
  Future<void> dispatch(Action action) async {
    final gameId = _gameId;
    if (gameId == null || _actionInFlight) return;
    // Never let the player act on a rewound view: the engine has moved on.
    _rewoundTo = null;
    _actionInFlight = true;
    _expectationRevealed = false;
    _lastFlavour = null;
    notifyListeners();

    try {
      final response = await _api.submitAction(gameId: gameId, action: action);
      _state = response.state;
      _turnPrompt=response.turnPrompt;
      _lastOutcome = response.outcome;
      _usedTier = response.usedTier;
      _history = [
        ..._history,
        HistoryEntry(
          action: action,
          outcome: response.outcome,
          state: response.state,
        ),
      ];
      if (response.outcome.correct) {
        final flavour = _spec?.narration.correctFlavour;
        if (flavour != null && flavour.isNotEmpty) {
          _lastFlavour = flavour[_random.nextInt(flavour.length)];
        }
      }
      final finished =
          response.debrief != null || response.state.phase.isTerminal;
      if (finished) {
        _debrief = response.debrief;
        _status = GameStatus.finished;
        _debriefEpoch++;
      }
      _error = null;
    } on ApiException catch (e) {
      // A failed action must never be a dead end: keep the board exactly as it
      // was, clear the in-flight flag and let the player try again.
      _error = e;
    } finally {
      _actionInFlight = false;
      notifyListeners();
    }
  }

  /// Toggles the "the algorithm expected…" affordance for the last mistake.
  void revealExpectation() {
    if (_expectationRevealed) return;
    _expectationRevealed = true;
    notifyListeners();
  }

  void dismissOutcome() {
    if (_lastOutcome == null &&
        !_expectationRevealed &&
        _lastFlavour == null &&
        _error == null) {
      return;
    }
    _lastOutcome = null;
    _expectationRevealed = false;
    _lastFlavour = null;
    _error = null;
    notifyListeners();
  }

  /// Requests one throttled hint for the current game.
  Future<void> requestHint() async {
    final gameId = _gameId;
    if (gameId == null || _hintInFlight) return;
    _hintInFlight = true;
    notifyListeners();
    try {
      final response = await _api.requestHint(gameId);
      _hint = response.hint;
      _hintSource = response.source;
      _hintsUsed++;
      _error = null;
    } on ApiException catch (e) {
      _error = e;
    } finally {
      _hintInFlight = false;
      notifyListeners();
    }
  }

  void dismissHint() {
    if (_hint == null && _error == null) return;
    _hint = null;
    _error = null;
    notifyListeners();
  }

  /// Scrubs the board to the state captured after history entry [index].
  void rewindTo(int index) {
    if (index < 0 || index >= _history.length) return;
    if (_rewoundTo == index) return;
    _rewoundTo = index;
    notifyListeners();
  }

  void returnToLive() {
    if (_rewoundTo == null) return;
    _rewoundTo = null;
    notifyListeners();
  }

  /// The single step back through history, i.e. the undo affordance.
  void stepBack() {
    final index = _rewoundTo ?? _history.length;
    if (index <= 0) return;
    rewindTo(index - 1);
  }

  /// Takes back the most recent action, on the server.
  ///
  /// This is the one that changes the game. Scrubbing ([stepBack]) does not.
  /// Mistakes stay counted after an undo on purpose: a mistake is a fact about
  /// the player's history, not a counter that should rewind, and the debrief's
  /// misconception tag depends on it.
  Future<void> undoLastAction() async {
    if (_actionInFlight || _status == GameStatus.idle) return;
    final gameId = _gameId;
    if (gameId == null) return;

    _actionInFlight = true;
    notifyListeners();
    try {
      final restored = await _api.undo(gameId);
      if (restored == null) return; // nothing to undo; leave the game alone
      _state = restored;
      _turnPrompt=null;
      try{final snapshot=await _api.fetchGame(gameId);if(snapshot['turnPrompt']!=null)_turnPrompt=TurnPrompt.from(snapshot['turnPrompt']);}catch(_){}
      _lastOutcome = null;
      // Drop the snapshot of the action we just took back, so the scrub rail
      // cannot show a board the server no longer considers part of the game.
      if (_history.isNotEmpty) {
        _history = _history.sublist(0, _history.length - 1);
      }
      _rewoundTo = null;
      _status = GameStatus.playing;
    } on ApiException {
      // The undo stack is empty or expired; the board is already the truth.
    } finally {
      _actionInFlight = false;
      notifyListeners();
    }
  }

  void stepForward() {
    final index = _rewoundTo;
    if (index == null) return;
    if (index >= _history.length - 1) return;
    rewindTo(index + 1);
  }

  /// Leaves the finished game, keeping the debrief for the caller to read.
  void clearRun() {
    cancelGeneration();
    _resetRun();
    _status = GameStatus.idle;
    notifyListeners();
  }
}
