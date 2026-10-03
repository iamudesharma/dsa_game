/// Typed HTTP client for the DSA game API.
///
/// Everything the app knows about the wire lives here: one place that builds
/// requests, one place that turns every failure mode into an [ApiException],
/// and no `dynamic` outside of `jsonDecode` (which is unavoidable — the whole
/// point of the model layer is to parse defensively from `Object?`).
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/action.dart';
import '../models/learning.dart';
import '../models/account.dart';
import '../models/api.dart';
import '../models/json.dart';
import '../models/problem.dart';
import '../models/state.dart';
import 'api_exception.dart';

/// Base URL for every call.
///
/// Defaults to `http://127.0.0.1:8787`, which is right for the iOS simulator,
/// Android emulator (via `10.0.2.2` — see README) and desktop. A real handset
/// needs your LAN IP:
///
/// ```
/// flutter run --dart-define=API_BASE_URL=http://192.168.1.20:8787
/// ```
class ApiConfig {
  const ApiConfig({
    this.baseUrl = defaultBaseUrl,
    this.generateTimeout = const Duration(seconds: 90),
    this.actionTimeout = const Duration(seconds: 20),
    this.requestTimeout = const Duration(seconds: 10),
  });

  static const defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://127.0.0.1:8787',
  );

  final String baseUrl;

  /// Tier-1 generation can take tens of seconds; the catalogue is instant.
  final Duration generateTimeout;
  final Duration actionTimeout;
  final Duration requestTimeout;

  static const defaults = ApiConfig();

  Uri endpoint(String path) => Uri.parse('$baseUrl$path');
}

class ApiClient {
  ApiClient({ApiConfig? config, http.Client? httpClient})
    : config = config ?? ApiConfig.defaults,
      _http = httpClient ?? http.Client();

  final ApiConfig config;
  final http.Client _http;

  /// Bearer fallback for loopback hosts. The server also sets an httpOnly
  /// cookie, but `localhost` vs `127.0.0.1` are different hosts to the
  /// cookie jar, so the mobile client always sends the token explicitly —
  /// same as the web client's `Authorization` header.
  String? _authToken;

  void setAuthToken(String? token) =>
      _authToken = (token == null || token.isEmpty) ? null : token;

  void close() => _http.close();

  // ------------------------------------------------------------- endpoints

  Future<CatalogueResponse> fetchCatalogue() async {
    final body = await _get('/api/catalogue');
    return CatalogueResponse.from(body);
  }

  Future<HealthResponse> fetchHealth() async {
    final body = await _get('/api/health', timeout: config.requestTimeout);
    return HealthResponse.from(body);
  }

  Future<GenerateResponse> generate(
    GenerateRequest request, {
    Future<void>? abortTrigger,
  }) async {
    final body = await _post(
      '/api/generate',
      request.toJson(),
      timeout: config.generateTimeout,
      // Generation failure is a real, expected outcome when every provider
      // tier is down; let the server's message through verbatim.
      semanticCodes: const {'GENERATION_FAILED'},
      abortTrigger: abortTrigger,
    );
    return GenerateResponse.from(body);
  }

  Future<ActionResponse> submitAction({
    required String gameId,
    required Action action,
  }) async {
    final body = await _post(
      '/api/action',
      ActionRequest(gameId: gameId, action: action).toJson(),
      timeout: config.actionTimeout,
    );
    return ActionResponse.from(body);
  }

  /// Asks the server to step the game back one action.
  ///
  /// The oracle owns the authoritative trace, so a real undo has to happen
  /// server-side: restoring only the board locally would leave the undo-walked
  /// action in the trace, and the debrief would then replay a step the player
  /// has already taken back. Returns null when there was nothing to undo.
  Future<GameState?> undo(String gameId) async {
    final body = await _post('/api/undo', {'gameId': gameId});
    if (body is! Map) return null;
    final undone = body['undone'];
    if (undone != true) return null;
    final raw = body['state'];
    if (raw is! Map) return null;
    return GameState.from(raw);
  }

  Future<HintResponse> requestHint(String gameId) async {
    final body = await _post('/api/hint', HintRequest(gameId: gameId).toJson());
    return HintResponse.from(body);
  }

  Future<DecideResponse> decide(DecideRequest request) async {
    final body = await _post('/api/decide', request.toJson());
    return DecideResponse.from(body);
  }

  // ------------------------------------------------------- accounts & resume
  // Signed-in only. Game play stays anonymous; these power resume/interview.

