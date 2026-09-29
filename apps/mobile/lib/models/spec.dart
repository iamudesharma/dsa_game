/// Dart mirror of `packages/game-schema/src/game-spec.ts`.
///
/// The spec is the only LLM-authored document. Everything here is presentation
/// and narration — correctness lives in the oracle. The client treats the spec
/// as *untrusted text* and degrades to sensible defaults everywhere, because a
/// weaker provider tier can produce a thin spec even when it validates.
library;

import 'enums.dart';
import 'json.dart';

/// Hex colours from `spec.visual.palette`. Kept as strings here so the theme
/// layer is the only place that parses colour; the raw wire value survives for
/// the debrief / debug copy.
class Palette {
  const Palette({
    required this.background,
    required this.primary,
    required this.accent,
    required this.success,
    required this.danger,
  });

  factory Palette.from(Object? raw) {
    final map = Json.map(raw);
    return Palette(
      background: Json.str(map['background'], fallback: '#0E1116'),
      primary: Json.str(map['primary'], fallback: '#6C8CFF'),
      accent: Json.str(map['accent'], fallback: '#F2C14E'),
      success: Json.str(map['success'], fallback: '#4CC38A'),
      danger: Json.str(map['danger'], fallback: '#F2545B'),
    );
  }

  /// Neutral fallback used before a spec exists (topic / problem screens) and
  /// when the palette is unusable.
  static const Palette fallback = Palette(
    background: '#0E1116',
    primary: '#6C8CFF',
    accent: '#F2C14E',
    success: '#4CC38A',
    danger: '#F2545B',
  );

  final String background;
  final String primary;
  final String accent;
  final String success;
  final String danger;

  List<String> get all => [background, primary, accent, success, danger];
}

enum Genre {
  fantasy('fantasy'),
  sciFi('sci-fi'),
  detective('detective'),
  everyday('everyday'),
  sport('sport'),
  cooking('cooking'),
  space('space'),
  nature('nature');

  const Genre(this.wire);

  final String wire;

  static final Map<String, Genre> _byWire = {for (final v in values) v.wire: v};

