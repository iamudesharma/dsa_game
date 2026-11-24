# Effect in the Flutter and React clients

Flutter uses the hosted `effect_core: ^0.0.3` package (Dart >=3.13).
React/Next.js and the Node provider chain use `effect: ^4.0.2`. The integration
lives in request, streaming and provider service boundaries, so widgets, React
hooks and Zustand keep their existing interfaces.

## Policy

- By default, GET requests run at most three times: initial attempt, then retries after
  250 ms and 500 ms. Network failures, timeouts and HTTP 502/503/504 qualify.
- Other statuses (including 401, 429 and 500), malformed successful JSON,
  permanent domain failures and cancellation are not automatically retried.
  A 429 should eventually use a server-directed Retry-After policy; retrying
  it immediately would amplify throttling.
- POST, PUT and DELETE run once. Generation, actions, undo, authentication,
  thread creation and chat messages require explicit user recovery unless
  the server provides a verified idempotency contract.
- Web game/interview generation and coach answers share the configurable
  `NEXT_PUBLIC_GENERATE_TIMEOUT_MS` provider budget (240 seconds by default).
  Flutter game/interview generation and Chat action generation use `ApiConfig.generateTimeout`
  (`API_GENERATE_TIMEOUT_MS`, also 240 seconds by default).
- A temporary session-validation failure preserves the saved token and offers
  explicit retry; only HTTP 401 clears an invalid session.
- Each attempt has its configured endpoint deadline. Flutter also applies a 15-second overall read budget (`API_READ_BUDGET_MS` or `ApiPolicy.readBudgetMs`), including backoff. Protected cleanup can extend the return time. Web reads retain their per-attempt deadlines plus backoff. Timeout includes consuming the response body.
- Public callers still receive `DsaApiError` (web) or `ApiException` (Flutter),
  preserving UI recovery behavior. The web HTTP retryability flag now correctly
  distinguishes server failures from permanent client/credential failures.

## Ownership

On web, `Effect.tryPromise` owns each request and supplies an AbortSignal.
`Effect.retry` and an exponential Schedule handle selected transient failures.
An upstream AbortSignal interrupts both I/O and backoff. The per-attempt timeout
aborts fetch; timers and signal listeners are removed in finally. Expected
failures are unwrapped before returning to React, retaining the public class.
Game, account, learning REST requests and coach conversation loading share this
transport. Auth headers, cookies and no-store behavior remain in place.

On Flutter, each REST request owns a Runtime which is shut down in finally.
`Effect.defer` allocates fresh HTTP abort state per attempt; `fromFuture` and
`timeout` abort transport when interrupted. `ApiClient.close()` interrupts active
runtimes and closes the shared HTTP client. `runExit` preserves expected errors
and propagates defects with their stack traces. Cancellation is exposed as
`ApiCancelledException`, which does not offer retry.

Dart 0.0.1 Schedule retries all expected failures without a predicate. The client
carries permanent failures as Exit values through the retry schedule, and restores
their error channel afterward. Only transient read failures reach the schedule as
expected failures.

Chat SSE uses Effect ownership on both clients with no automatic replay.
Web uses `acquireUseRelease`, interruptible connection establishment and guaranteed
reader cancellation/release on completion, error, timeout or interruption.
Flutter keeps pull-based delivery through StreamIterator and uses Effect deadlines
and cancellation hooks for connection and each read; the generator's finally block
shuts down the Runtime and cancels the iterator on consumer cancellation. Both stop
reading when the complete event arrives, even if the server keeps the socket open.
Split UTF-8 and CRLF frame handling remain intact.

The Node provider chain uses lazy Effect operations and passes their AbortSignal to
availability probes, generation and repair. Deadlines now abort cooperating I/O and
subprocesses rather than merely stop waiting for their Promise. Probes have a separate
5-second budget. Cancellation during probe/generation/repair exits immediately without
starting fallback work. Existing provider order, single schema repair and deterministic
template fallback are preserved; generation is not blindly retried. Providers that
ignore AbortSignal may still continue their underlying operation after timeout.

SQL/MySQL/Postgres/OpenAI client adapters are not installed: persistence uses SQLite
in the existing Node/Rust backend, and AI providers already have application-specific
routing, authentication and validation contracts.

## Configuration

Next.js reads explicit `NEXT_PUBLIC_*` environment variables at build time. Set them
in `apps/web/.env.local` and rebuild; `.env.example` documents their names.