  Future<AuthResult> signup({
    required String email,
    required String password,
  }) async {
    final body = await _post('/api/auth/signup', {
      'email': email,
      'password': password,
    });
    return AuthResult.from(body);
  }

  Future<AuthResult> login({
    required String email,
    required String password,
  }) async {
    final body = await _post('/api/auth/login', {
      'email': email,
      'password': password,
    });
    return AuthResult.from(body);
  }

  Future<void> logout() async {
    await _post('/api/auth/logout', const <String, Object?>{});
  }

  Future<MeResponse> me() async {
    final body = await _get('/api/auth/me');
    return MeResponse.from(body);
  }

  Future<Resume> fetchResume() async {
    final body = await _get('/api/me/resume');
    if (body is! Map) {
      throw const MalformedResponse('resume response is not an object');
    }
    return Resume.from(body['resume']);
  }

  Future<Resume> saveResume(Resume resume) async {
    final body = await _put('/api/me/resume', resume.toJson());
    if (body is! Map) {
      throw const MalformedResponse('resume response is not an object');
    }
    return Resume.from(body['resume']);
  }

  /// Deterministic paste → parse. The parser never invents facts; anything it
  /// cannot place comes back as `unparsed` lines for the user to fix by hand.
  Future<ParseResumeResult> parseResume(
    String text, {
    required bool save,
  }) async {
    final body = await _post('/api/me/parse-resume', {
      'text': text,
      'save': save,
    });
    return ParseResumeResult.from(body);
  }

  Future<Target?> fetchTarget() async {
    final body = await _get('/api/me/target');
    if (body is! Map) {
      throw const MalformedResponse('target response is not an object');
    }
    final raw = body['target'];
    return raw == null ? null : Target.from(raw);
  }

  Future<Target> saveTarget(Target target) async {
    final body = await _put('/api/me/target', target.toJson());
    if (body is! Map) {
      throw const MalformedResponse('target response is not an object');
    }
    return Target.from(body['target']);
  }

  Future<Map<String, String>> fetchProgress() async {
    final body = await _get('/api/me/progress');
    if (body is! Map) {
      throw const MalformedResponse('progress response is not an object');
    }
    final out = <String, String>{};
    Json.map(body['completed']).forEach((key, value) {
      if (value is String) out[key] = value;
    });
    return Map.unmodifiable(out);
  }

  /// First-login merge: posts the device-local completion map, gets the union.
  Future<Map<String, String>> pushProgress(
    Map<String, String> completed,
  ) async {
    final body = await _post('/api/me/progress', {'completed': completed});
    if (body is! Map) {
      throw const MalformedResponse('progress response is not an object');
    }
    final out = <String, String>{};
    Json.map(body['completed']).forEach((key, value) {
      if (value is String) out[key] = value;
    });
    return Map.unmodifiable(out);
  }

  Future<List<CompanyProfile>> fetchCompanies() async {
    final body = await _get('/api/companies');
    if (body is! Map) {
      throw const MalformedResponse('companies response is not an object');
    }
    final raw = body['companies'];
    if (raw is! List) {
      throw const MalformedResponse('companies response has no list');
    }
    return Json.listOf(
      raw,
      CompanyProfile.from,
    ).whereType<CompanyProfile>().toList(growable: false);
  }

  Future<InterviewKit> generateInterview({
    bool newAngle = false,
    int? seed,
  }) async {
    final body = await _post('/api/interview/generate', {
      'newAngle': newAngle,
      'seed': ?seed,
    }, timeout: const Duration(seconds: 120));
    return InterviewKit.from(body);
  }

  Future<List<InterviewKitSummary>> fetchInterviewKits() async {
    final body = await _get('/api/interview/kits');
    if (body is! Map) {
      throw const MalformedResponse('kits response is not an object');
    }
    final raw = body['kits'];
    if (raw is! List) {
      throw const MalformedResponse('kits response has no list');
    }
    return Json.listOf(
      raw,
      InterviewKitSummary.from,
    ).whereType<InterviewKitSummary>().toList(growable: false);
  }