  static Genre parse(Object? raw, {Genre fallback = Genre.everyday}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

enum Tone {
  playful('playful'),
  tense('tense'),
  calm('calm'),
  mysterious('mysterious');

  const Tone(this.wire);

  final String wire;

  static final Map<String, Tone> _byWire = {for (final v in values) v.wire: v};

  static Tone parse(Object? raw, {Tone fallback = Tone.playful}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

class GameTheme {
  const GameTheme({required this.title, required this.story, required this.genre, required this.tone});

  factory GameTheme.from(Object? raw) {
    final map = Json.map(raw);
    return GameTheme(
      title: Json.line(map['title'], fallback: 'Untitled scenario'),
      story: Json.line(map['story'], fallback: 'Work the algorithm to finish the job.'),
      genre: Genre.parse(map['genre']),
      tone: Tone.parse(map['tone']),
    );
  }

  final String title;
  final String story;
  final Genre genre;
  final Tone tone;
}

class VisualSpec {
  const VisualSpec({required this.palette, required this.objectGlyphs, this.boardLabel});

  factory VisualSpec.from(Object? raw) {
    final map = Json.map(raw);
    return VisualSpec(
      palette: Palette.from(map['palette']),
      objectGlyphs: Json.stringList(map['objectGlyphs']),
      boardLabel: Json.strOrNull(map['boardLabel']),
    );
  }

  final Palette palette;

  /// An ordered glyph palette. Empty means "use the catalog default".
  ///
  /// A list, not a map keyed by object kind: opencode-go enforces OpenAI's
  /// strict structured-output rules, which reject JSON-Schema maps
  /// (`additionalProperties: {…}`, `propertyNames`). A `Record` here produced a
  /// bare `400 invalid_request_error`, so the contract ships a list instead and
  /// the client picks from it deterministically.
  final List<String> objectGlyphs;

  final String? boardLabel;

  /// Glyph for an object kind.
  ///
  /// The palette is indexed by the kind's stable ordinal, which only means
  /// something if there is one entry per kind. A shorter palette is decoration
  /// rather than an assignment, and mislabelling a `target` with a `node`
  /// glyph is worse than showing plain text — so below full length we ignore it
  /// entirely and use the catalog defaults.
  String glyphFor(GameObjectKind kind) {
    if (objectGlyphs.length < GameObjectKind.values.length) return kind.defaultGlyph;
    return objectGlyphs[kind.paletteIndex % objectGlyphs.length];
  }
}

class Vocabulary {
  const Vocabulary({
    required this.object,
    required this.objectPlural,
    required this.place,
    required this.actionVerb,
    required this.target,
    required this.lowerWord,
    required this.equalWord,
    required this.higherWord,
  });

  factory Vocabulary.from(Object? raw) {
    final map = Json.map(raw);
    return Vocabulary(
      object: Json.line(map['object'], fallback: 'element'),
      objectPlural: Json.line(map['objectPlural'], fallback: 'elements'),
      place: Json.line(map['place'], fallback: 'the board'),
      actionVerb: Json.line(map['actionVerb'], fallback: 'process'),
      target: Json.line(map['target'], fallback: 'the target'),
      lowerWord: Json.line(map['lowerWord'], fallback: 'lower'),
      equalWord: Json.line(map['equalWord'], fallback: 'equal'),
      higherWord: Json.line(map['higherWord'], fallback: 'higher'),
    );
  }

  /// Used when a spec has no vocabulary at all.
  static const Vocabulary fallback = Vocabulary(
    object: 'element',
    objectPlural: 'elements',
    place: 'the board',
    actionVerb: 'process',
    target: 'the target',
    lowerWord: 'lower',
    equalWord: 'equal',
    higherWord: 'higher',
  );

  final String object;
  final String objectPlural;
  final String place;
  final String actionVerb;
  final String target;
  final String lowerWord;
  final String equalWord;
  final String higherWord;

  /// The themed `lt / eq / gt` triple, positionally aligned with `Relation`.
  (String, String, String) get relationWords => (lowerWord, equalWord, higherWord);
}

class MechanicBinding {
  const MechanicBinding({
    required this.id,
    required this.boundDsaOp,
    required this.label,
    this.hint,
  });

  factory MechanicBinding.from(Object? raw) {
    final map = Json.map(raw);
    return MechanicBinding(
      id: MechanicId.parse(map['id']),
      boundDsaOp: DsaOp.parse(map['boundDsaOp']),
      label: Json.line(map['label'], fallback: 'Act'),
      hint: Json.strOrNull(map['hint']),
    );
  }

  final MechanicId id;

  /// Which real DSA op this mechanic instance represents.
  final DsaOp boundDsaOp;

  /// Theme-flavoured name for the interaction, e.g. "enter the left wing".
  final String label;

  /// Optional one-line nudge shown before the player acts.
  final String? hint;
}

class Narration {
  const Narration({
    required this.intro,
    required this.hintPool,
    required this.win,
    required this.lose,
    required this.correctFlavour,
  });

  factory Narration.from(Object? raw) {
    final map = Json.map(raw);
    return Narration(
      intro: Json.line(map['intro'], fallback: 'Work the algorithm.'),
      hintPool: Json.stringList(map['hintPool']),
      win: Json.line(map['win'], fallback: 'Solved.'),
      lose: Json.line(map['lose'], fallback: 'Out of moves.'),
      correctFlavour: Json.stringList(map['correctFlavour']),
    );
  }

  final String intro;

  /// Ordered hint pool; the engine/Laya picks which to reveal next.
  final List<String> hintPool;

  final String win;
  final String lose;

  /// Optional flavour shown on a correct action.
  final List<String> correctFlavour;
}

class SpecDebrief {
  const SpecDebrief({
    required this.summary,
    required this.actionMeaning,
    required this.mapping,
    required this.codeLanguages,
  });

  factory SpecDebrief.from(Object? raw) {
    final map = Json.map(raw);
    final languages = Json.listOf(map['codeLanguages'], Json.line).whereType<String>().toList();
    return SpecDebrief(
      summary: Json.line(map['summary'], fallback: 'That is the run you played.'),
      actionMeaning: Json.stringMap(map['actionMeaning']),
      mapping: Json.listOf(map['mapping'], _mappingFrom)
          .whereType<MappingRow>()
          .toList(growable: false),
      codeLanguages: languages.isEmpty ? const ['javascript'] : List.unmodifiable(languages),
    );
  }

  /// `mapping` arrives as a list of `{gameTerm, algorithmTerm}` objects.
  ///
  /// The older `[from, to]` tuple form is still accepted: a spec persisted by
  /// a previous build can outlive a hot reload, and dropping its table would
  /// look like a data bug rather than a migration.
  static MappingRow? _mappingFrom(Object? raw) {
    if (raw is Map) {
      final a = Json.strOrNull(raw['gameTerm']);
      final b = Json.strOrNull(raw['algorithmTerm']);
      if (a == null || b == null) return null;
      return MappingRow(gameTerm: a, algorithmTerm: b);
    }
    if (raw is List && raw.length >= 2) {
      final a = Json.strOrNull(raw[0]);
      final b = Json.strOrNull(raw[1]);
      if (a == null || b == null) return null;
      return MappingRow(gameTerm: a, algorithmTerm: b);
    }
    return null;
  }

  /// One-paragraph recap of what the player actually did.
  final String summary;

  /// Keyed by `ActionType.wire`.
  final Map<String, String> actionMeaning;

  /// Metaphor-to-algorithm table.
  final List<MappingRow> mapping;

  /// Language tags for the code blocks.
  final List<String> codeLanguages;
}

class MappingRow {
  const MappingRow({required this.gameTerm, required this.algorithmTerm});

  final String gameTerm;
  final String algorithmTerm;
}

class GameSpec {
  const GameSpec({
    required this.specVersion,
    required this.problemId,
    required this.seed,
    required this.language,
    required this.objective,
    required this.theme,
    required this.visual,
    required this.vocabulary,
    required this.mechanics,
    required this.narration,
    required this.debrief,
    required this.generatedBy,
  });

  factory GameSpec.from(Object? raw) {
    final map = Json.map(raw);
    return GameSpec(
      specVersion: Json.intOr(map['specVersion'], fallback: 1),
      problemId: Json.str(map['problemId']),
      seed: Json.intOr(map['seed']),
      language: Json.str(map['language'], fallback: 'en'),
      objective: Json.line(map['objective'], fallback: 'Work the algorithm step by step.'),
      theme: GameTheme.from(map['theme']),
      visual: VisualSpec.from(map['visual']),
      vocabulary: Vocabulary.from(map['vocabulary']),
      mechanics: Json.listOf(map['mechanics'], MechanicBinding.from)
          .whereType<MechanicBinding>()
          .toList(growable: false),
      narration: Narration.from(map['narration']),
      debrief: SpecDebrief.from(map['debrief']),
      generatedBy: Json.str(map['generatedBy'], fallback: 'unknown'),
    );
  }

  final int specVersion;
  final String problemId;
  final int seed;
  final String language;

  /// Plain-language restatement of the learning objective, in theme.
  final String objective;

  final GameTheme theme;
  final VisualSpec visual;
  final Vocabulary vocabulary;

  /// 1..4 mechanics, all of which must be in the problem's allowed set.
  final List<MechanicBinding> mechanics;

  final Narration narration;
  final SpecDebrief debrief;

  /// Records which provider tier produced this spec. Set by the server.
  final String generatedBy;

  bool hasMechanic(MechanicId id) => mechanics.any((m) => m.id == id);

  MechanicBinding? bindingFor(MechanicId id) {
    for (final binding in mechanics) {
      if (binding.id == id) return binding;
    }
    return null;
  }

  String? meaningOf(String actionTypeWire) => debrief.actionMeaning[actionTypeWire];
}
