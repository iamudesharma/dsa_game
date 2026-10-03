/// Dart mirror of `packages/account/src/schema.ts` (resume, target,
/// interview kit, auth) plus the company registry shape from `companies.ts`.
///
/// Same rule as every other model file: defensive parsing through [Json], so
/// a payload the server shaped differently degrades into defaults instead of
/// throwing inside `build()`.
library;

import 'json.dart';

int _idCounter = 0;

/// Client-side id for a newly added resume entry. The server treats ids as
/// opaque strings; uniqueness within the resume is what matters, because
/// `sourceRef` grounding is checked against exactly these values.
String newAccountId(String prefix) {
  _idCounter += 1;
  return '$prefix:${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}:${_idCounter.toRadixString(36)}';
}

// ------------------------------------------------------------------ auth

class AuthUser {
  const AuthUser({required this.id, required this.email});

  factory AuthUser.from(Object? raw) {
    final map = Json.map(raw);
    return AuthUser(id: Json.str(map['id']), email: Json.str(map['email']));
  }

  final String id;
  final String email;
}

class AuthResult {
  const AuthResult({
    required this.user,
    required this.token,
    required this.expiresAt,
  });

  factory AuthResult.from(Object? raw) {
    final map = Json.map(raw);
    return AuthResult(
      user: AuthUser.from(map['user']),
      token: Json.str(map['token']),
      expiresAt: Json.intOr(map['expiresAt']),
    );
  }

  final AuthUser user;
  final String token;
  final int expiresAt;
}

class MeResponse {
  const MeResponse({
    required this.user,
    required this.resume,
    required this.target,
    required this.progress,
  });

  factory MeResponse.from(Object? raw) {
    final map = Json.map(raw);
    final progress = <String, String>{};
    Json.map(map['progress']).forEach((key, value) {
      if (value is String) progress[key] = value;
    });
    return MeResponse(
      user: AuthUser.from(map['user']),
      resume: Resume.from(map['resume']),
      target: map['target'] == null ? null : Target.from(map['target']),
      progress: Map.unmodifiable(progress),
    );
  }

  final AuthUser user;
  final Resume resume;
  final Target? target;
  final Map<String, String> progress;
}

// ----------------------------------------------------------------- resume

class Skill {
  const Skill({required this.id, required this.name, this.level, this.years});

  factory Skill.from(Object? raw) {
    final map = Json.map(raw);
    return Skill(
      id: Json.str(map['id'], fallback: newAccountId('skill')),
      name: Json.line(map['name']),
      level: Json.strOrNull(map['level']),
      years: Json.numberOrNull(map['years'])?.toDouble(),
    );
  }

  final String id;
  final String name;
  final String? level;
  final double? years;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    if (level != null) 'level': level,
    if (years != null) 'years': years,
  };
}

class Experience {
  const Experience({
    required this.id,
    required this.title,
    required this.company,
    required this.start,
    required this.end,
    this.bullets = const <String>[],
  });

  factory Experience.from(Object? raw) {
    final map = Json.map(raw);
    return Experience(
      id: Json.str(map['id'], fallback: newAccountId('exp')),
      title: Json.line(map['title']),
      company: Json.line(map['company']),
      start: Json.str(map['start']),
      end: Json.str(map['end']),
      bullets: Json.stringList(map['bullets']),
    );
  }

  final String id;
  final String title;
  final String company;
  final String start;
  final String end;
  final List<String> bullets;

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'company': company,
    'start': start,
    'end': end,
    'bullets': bullets,
  };
}

class Education {
  const Education({
    required this.id,
    required this.school,
    required this.degree,
    this.field = '',
    this.start = '',
    this.end = '',
  });

  factory Education.from(Object? raw) {
    final map = Json.map(raw);
    return Education(
      id: Json.str(map['id'], fallback: newAccountId('edu')),
      school: Json.line(map['school']),
      degree: Json.line(map['degree']),
      field: Json.str(map['field']),
      start: Json.str(map['start']),
      end: Json.str(map['end']),
    );
  }