  Future<LearningDashboard> learningDashboard() async =>
      LearningDashboard.from(await _get('/api/learning/dashboard'));
  Future<LearningPage<LearningThread>> learningThreads({
    String query = '',
    String? cursor,
  }) async {
    final data = Json.map(
      await _get(
        '/api/learning/threads?q=${Uri.encodeQueryComponent(query)}${cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}'}',
      ),
    );
    return LearningPage(
      Json.list(data['threads']).map(LearningThread.from).toList(),
      Json.strOrNull(data['nextCursor']),
    );
  }

  Future<LearningThread> createLearningThread() async => LearningThread.from(
    Json.map(await _post('/api/learning/threads', {}))['thread'],
  );
  Future<LearningPage<LearningMessage>> learningMessages(
    String id, {
    String? cursor,
  }) async {
    final data = Json.map(
      await _get(
        '/api/learning/threads/$id?limit=100${cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}'}',
      ),
    );
    return LearningPage(
      Json.list(data['messages']).map(LearningMessage.from).toList(),
      Json.strOrNull(data['nextCursor']),
    );
  }

  Future<void> renameLearningThread(String id, String title) async {
    await _put('/api/learning/threads/$id', {'title': title});
  }

  Future<void> deleteLearningThread(String id) async {
    await _send(
      () => _http.delete(
        config.endpoint('/api/learning/threads/$id'),
        headers: _headers,
      ),
      '/api/learning/threads/$id',
      config.requestTimeout,
    );
  }

  Future<void> cancelLearning(String id) async {
    await _post('/api/learning/threads/$id/cancel', {});
  }

  Future<Map<String, Object?>> learningAction(
    String id,
    String messageId,
    int index, {
    bool instant = false,
    Future<void>? abortTrigger,
  }) async => Json.map(
    await _post('/api/learning/threads/$id/actions', {
      'messageId': messageId,
      'index': index,
      'requestId': 'action-$messageId-$index',
      'forceTemplate': instant,
    }, timeout: const Duration(seconds: 240),abortTrigger:abortTrigger),
  );
  Future<LearningPage<PracticeRecord>> learningHistory({
    String? topic,
    String? cursor,
    int? from,
    int? to,
  }) async {
    final query = Uri(
      queryParameters: {
        if (topic != null && topic.isNotEmpty) 'topic': topic,
        'cursor': ?cursor,
        if (from != null) 'from': '$from',
        if (to != null) 'to': '$to',
      },
    ).query;
    final data = Json.map(await _get('/api/learning/history?$query'));
    return LearningPage(
      Json.list(data['records']).map(PracticeRecord.from).toList(),
      Json.strOrNull(data['nextCursor']),
    );
  }

  Future<List<Map<String, Object?>>> learningPlans() async =>
      Json.list(Json.map(await _get('/api/learning/plans'))['plans'])
          .map(Json.map)
          .toList();
  Future<List<Map<String, Object?>>> lessons() async =>
      Json.list(Json.map(await _get('/api/lessons'))['lessons'])
          .map(Json.map)
          .toList();
  Future<Map<String, Object?>> fetchGame(String id) async =>
      Json.map(await _get('/api/game/$id'));
  Future<Debrief> fetchDebrief(String id) async =>
      Debrief.from(await _get('/api/game/$id/debrief'));
  Future<InterviewKit> fetchInterviewKit(String id) async =>
      InterviewKit.from(await _get('/api/interview/kits/$id'));
  Future<void> saveReflection(
    String id,
    Map<String, Object?> reflection,
  ) async {
    await _post('/api/learning/history/$id/reflection', reflection);
  }

  /// Authenticated SSE. AbortableRequest closes this request without closing the shared API client.
  Stream<Map<String, Object?>> streamLearning(
    String id,
    Map<String, Object?> payload,
    Future<void> abort,
  ) async* {
    final request =
        http.AbortableRequest(
            'POST',
            config.endpoint('/api/learning/threads/$id/messages'),
            abortTrigger: abort,
          )
          ..headers.addAll({..._headers, 'accept': 'text/event-stream'})
          ..body = jsonEncode(payload);
    final response = await _http
        .send(request)
        .timeout(const Duration(seconds: 30));
    if (response.statusCode != 200) {
      final data = Json.map(jsonDecode(await response.stream.bytesToString()));
      throw ApiServerException(
        statusCode: response.statusCode,
        code: 'CHAT_FAILED',
        message: Json.str(
          Json.map(data['error'])['message'],
          fallback: 'Could not send this message.',
        ),
      );
    }
    var buffer = '', complete = false;
    await for (final chunk
        in response.stream
            .transform(utf8.decoder)
            .timeout(const Duration(seconds: 190))) {
      buffer += chunk;
      buffer = buffer.replaceAll('\r\n', '\n');
      var boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        final frame = buffer.substring(0, boundary);
        buffer = buffer.substring(boundary + 2);
        final data = frame
            .split('\n')
            .where((l) => l.startsWith('data:'))
            .map((l) => l.substring(5).trimLeft())
            .join('\n');
        if (data.isNotEmpty) {
          final event = Json.map(jsonDecode(data));
          if (event['type'] == 'complete') complete = true;
          yield event;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (!complete) {
      throw const MalformedResponse(
        'The connection ended before the response finished.',
      );
    }
  }

  // ------------------------------------------------------------- transport

  Future<Object?> _get(String path, {Duration? timeout}) => _send(
    () => _http.get(config.endpoint(path), headers: _headers),
    path,
    timeout ?? config.requestTimeout,
  );

  Future<Object?> _post(
    String path,
    Map<String, Object?> payload, {
    Duration? timeout,
    Set<String> semanticCodes = const {},
    Future<void>? abortTrigger,
  }) => _send(
    () async {
      final request =
          http.AbortableRequest(
              'POST',
              config.endpoint(path),
              abortTrigger: abortTrigger,
            )
            ..headers.addAll(_headers)
            ..body = jsonEncode(payload);
      return http.Response.fromStream(await _http.send(request));
    },
    path,
    timeout ?? config.requestTimeout,
    semanticCodes: semanticCodes,
  );

  Future<Object?> _put(
    String path,
    Map<String, Object?> payload, {
    Duration? timeout,
  }) => _send(
    () => _http.put(
      config.endpoint(path),
      headers: _headers,
      body: jsonEncode(payload),
    ),
    path,
    timeout ?? config.requestTimeout,
  );

  Map<String, String> get _headers => {
    'content-type': 'application/json',
    'accept': 'application/json',
    if (_authToken != null) 'authorization': 'Bearer $_authToken',
  };

  /// Runs [send] and normalises every outcome into a model or an
  /// [ApiException]. `semanticCodes` are 4xx-ish domain failures that the server
  /// reports with an error body worth showing as-is.
  Future<Object?> _send(
    Future<http.Response> Function() send,
    String path,
    Duration timeout, {
    Set<String> semanticCodes = const {},
  }) async {
    final http.Response response;
    try {
      response = await send().timeout(timeout);
    } on TimeoutException {
      throw ApiTimeoutException(
        'The server did not answer $path within ${timeout.inSeconds}s. It may still be '
        'generating — try again, or use a lower provider tier.',
        timeout: timeout,
      );
    } on http.ClientException catch (e) {
      throw ApiUnreachableException(
        'Could not reach the API at ${config.baseUrl}. Is the server running?',
        baseUrl: config.baseUrl,
      ).withCause(e.message);
    } catch (e) {
      // `SocketException`, `HandshakeException` and friends from dart:io, and
      // the browser's opaque network errors on web.
      throw ApiUnreachableException(
        'Could not reach the API at ${config.baseUrl}. Is the server running?',
        baseUrl: config.baseUrl,
      ).withCause(e);
    }

    Object? decoded;
    var decodeFailed = false;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      decodeFailed = true;
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (decodeFailed) {
        throw MalformedResponse(
          'The server replied to $path with a non-JSON body '
          '(HTTP ${response.statusCode}).',
        );
      }
      if (decoded is! Map<String, Object?>) {
        throw MalformedResponse(
          'Expected a JSON object from $path, got ${decoded.runtimeType}.',
        );
      }
      return decoded;
    }

    // Non-2xx: prefer the contract's `{ error: { code, message } }` envelope.
    final error = decoded == null ? null : Json.map(Json.map(decoded)['error']);
    final code = Json.strOrNull(error?['code']);
    final message = Json.strOrNull(error?['message']);
    throw ApiServerException(
      statusCode: response.statusCode,
      code:
          code ??
          (semanticCodes.isNotEmpty
              ? semanticCodes.first
              : 'HTTP_${response.statusCode}'),
      message:
          message ??
          'The server rejected $path with HTTP ${response.statusCode}'
              '${decodeFailed ? ' (and a non-JSON body)' : ''}.',
    );
  }
}

extension on ApiUnreachableException {
  /// Attaches the underlying platform error to the message for debugging
  /// without widening the public type.
  ApiUnreachableException withCause(Object? cause) =>
      ApiUnreachableException('$message ($cause)', baseUrl: baseUrl);
}
