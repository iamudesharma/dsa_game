import 'json.dart';

class LearningThread {
  LearningThread.from(Object? raw)
    : id = Json.str(Json.map(raw)['id']),
      title = Json.str(Json.map(raw)['title']);
  final String id, title;
}

class LearningAction {
  LearningAction.from(Object? raw) : data = Json.map(raw);
  final Map<String, Object?> data;
  String get type => Json.str(data['type']);
  String get problemId => Json.str(data['problemId']);
  String get difficulty => Json.str(data['difficulty'], fallback: 'medium');
  String get title => Json.str(
    data['title'],
    fallback: type == 'interview' ? 'Interview question set' : problemId,
  );
}

class LearningMessage {
  LearningMessage.from(Object? raw) : data = Json.map(raw);
  final Map<String, Object?> data;
  String get id => Json.str(data['id']);
  String get role => Json.str(data['role']);
  String get text => Json.str(data['text']);
  String get status => Json.str(data['status']);
  String get requestId => Json.str(data['requestId']);
  List<LearningAction> get actions =>
      Json.list(data['actions']).map(LearningAction.from).toList();
  List<Map<String, Object?>> get sources =>
      Json.list(data['sources']).map(Json.map).toList();
}

class PracticeRecord {
  PracticeRecord.from(Object? raw) : data = Json.map(raw);
  final Map<String, Object?> data;
  String get gameId => Json.str(data['gameId']);
  String get problemId => Json.str(data['problemId']);
  String get outcome => Json.str(data['outcome']);
  String get difficulty => Json.str(data['difficulty']);
  int get mistakes => Json.intOr(data['mistakes']);
  int get hints => Json.intOr(data['hints']);
  int get steps => Json.intOr(data['steps']);
  DateTime get startedAt =>
      DateTime.fromMillisecondsSinceEpoch(Json.intOr(data['startedAt']));
}

class LearningDashboard {
  LearningDashboard.from(Object? raw) : data = Json.map(raw);
  final Map<String, Object?> data;
  List<PracticeRecord> get records =>
      Json.list(data['records']).map(PracticeRecord.from).toList();
  List<Map<String, Object?>> get topics =>
      Json.list(data['topics']).map(Json.map).toList();
  List<Map<String, Object?>> get reviews =>
      Json.list(data['reviews']).map(Json.map).toList();
  Map<String, Object?>? get recommendation =>
      data['recommendation'] == null ? null : Json.map(data['recommendation']);
}

class LearningPage<T> {
  const LearningPage(this.items, this.nextCursor);
  final List<T> items;
  final String? nextCursor;
}