  final String id;
  final String school;
  final String degree;
  final String field;
  final String start;
  final String end;

  Map<String, Object?> toJson() => {
    'id': id,
    'school': school,
    'degree': degree,
    'field': field,
    'start': start,
    'end': end,
  };
}

class Project {
  const Project({
    required this.id,
    required this.name,
    required this.description,
    this.tech = const <String>[],
    this.link = '',
  });

  factory Project.from(Object? raw) {
    final map = Json.map(raw);
    return Project(
      id: Json.str(map['id'], fallback: newAccountId('proj')),
      name: Json.line(map['name']),
      description: Json.str(map['description']),
      tech: Json.stringList(map['tech']),
      link: Json.str(map['link']),
    );
  }

  final String id;
  final String name;
  final String description;
  final List<String> tech;
  final String link;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'description': description,
    'tech': tech,
    'link': link,
  };
}

class ResumeContact {
  const ResumeContact({this.name = '', this.email = '', this.location = ''});

  factory ResumeContact.from(Object? raw) {
    final map = Json.map(raw);
    return ResumeContact(
      name: Json.str(map['name']),
      email: Json.str(map['email']),
      location: Json.str(map['location']),
    );
  }

  final String name;
  final String email;
  final String location;

  Map<String, Object?> toJson() => {
    'name': name,
    'email': email,
    'location': location,
  };
}

class Resume {
  const Resume({
    this.version = 1,
    this.summary = '',
    this.contact = const ResumeContact(),
    this.experience = const <Experience>[],
    this.education = const <Education>[],
    this.projects = const <Project>[],
    this.skills = const <Skill>[],
    this.links = const <String>[],
  });

  factory Resume.from(Object? raw) {
    final map = Json.map(raw);
    return Resume(
      version: Json.intOr(map['version'], fallback: 1),
      summary: Json.str(map['summary']),
      contact: ResumeContact.from(map['contact']),
      experience: Json.listOf(
        map['experience'],
        Experience.from,
      ).whereType<Experience>().toList(growable: false),
      education: Json.listOf(
        map['education'],
        Education.from,
      ).whereType<Education>().toList(growable: false),
      projects: Json.listOf(
        map['projects'],
        Project.from,
      ).whereType<Project>().toList(growable: false),
      skills: Json.listOf(
        map['skills'],
        Skill.from,
      ).whereType<Skill>().toList(growable: false),
      links: Json.stringList(map['links']),
    );
  }

  static const Resume empty = Resume();

  final int version;
  final String summary;
  final ResumeContact contact;
  final List<Experience> experience;
  final List<Education> education;
  final List<Project> projects;
  final List<Skill> skills;
  final List<String> links;

  Map<String, Object?> toJson() => {
    'version': version,
    'summary': summary,
    'contact': contact.toJson(),
    'experience': [for (final e in experience) e.toJson()],
    'education': [for (final e in education) e.toJson()],
    'projects': [for (final p in projects) p.toJson()],
    'skills': [for (final s in skills) s.toJson()],
    'links': links,
  };

  /// Every id a generated question may cite, plus `general`.
  Set<String> get sourceIds => {
    'general',
    for (final e in experience) e.id,
    for (final s in skills) s.id,
    for (final p in projects) p.id,
    for (final e in education) e.id,
  };

  /// Human label for a `sourceRef` chip. Falls back to the raw id when the
  /// resume changed since the kit was generated.
  String sourceLabel(String ref) {
    if (ref == 'general') return 'general';
    for (final e in experience) {
      if (e.id == ref) return '${e.title} @ ${e.company}'.trim();
    }
    for (final s in skills) {
      if (s.id == ref) return s.name;
    }
    for (final p in projects) {
      if (p.id == ref) return p.name;
    }
    for (final e in education) {
      if (e.id == ref) return e.school;
    }
    return ref;
  }
}

// ----------------------------------------------------------------- target

