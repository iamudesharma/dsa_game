/// Account-stack checks: model parsing against the wire contract, the auth
/// header on account endpoints, sign-in/out + first-login progress merge, and
/// a widget pass over sign-in → account → interview generation.
///
/// The server is fixture-shaped here (see `fixtures.dart` for the game
/// payloads); the account fixtures below mirror
/// `packages/account/src/schema.ts` field for field.
library;

import 'dart:convert';

import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/models/account.dart';
import 'package:dsa_game_mobile/models/json.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/services/api_exception.dart';
import 'package:dsa_game_mobile/state/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fixtures.dart';

Map<String, Object?> get resumeJson => {
  'version': 1,
  'summary': 'Backend engineer',
  'contact': {'name': 'Dev', 'email': 'dev@example.com', 'location': ''},
  'experience': [
    {
      'id': 'exp:1',
      'title': 'Engineer',
      'company': 'Acme',
      'start': '2021',
      'end': 'Present',
      'bullets': ['Built queues'],
    },
  ],
  'education': [],
  'projects': [
    {
      'id': 'proj:1',
      'name': 'Cache',
      'description': 'fast cache',
      'tech': ['Dart'],
      'link': '',
    },
  ],
  'skills': [
    {'id': 'skill:1', 'name': 'Python'},
  ],
  'links': [],
};

Map<String, Object?> get targetJson => {
  'goal': 'Backend role',
  'companyId': 'faang-general',
  'customCompany': '',
  'seniority': 'mid',
  'focusAreas': <String>[],
};

Map<String, Object?> get companiesJson => {
  'companies': [
    {
      'id': 'faang-general',
      'label': 'Big Tech (general)',
      'aliases': ['faang'],
      'values': ['Ownership'],
      'hiringAxes': [
        {
          'id': 'dsa',
          'label': 'Data structures & algorithms',
          'weight': 0.4,
          'categories': ['coding', 'concepts'],
        },
      ],
      'rounds': [
        {'name': 'Phone screen', 'focus': 'One or two coding problems'},
      ],
      'techSignals': ['arrays'],
    },
    {
      'id': 'custom',
      'label': 'Custom company',
      'aliases': <String>[],
      'values': <String>[],
      'hiringAxes': <Object?>[],
      'rounds': <Object?>[],
      'techSignals': <String>[],
    },
  ],
};

Map<String, Object?> get kitJson => {
  'kitId': 'kit_abc',
  'target': targetJson,
  'questions': [
    {
      'id': 'q-1',
      'type': 'resume-deep-dive',
      'prompt': 'Walk through your work as Engineer at Acme.',
      'whyItFits': 'Anchored in your role.',
      'sourceRef': 'exp:1',
      'difficulty': 'medium',
      'followUps': ['How did you know it worked?'],
      'listeningFor': 'A specific decision and how it was verified.',
    },
    {
      'id': 'q-2',
      'type': 'coding',
      'prompt': 'Search for a target in a sorted array.',
      'whyItFits': 'Classic reasoning under pressure.',
      'sourceRef': 'skill:1',
      'difficulty': 'medium',
      'followUps': <String>[],
      'listeningFor': 'A working approach and one edge case.',
      'practice': {'problemId': 'binary-search'},
    },
  ],
  'usedTier': 'template',
  'notes': ['model transport disabled'],
  'createdAt': 1759000000000,
};

Map<String, Object?> get kitsJson => {
  'kits': [
    {
      'kitId': 'kit_abc',
      'target': targetJson,
      'usedTier': 'template',
      'createdAt': 1759000000000,
      'count': 2,
    },
  ],
};

Map<String, Object?> get meJson => {
  'user': {'id': 'user_1', 'email': 'dev@example.com'},
  'resume': resumeJson,
  'target': targetJson,
  'progress': {'two-sum': '2026-01-02T00:00:00.000Z'},
};

/// Routes account endpoints to fixtures, recording every request.
class AccountRoutes extends MockClient {
  AccountRoutes(this.seen) : super((_) async => throw StateError('unrouted'));

