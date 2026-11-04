/// Typed HTTP client for the DSA game API.
///
/// Everything the app knows about the wire lives here: one place that builds
/// requests, one place that turns every failure mode into an [ApiException],
/// and no `dynamic` outside of `jsonDecode` (which is unavoidable — the whole
/// point of the model layer is to parse defensively from `Object?`).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:effect_core/effect_core.dart' as fx;
import 'package:http/http.dart' as http;

import '../models/action.dart';
import '../models/learning.dart';
import '../models/account.dart';
import '../models/api.dart';
import '../models/json.dart';
import '../models/problem.dart';
import '../models/state.dart';
import 'api_exception.dart';
import 'api_policy.dart';

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
    this.generateTimeout = const Duration(
      milliseconds: ApiPolicy.defaultGenerateTimeoutMs,
    ),
    this.actionTimeout = const Duration(
      milliseconds: ApiPolicy.defaultActionTimeoutMs,
    ),
    this.requestTimeout = const Duration(
      milliseconds: ApiPolicy.defaultRequestTimeoutMs,
    ),
    this.policy = const ApiPolicy(),
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
  final ApiPolicy policy;

  static const defaults = ApiConfig();

  Uri endpoint(String path) => Uri.parse('$baseUrl$path');
}

class ApiClient {
  ApiClient({
    ApiConfig? config,
    http.Client? httpClient,
    this.lifecycle,
    this.metrics,
  }) : config = config ?? ApiConfig.defaults,
       _http = httpClient ?? http.Client() {
    this.config.policy.validate();
    if (this.config.requestTimeout <= Duration.zero ||
        this.config.actionTimeout <= Duration.zero ||
        this.config.generateTimeout <= Duration.zero) {
      throw ArgumentError("API timeouts must be positive");
    }
  }

  final fx.LifecycleSink? lifecycle;
  final fx.RuntimeMetrics? metrics;
  final ApiConfig config;
  final http.Client _http;
  final _runtimes = <fx.Runtime<fx.Unit>>{};
  bool _closed = false;
  final _streamStops = <Future<void> Function()>{};
  Future<void>? _closing;

  /// Bearer fallback for loopback hosts. The server also sets an httpOnly
  /// cookie, but `localhost` vs `127.0.0.1` are different hosts to the
  /// cookie jar, so the mobile client always sends the token explicitly —
  /// same as the web client's `Authorization` header.
  String? _authToken;

  void setAuthToken(String? token) =>
      _authToken = (token == null || token.isEmpty) ? null : token;

  /// Flutter disposal starts shutdown; service owners can await [closeAsync].
  void close() => unawaited(closeAsync());

  /// Stop requests and readers before disposing their borrowed transport.
  /// Repeated calls share the same completion.
  Future<void> closeAsync() => _closing ??= _close();