| Web variable | Flutter --dart-define variable | Default web / Flutter |
| --- | --- | --- |
| NEXT_PUBLIC_API_READ_RETRIES | API_READ_RETRIES | 2 / 2 |
| NEXT_PUBLIC_API_RETRY_DELAY_MS | API_RETRY_DELAY_MS | 250 / 250 |
| NEXT_PUBLIC_API_TIMEOUT_MS | API_TIMEOUT_MS | 30000 / 10000 |
| NEXT_PUBLIC_GENERATE_TIMEOUT_MS | API_GENERATE_TIMEOUT_MS | 240000 / 240000 |
| NEXT_PUBLIC_API_STREAM_CONNECT_TIMEOUT_MS | API_STREAM_CONNECT_TIMEOUT_MS | 30000 / 30000 |
| NEXT_PUBLIC_API_STREAM_IDLE_TIMEOUT_MS | API_STREAM_IDLE_TIMEOUT_MS | 190000 / 190000 |

Flutter also accepts `API_ACTION_TIMEOUT_MS` (default 20000), and ApiConfig deadline
and ApiPolicy overrides for individual clients. Web request() accepts an optional
policy created with createApiPolicy(). Retry counts are bounded to 0..5; delays to
0..10000 ms. Invalid environment values fall back to defaults; Flutter rejects
invalid runtime policy overrides in release builds too. Set retries to 0 to disable
automatic read retries. Stream deadlines remain active independently of retry settings.
Flutter generation now defaults to 240 seconds, matching web and allowing room for
the backend's 200-second provider deadline; the previous 90 seconds was too short.

```sh
flutter run --dart-define=API_READ_RETRIES=2 --dart-define=API_RETRY_DELAY_MS=250
```

Server settings: `CHAIN_TIMEOUT_MS` retains its 200000 ms default;
`CHAIN_PROBE_TIMEOUT_MS` defaults to 5000. ChainOptions can override either deadline.
These settings affect the Node backend; the Rust backend remains independent.

## Verification

Run:

```sh
pnpm exec vitest run apps/web/src/lib packages/provider-chain/src
pnpm --filter @dsa/web exec tsc --noEmit
cd apps/mobile
flutter test test/api_effect_test.dart test/api_stream_effect_test.dart test/learning_test.dart test/account_test.dart test/contract_test.dart
flutter analyze
```

Tests cover recovery, retry limits, permanent HTTP and malformed-body failures,
single-attempt mutations, abort during web backoff, Flutter timeout transport
abortion, caller cancellation, stream cleanup and client shutdown. Provider tests
cover deadline aborts, hanging probes, and cancellation during schema repair. These are deterministic
transport tests; live backend/device network recovery is a separate check.

References: [effect_core](https://pub.dev/packages/effect_core),
[Effect retry policy](https://effect.website/docs/v4/error-management/retrying),
[Effect cancellation](https://effect.website/docs/v4/resource-management/introduction).

Current evidence: [2026-10-08 validation](validation/effect-2026-10-08.md).

## Hosted core 0.0.3 follow-up

Flutter uses `retry(..., whileError: ...)` directly. Composite timeout/cleanup
failures remain available as `ApiCleanupException.cause`; they are not mislabeled
as cancellation or automatically replayed. The UI shows a safe error message.
Use `await api.closeAsync()` in service/test teardown to finish cancellation and
reader cleanup before transport disposal. `close()` remains the synchronous
Flutter-dispose entrypoint and starts that same idempotent shutdown.

Optional `lifecycle` and `metrics` constructor parameters connect core's
`LifecycleSink` and bounded `RuntimeMetrics`. Events do not include headers,
tokens, payloads or error values. Sinks must not block; core isolates sink errors.
The metrics are per client; per-runtime fiber IDs are not globally unique.

`ApiPolicy.maxResponseBytes` defaults to 8 MiB (maximum configurable 32 MiB).
`maxStreamFrameCharacters` defaults to 1 Mi characters (maximum 8 Mi). Oversized
responses/frames fail without replay. These bound accumulated data, not native
network buffers or total process RSS.

The released `effect_http 0.0.2` is not installed: its SSE API is GET-only and its
HTTP errors discard structured error bodies. The application's POST chat stream
and server domain-error contract require the existing adapter. Revisit when
those APIs are supported; SQL and OpenAI adapters remain backend concerns.