  final List<http.BaseRequest> seen;

  static const token = 'test-token-1234567890';

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    seen.add(request);
    final path = request.url.path;
    Object? body;
    var status = 200;
    switch (path) {
      case '/api/catalogue':
        body = catalogueJson;
      case '/api/auth/signup':
      case '/api/auth/login':
        body = {
          'user': {'id': 'user_1', 'email': 'dev@example.com'},
          'token': token,
          'expiresAt': 9999999999999,
        };
      case '/api/auth/logout':
        body = {'ok': true};
      case '/api/auth/me':
        if (!_authed(request)) {
          status = 401;
          body = {
            'error': {
              'code': 'UNAUTHORIZED',
              'message': 'Sign in to continue.',
            },
          };
        } else {
          body = meJson;
        }
      case '/api/me/resume':
        if (!_authed(request)) {
          status = 401;
          body = {
            'error': {
              'code': 'UNAUTHORIZED',
              'message': 'Sign in to continue.',
            },
          };
        } else if (request.method == 'PUT') {
          body = {'resume': resumeJson};
        } else {
          body = {'resume': resumeJson};
        }
      case '/api/me/parse-resume':
        body = {'resume': resumeJson, 'unparsed': <String>[], 'saved': false};
      case '/api/me/target':
        body = {'target': targetJson};
      case '/api/me/progress':
        body = {
          'completed': {
            'binary-search': '2026-09-29T00:00:00.000Z',
            'two-sum': '2026-01-02T00:00:00.000Z',
          },
        };
      case '/api/companies':
        body = companiesJson;
      case '/api/interview/generate':
        body = kitJson;
      case '/api/interview/kits':
        body = kitsJson;
      case '/api/interview/kits/kit_abc':
        body = kitJson;
      default:
        status = 404;
        body = {
          'error': {'code': 'BAD_REQUEST', 'message': 'no route for $path'},
        };
    }
    final encoded = utf8.encode(jsonEncode(body));
    return http.StreamedResponse(
      Stream.value(encoded),
      status,
      headers: {'content-type': 'application/json'},
    );
  }

  static bool _authed(http.BaseRequest request) =>
      request.headers['authorization'] == 'Bearer $token';
}