  Future<void> _close() async {
    _closed = true;
    try {
      await Future.wait([
        for (final stop in _streamStops.toList()) stop(),
        for (final runtime in _runtimes.toList()) runtime.shutdown(),
      ]);
    } finally {
      _http.close();
    }
  }

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
    }, timeout: config.generateTimeout);
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
    await _request('DELETE', '/api/learning/threads/$id');
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
    await _post(
      '/api/learning/threads/$id/actions',
      {
        'messageId': messageId,
        'index': index,
        'requestId': 'action-$messageId-$index',
        'forceTemplate': instant,
      },
      timeout: config.generateTimeout,
      abortTrigger: abortTrigger,
    ),
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
    if (_closed) throw const ApiCancelledException('The API client is closed.');
    final runtime = fx.Runtime(
      fx.Unit.value,
      lifecycle: lifecycle,
      metrics: metrics,
    );
    _runtimes.add(runtime);
    final cancel = Completer<void>();
    StreamIterator<String>? iterator;
    Future<void> stop() async {
      if (!cancel.isCompleted) cancel.complete();
      await iterator?.cancel();
    }

    Future<T> run<T>(fx.Effect<T, ApiException, fx.Unit> program) {
      if (_closed || cancel.isCompleted) {
        return Future.error(
          const ApiCancelledException('The request was cancelled.'),
        );
      }
      return _runEffect(runtime, program);
    }

    _streamStops.add(stop);
    var finished = false;
    unawaited(
      abort.then((_) async {
        if (finished) return;
        await stop();
        await runtime.shutdown();
      }),
    );
    try {
      final connectTimeout = Duration(
        milliseconds: config.policy.streamConnectTimeoutMs,
      );
      final response = await run(
        fx.Effect.fromFuture<http.StreamedResponse, ApiException, fx.Unit>(
          () async {
            final request =
                http.AbortableRequest(
                    'POST',
                    config.endpoint('/api/learning/threads/$id/messages'),
                    abortTrigger: cancel.future,
                  )
                  ..headers.addAll({..._headers, 'accept': 'text/event-stream'})
                  ..body = jsonEncode(payload);
            final response = await _http.send(request);
            if (response.statusCode != 200) {
              final raw = (await _boundedResponse(response)).body;
              Map<String, Object?> data = {};
              try {
                data = Json.map(jsonDecode(raw));
              } on FormatException {
                /* retain HTTP error */
              }
              throw ApiServerException(
                statusCode: response.statusCode,
                code: 'CHAT_FAILED',
                message: response.statusCode == 401
                    ? 'Your session expired. Sign in again to continue.'
                    : Json.str(
                        Json.map(data['error'])['message'],
                        fallback: 'Could not send this message.',
                      ),
              );
            }
            return response;
          },
          onError: _streamError,
          onCancel: stop,
        ).timeout(
          connectTimeout,
          () => ApiTimeoutException(
            'The tutor connection timed out.',
            timeout: connectTimeout,
          ),
        ),
      );
      final chunks = StreamIterator(response.stream.transform(utf8.decoder));
      iterator = chunks;
      final idleTimeout = Duration(
        milliseconds: config.policy.streamIdleTimeoutMs,
      );
      var buffer = '';
      var previousCr = false;
      while (await run(
        fx.Effect.fromFuture<bool, ApiException, fx.Unit>(
          chunks.moveNext,
          onError: _streamError,
          onCancel: () async {
            await stop();
          },
        ).timeout(
          idleTimeout,
          () => ApiTimeoutException(
            'The tutor response timed out. Your question is saved.',
            timeout: idleTimeout,
          ),
        ),
      )) {
        var chunk = chunks.current;
        if (chunk.isNotEmpty) {
          if (previousCr && chunk.startsWith('\n')) chunk = chunk.substring(1);
          previousCr = chunks.current.endsWith('\r');
          buffer += chunk.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
        }
        var boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          if (boundary > config.policy.maxStreamFrameCharacters) {
            throw const MalformedResponse(
              'The tutor response exceeded the frame limit.',
            );
          }
          final frame = buffer.substring(0, boundary);
          buffer = buffer.substring(boundary + 2);
          final data = frame
              .split('\n')
              .where((line) => line.startsWith('data:'))
              .map((line) => line.substring(5).trimLeft())
              .join('\n');
          if (data.isNotEmpty) {
            Map<String, Object?> event;
            try {
              event = Json.map(jsonDecode(data));
            } on FormatException {
              throw const MalformedResponse(
                'The tutor sent an invalid response.',
              );
            }
            yield event;
            if (event['type'] == 'complete') return;
          }
          boundary = buffer.indexOf('\n\n');
        }
        if (buffer.length > config.policy.maxStreamFrameCharacters) {
          throw const MalformedResponse(
            'The tutor response exceeded the frame limit.',
          );
        }
      }
      throw const MalformedResponse(
        'The connection ended before the response finished. Your question is saved.',
      );
    } finally {
      finished = true;
      _streamStops.remove(stop);
      await stop();
      await runtime.shutdown();
      await iterator?.cancel();
      _runtimes.remove(runtime);
    }
  }

  static ApiException _streamError(Object error, StackTrace stack) {
    if (error is ApiException) {
      return error;
    }
    if (error is http.RequestAbortedException) {
      return const ApiCancelledException('The request was cancelled.');
    }
    if (error is FormatException) {
      return const MalformedResponse('The tutor sent an invalid response.');
    }
    return ApiUnreachableException(
      'The tutor connection was interrupted. Your question is saved. ($error)',
    );
  }

  // ------------------------------------------------------------- transport

  Future<Object?> _get(String path, {Duration? timeout}) =>
      _request('GET', path, timeout: timeout);

  Future<Object?> _post(
    String path,
    Map<String, Object?> payload, {
    Duration? timeout,
    Set<String> semanticCodes = const {},
    Future<void>? abortTrigger,
  }) => _request(
    'POST',
    path,
    payload: payload,
    timeout: timeout,
    semanticCodes: semanticCodes,
    abortTrigger: abortTrigger,
  );

  Future<Object?> _put(
    String path,
    Map<String, Object?> payload, {
    Duration? timeout,
  }) => _request('PUT', path, payload: payload, timeout: timeout);

  Future<Object?> _request(
    String method,
    String path, {
    Map<String, Object?>? payload,
    Duration? timeout,
    Set<String> semanticCodes = const {},
    Future<void>? abortTrigger,
  }) => _send(
    (cancel) async {
      final request = http.AbortableRequest(
        method,
        config.endpoint(path),
        abortTrigger: abortTrigger == null
            ? cancel
            : Future.any([cancel, abortTrigger]),
      )..headers.addAll(_headers);
      if (payload != null) request.body = jsonEncode(payload);
      return _boundedResponse(await _http.send(request));
    },
    path,
    timeout ?? config.requestTimeout,
    semanticCodes: semanticCodes,
    retryRead: method == 'GET',
  );

  Future<http.Response> _boundedResponse(http.StreamedResponse response) async {
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in response.stream) {
      if (bytes.length + chunk.length > config.policy.maxResponseBytes) {
        throw const MalformedResponse(
          'The server response exceeded the size limit.',
        );
      }
      bytes.add(chunk);
    }
    return http.Response.bytes(
      bytes.takeBytes(),
      response.statusCode,
      headers: response.headers,
      request: response.request,
    );
  }

  Future<Object?> _send(
    Future<http.Response> Function(Future<void>) send,
    String path,
    Duration timeout, {
    Set<String> semanticCodes = const {},
    bool retryRead = false,
  }) async {
    if (_closed) throw const ApiCancelledException('The API client is closed.');
    final runtime = fx.Runtime(
      fx.Unit.value,
      lifecycle: lifecycle,
      metrics: metrics,
    );
    _runtimes.add(runtime);
    final attempt = fx.Effect.defer<Object?, ApiException, fx.Unit>(() {
      final cancel = Completer<void>();
      return fx.Effect.fromFuture<Object?, ApiException, fx.Unit>(
        () => _sendOnce(
          () => send(cancel.future),
          path,
          timeout,
          semanticCodes: semanticCodes,
        ),
        onError: (error, stack) => error is ApiException
            ? error
            : ApiUnreachableException('$error', baseUrl: config.baseUrl),
        onCancel: () {
          if (!cancel.isCompleted) cancel.complete();
        },
      ).timeout(
        timeout,
        () => ApiTimeoutException(
          'The server did not answer $path within ${timeout.inSeconds}s.',
          timeout: timeout,
        ),
      );
    });
    var program = attempt.retry(
      fx.Schedule(
        recurrences: retryRead ? config.policy.readRetries : 0,
        initialDelay: Duration(milliseconds: config.policy.retryDelayMs),
        factor: 2,
        maxDelay: const Duration(seconds: 10),
      ),
      whileError: (error) => retryRead && _transient(error),
    );
    if (retryRead) {
      final budget = Duration(milliseconds: config.policy.readBudgetMs);
      program = program.timeout(
        budget,
        () => ApiTimeoutException(
          'The read operation timed out.',
          timeout: budget,
        ),
      );
    }
    try {
      return await _runEffect(runtime, program);
    } finally {
      await runtime.shutdown();
      _runtimes.remove(runtime);
    }
  }

  Future<T> _runEffect<T>(
    fx.Runtime<fx.Unit> runtime,
    fx.Effect<T, ApiException, fx.Unit> program,
  ) async {
    final result = await runtime.runExit(program);
    switch (result) {
      case fx.Success(:final value):
        return value;
      case fx.Failure(cause: fx.Expected(:final error)):
        throw error;
      case fx.Failure(cause: fx.Defect(:final error, :final stackTrace)):
        Error.throwWithStackTrace(error, stackTrace);
      case fx.Failure(cause: fx.Interrupted()):
        throw const ApiCancelledException('The request was cancelled.');
      case fx.Failure(:final cause):
        throw ApiCleanupException(cause);
    }
  }

  static bool _transient(ApiException error) =>
      error is ApiUnreachableException ||
      error is ApiTimeoutException ||
      (error is ApiServerException &&
          error.code != 'PROBLEM_NOT_PLAYABLE' &&
          const [502, 503, 504].contains(error.statusCode));

  Map<String, String> get _headers => {
    'content-type': 'application/json',
    'accept': 'application/json',
    if (_authToken != null) 'authorization': 'Bearer $_authToken',
  };

  /// Runs [send] and normalises every outcome into a model or an
  /// [ApiException]. `semanticCodes` are 4xx-ish domain failures that the server
  /// reports with an error body worth showing as-is.
  Future<Object?> _sendOnce(
    Future<http.Response> Function() send,
    String path,
    Duration timeout, {
    Set<String> semanticCodes = const {},
  }) async {
    final http.Response response;
    try {
      response = await send();
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiTimeoutException(
        'The server did not answer $path within ${timeout.inSeconds}s. It may still be '
        'generating — try again, or use a lower provider tier.',
        timeout: timeout,
      );
    } on http.RequestAbortedException {
      throw const ApiCancelledException('The request was cancelled.');
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