enum Seniority {
  intern('intern', 'Intern'),
  junior('junior', 'Junior'),
  mid('mid', 'Mid'),
  senior('senior', 'Senior'),
  staff('staff', 'Staff'),
  principal('principal', 'Principal');

  const Seniority(this.wire, this.label);

  final String wire;
  final String label;

  static final Map<String, Seniority> _byWire = {
    for (final v in values) v.wire: v,
  };

  static Seniority parse(Object? raw, {Seniority fallback = Seniority.mid}) =>
      raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

class Target {
  const Target({
    required this.goal,
    required this.companyId,
    this.customCompany = '',
    this.seniority = Seniority.mid,
    this.focusAreas = const <String>[],
  });

  factory Target.from(Object? raw) {
    final map = Json.map(raw);
    return Target(
      goal: Json.line(map['goal']),
      companyId: Json.str(map['companyId'], fallback: 'custom'),
      customCompany: Json.str(map['customCompany']),
      seniority: Seniority.parse(map['seniority']),
      focusAreas: Json.stringList(map['focusAreas']),
    );
  }

  final String goal;
  final String companyId;
  final String customCompany;
  final Seniority seniority;
  final List<String> focusAreas;

  Map<String, Object?> toJson() => {
    'goal': goal,
    'companyId': companyId,
    'customCompany': customCompany,
    'seniority': seniority.wire,
    'focusAreas': focusAreas,
  };
}

// ---------------------------------------------------------------- companies

class HiringAxis {
  const HiringAxis({
    required this.id,
    required this.label,
    required this.weight,
    required this.categories,
  });

  factory HiringAxis.from(Object? raw) {
    final map = Json.map(raw);
    return HiringAxis(
      id: Json.str(map['id']),
      label: Json.line(map['label']),
      weight: Json.doubleOr(map['weight']),
      categories: Json.stringList(map['categories']),
    );
  }

  final String id;
  final String label;
  final double weight;
  final List<String> categories;
}

class CompanyRound {
  const CompanyRound({required this.name, required this.focus});

  factory CompanyRound.from(Object? raw) {
    final map = Json.map(raw);
    return CompanyRound(
      name: Json.line(map['name']),
      focus: Json.line(map['focus']),
    );
  }

  final String name;
  final String focus;
}

class CompanyProfile {
  const CompanyProfile({
    required this.id,
    required this.label,
    this.aliases = const <String>[],
    this.values = const <String>[],
    this.hiringAxes = const <HiringAxis>[],
    this.rounds = const <CompanyRound>[],
    this.techSignals = const <String>[],
  });

  factory CompanyProfile.from(Object? raw) {
    final map = Json.map(raw);
    return CompanyProfile(
      id: Json.str(map['id']),
      label: Json.line(map['label'], fallback: 'Company'),
      aliases: Json.stringList(map['aliases']),
      values: Json.stringList(map['values']),
      hiringAxes: Json.listOf(
        map['hiringAxes'],
        HiringAxis.from,
      ).whereType<HiringAxis>().toList(growable: false),
      rounds: Json.listOf(
        map['rounds'],
        CompanyRound.from,
      ).whereType<CompanyRound>().toList(growable: false),
      techSignals: Json.stringList(map['techSignals']),
    );
  }

  final String id;
  final String label;
  final List<String> aliases;
  final List<String> values;
  final List<HiringAxis> hiringAxes;
  final List<CompanyRound> rounds;
  final List<String> techSignals;
}

// ---------------------------------------------------------------- interview

enum QuestionType {
  behavioral('behavioral', 'Behavioral'),
  coding('coding', 'Coding'),
  concepts('concepts', 'Concepts'),
  systemDesign('system-design', 'System design'),
  resumeDeepDive('resume-deep-dive', 'Resume deep-dive'),
  ml('ml', 'Machine learning');

  const QuestionType(this.wire, this.label);

  final String wire;
  final String label;

  static final Map<String, QuestionType> _byWire = {
    for (final v in values) v.wire: v,
  };