void main() {
  group('account models', () {
    test('parses a resume round-trip', () {
      final resume = Resume.from(jsonDecode(jsonEncode(resumeJson)));
      expect(resume.summary, 'Backend engineer');
      expect(resume.experience.single.company, 'Acme');
      expect(resume.experience.single.bullets, ['Built queues']);
      expect(resume.skills.single.name, 'Python');
      expect(
        resume.sourceIds,
        containsAll(['general', 'exp:1', 'skill:1', 'proj:1']),
      );
      expect(resume.sourceLabel('exp:1'), 'Engineer @ Acme');
      expect(resume.sourceLabel('skill:1'), 'Python');
      expect(resume.sourceLabel('general'), 'general');
      // Unknown ids degrade to the raw id rather than throwing.
      expect(resume.sourceLabel('exp:gone'), 'exp:gone');

      final back = Resume.from(jsonDecode(jsonEncode(resume.toJson())));
      expect(back.experience.single.title, 'Engineer');
      expect(back.contact.email, 'dev@example.com');
    });

    test('parses target, companies and seniority', () {
      final target = Target.from(jsonDecode(jsonEncode(targetJson)));
      expect(target.goal, 'Backend role');
      expect(target.seniority, Seniority.mid);
      expect(Seniority.parse('senior'), Seniority.senior);
      expect(Seniority.parse('nope'), Seniority.mid);

      final companies = Json.listOf(
        companiesJson['companies'],
        CompanyProfile.from,
      ).whereType<CompanyProfile>().toList();
      expect(companies, hasLength(2));
      expect(companies.first.label, 'Big Tech (general)');
      expect(companies.first.hiringAxes.single.categories, contains('coding'));
      expect(companies.first.rounds.single.name, 'Phone screen');
    });

    test('parses an interview kit', () {
      final kit = InterviewKit.from(jsonDecode(jsonEncode(kitJson)));
      expect(kit.kitId, 'kit_abc');
      expect(kit.questions, hasLength(2));
      expect(kit.questions[0].type, QuestionType.resumeDeepDive);
      expect(kit.questions[0].practiceProblemId, isNull);
      expect(kit.questions[1].practiceProblemId, 'binary-search');
      expect(kit.usedTier, 'template');

      final summaries = (kitsJson['kits']! as List)
          .map(InterviewKitSummary.from)
          .toList();
      expect(summaries.single.count, 2);
    });

    test('tolerates thin payloads', () {
      expect(Resume.from(null).skills, isEmpty);
      expect(Target.from(null).companyId, 'custom');
      expect(CompanyProfile.from(null).hiringAxes, isEmpty);
      expect(QuestionType.parse('nope'), QuestionType.concepts);
    });
  });

  group('account endpoints', () {
    test('login stores the token and sends it back as a bearer', () async {
      final seen = <http.BaseRequest>[];
      final api = ApiClient(httpClient: AccountRoutes(seen));
      final res = await api.login(
        email: 'dev@example.com',
        password: 'correct-horse-99',
      );
      expect(res.user.email, 'dev@example.com');

      api.setAuthToken(res.token);
      final me = await api.me();
      expect(me.user.id, 'user_1');
      expect(me.resume.experience.single.company, 'Acme');
      expect(me.target?.companyId, 'faang-general');
      expect(me.progress, contains('two-sum'));

      final authed = seen.where((r) => r.url.path == '/api/auth/me').single;
      expect(authed.headers['authorization'], 'Bearer ${AccountRoutes.token}');
    });

    test(
      'a missing token surfaces 401 as UNAUTHORIZED, not retryable noise',
      () async {
        final api = ApiClient(httpClient: AccountRoutes([]));
        try {
          await api.me();
          fail('expected ApiServerException');
        } on ApiServerException catch (e) {
          expect(e.code, 'UNAUTHORIZED');
          expect(e.isUnauthorized, isTrue);
          expect(e.isRetryable, isFalse);
        }
      },
    );

    test('interview generation parses questions and practice links', () async {
      final api = ApiClient(httpClient: AccountRoutes([]));
      api.setAuthToken(AccountRoutes.token);
      final kit = await api.generateInterview();
      expect(kit.questions, hasLength(2));
      expect(kit.questions[1].practiceProblemId, 'binary-search');
      final kits = await api.fetchInterviewKits();
      expect(kits.single.kitId, 'kit_abc');
      final companies = await api.fetchCompanies();
      expect(companies, hasLength(2));
    });
  });

  group('auth controller', () {
    test(
      'temporary boot failure retains token and retry restores account',
      () async {
        var offline = true;
        final routes = AccountRoutes([]);
        final api = ApiClient(
          httpClient: MockClient((request) async {
            if (offline) throw http.ClientException('offline');
            final response = await routes.send(request);
            return http.Response.fromStream(response);
          }),
        );
        final tokens = MemoryTokenStore();
        await tokens.write(AccountRoutes.token);
        final auth = AuthController(api, tokenStore: tokens);
        await auth.boot();
        expect(auth.signedIn, isFalse);
        expect(auth.sessionRecoveryAvailable, isTrue);
        expect(await tokens.read(), AccountRoutes.token);
        offline = false;
        await auth.boot();
        expect(auth.signedIn, isTrue);
        expect(auth.sessionRecoveryAvailable, isFalse);
        expect(auth.error, isNull);
        auth.dispose();
      },
    );

    test('rejected boot token is cleared rather than retried', () async {
      final api = ApiClient(
        httpClient: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'error': {'code': 'UNAUTHORIZED', 'message': 'Expired session'},
            }),
            401,
          ),
        ),
      );
      final tokens = MemoryTokenStore();
      await tokens.write('expired');
      final auth = AuthController(api, tokenStore: tokens);
      await auth.boot();
      expect(auth.signedIn, isFalse);
      expect(auth.sessionRecoveryAvailable, isFalse);
      expect(await tokens.read(), isNull);
      auth.dispose();
    });

    test(
      'boot revalidates a stored token and merges server progress',
      () async {
        final seen = <http.BaseRequest>[];
        final api = ApiClient(httpClient: AccountRoutes(seen));
        final tokens = MemoryTokenStore();
        await tokens.write(AccountRoutes.token);
        final adventure = AdventureController(MemoryBackend());
        final auth = AuthController(api, tokenStore: tokens)
          ..attachAdventure(adventure);
        await auth.boot();
        expect(auth.ready, isTrue);
        expect(auth.user?.email, 'dev@example.com');
        // Server held two-sum; the union is adopted locally.
        expect(adventure.progress.completed, contains('two-sum'));
      },
    );

    test('boot without a token is silently signed out', () async {
      final api = ApiClient(httpClient: AccountRoutes([]));
      final auth = AuthController(api, tokenStore: MemoryTokenStore());
      await auth.boot();
      expect(auth.ready, isTrue);
      expect(auth.signedIn, isFalse);
    });

    test('login merges local progress, logout clears the session', () async {
      final api = ApiClient(httpClient: AccountRoutes([]));
      final tokens = MemoryTokenStore();
      final adventure = AdventureController(MemoryBackend());
      final auth = AuthController(api, tokenStore: tokens)
        ..attachAdventure(adventure);
      await auth.boot();
      expect(
        await auth.login(
          email: 'dev@example.com',
          password: 'correct-horse-99',
        ),
        isTrue,
      );
      expect(auth.signedIn, isTrue);
      expect(await tokens.read(), AccountRoutes.token);

      await auth.logout();
      expect(auth.signedIn, isFalse);
      expect(await tokens.read(), isNull);
    });
  });

  group('account screens', () {
    Future<void> bootApp(
      WidgetTester tester,
      List<http.BaseRequest> seen,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      // Memory token store: the platform-storage one never completes under
      // `flutter_test`, which would wedge sign-in on a spinner (see main.dart).
      await tester.pumpWidget(
        DsaGameApp(
          api: ApiClient(httpClient: AccountRoutes(seen)),
          authTokenStore: MemoryTokenStore(),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('sign-in lands on the account screen with three tabs', (
      tester,
    ) async {
      final seen = <http.BaseRequest>[];
      await bootApp(tester, seen);

      await tester.tap(find.text('Profile'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(find.text('Sign in'), findsAtLeastNWidgets(1));

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Email'),
        'dev@example.com',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Password (8+ characters)'),
        'correct-horse-99',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Your profile'), findsOneWidget);
      expect(find.text('Resume'), findsOneWidget);
      expect(find.text('Target'), findsOneWidget);
      expect(find.text('Interview'), findsOneWidget);
      expect(find.text('Resume saved'), findsOneWidget);
    });

    testWidgets(
      'interview tab reopens saved kits and generates grounded cards',
      (tester) async {
        final seen = <http.BaseRequest>[];
        await bootApp(tester, seen);

        // Sign in first.
        await tester.tap(find.text('Profile'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Sign in'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Email'),
          'dev@example.com',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Password (8+ characters)'),
          'correct-horse-99',
        );
        await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
        await tester.pumpAndSettle();

        await tester.tap(find.text('Interview'));
        await tester.pumpAndSettle();
        await tester.tap(find.textContaining('2 questions · template'));
        await tester.pumpAndSettle();
        expect(
          seen.any(
            (request) => request.url.path == '/api/interview/kits/kit_abc',
          ),
          isTrue,
        );
        expect(
          find.text('Walk through your work as Engineer at Acme.'),
          findsOneWidget,
        );
        await tester.tap(find.text('Regenerate'));
        await tester.pumpAndSettle();

        expect(
          find.text('Walk through your work as Engineer at Acme.'),
          findsOneWidget,
        );
        expect(find.text('from: Engineer @ Acme'), findsOneWidget);
        expect(find.text('from: Python'), findsOneWidget);
        expect(find.text('Practise this'), findsOneWidget);
      },
    );
  });
}