  static QuestionType parse(
    Object? raw, {
    QuestionType fallback = QuestionType.concepts,
  }) => raw is String ? (_byWire[raw] ?? fallback) : fallback;
}

class InterviewQuestion {
  const InterviewQuestion({
    required this.id,
    required this.type,
    required this.prompt,
    required this.whyItFits,
    required this.sourceRef,
    required this.difficulty,
    required this.followUps,
    required this.listeningFor,
    this.practiceProblemId,
  });

  factory InterviewQuestion.from(Object? raw) {
    final map = Json.map(raw);
    final practice = Json.map(map['practice']);
    return InterviewQuestion(
      id: Json.str(map['id']),
      type: QuestionType.parse(map['type']),
      prompt: Json.line(
        map['prompt'],
        fallback: 'Talk through a problem you solved recently.',
      ),
      whyItFits: Json.line(map['whyItFits']),
      sourceRef: Json.str(map['sourceRef'], fallback: 'general'),
      difficulty: Json.str(map['difficulty'], fallback: 'medium'),
      followUps: Json.stringList(map['followUps']),
      listeningFor: Json.line(map['listeningFor']),
      practiceProblemId: Json.strOrNull(practice['problemId']),
    );
  }

  final String id;
  final QuestionType type;
  final String prompt;
  final String whyItFits;
  final String sourceRef;
  final String difficulty;
  final List<String> followUps;
  final String listeningFor;
  final String? practiceProblemId;
}

class InterviewKit {
  const InterviewKit({
    required this.kitId,
    required this.target,
    required this.questions,
    required this.usedTier,
    required this.notes,
    required this.createdAt,
  });

  factory InterviewKit.from(Object? raw) {
    final map = Json.map(raw);
    return InterviewKit(
      kitId: Json.str(map['kitId']),
      target: Target.from(map['target']),
      questions: Json.listOf(
        map['questions'],
        InterviewQuestion.from,
      ).whereType<InterviewQuestion>().toList(growable: false),
      usedTier: Json.str(map['usedTier'], fallback: 'template'),
      notes: Json.stringList(map['notes']),
      createdAt: Json.intOr(map['createdAt']),
    );
  }

  final String kitId;
  final Target target;
  final List<InterviewQuestion> questions;
  final String usedTier;
  final List<String> notes;
  final int createdAt;
}

class InterviewKitSummary {
  const InterviewKitSummary({
    required this.kitId,
    required this.target,
    required this.usedTier,
    required this.createdAt,
    required this.count,
  });

  factory InterviewKitSummary.from(Object? raw) {
    final map = Json.map(raw);
    return InterviewKitSummary(
      kitId: Json.str(map['kitId']),
      target: Target.from(map['target']),
      usedTier: Json.str(map['usedTier'], fallback: 'template'),
      createdAt: Json.intOr(map['createdAt']),
      count: Json.intOr(map['count']),
    );
  }

  final String kitId;
  final Target target;
  final String usedTier;
  final int createdAt;
  final int count;
}

class ParseResumeResult {
  const ParseResumeResult({
    required this.resume,
    required this.unparsed,
    required this.saved,
    this.source = 'deterministic',
    this.notes = const <String>[],
    this.rejected = const <String>[],
  });

  factory ParseResumeResult.from(Object? raw) {
    final map = Json.map(raw);
    return ParseResumeResult(
      resume: Resume.from(map['resume']),
      unparsed: Json.stringList(map['unparsed']),
      saved: Json.boolOr(map['saved']),
      source: Json.str(map['source'], fallback: 'deterministic'),
      notes: Json.stringList(map['notes']),
      rejected: Json.stringList(map['rejected']),
    );
  }

  final Resume resume;
  final List<String> unparsed;
  final bool saved;

  /// Which extraction path won: the language model, or the deterministic parser.
  final String source;
  final List<String> notes;

  /// Fields the model produced that were not in the source text, and were dropped.
  final List<String> rejected;
}
