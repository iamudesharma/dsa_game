# macOS Effect validation — 2026-10-11

The Flutter app uses the published `effect_core 0.0.1` at its HTTP and streaming boundaries. This report records native macOS application journeys, profile-mode transport measurements and a separate package diagnostic reproducer. Detailed package requests and acceptance criteria are in [the package backlog](macos-effect-2026-10-11/package-backlog.md).

## Environment and isolation

- Apple M1 MacBook Air, 8 GB RAM, arm64, macOS 27.0.1.
- Flutter 3.47.5 / Dart 3.13.4 via FVM. Hosted `effect_core: ^0.0.1`, resolved 0.0.1; no local dependency override.
- Actual Node/Hono API on `127.0.0.1:8798`, using disposable SQLite `/tmp/dsa-macos-effect-20261011/live.db` and the configured live provider chain. Test accounts and in-memory client token/progress stores avoid altering existing native accounts.
- Journeys and transport integration run in the actual macOS app, without emulators or simulators. Form journeys run in debug; latency and board-frame measurements run in profile (AOT).
- `effect_sql`, `effect_postgres`, `effect_mysql` and `effect_openai` were not exercised by this Flutter client. Its backend owns database and AI access; these results concern `effect_core` and the app's integration with it.

## Validation results

| Check | Result |
| --- | --- |
| Flutter unit/widget suite | **406 passed**, including two new configured-deadline regressions |
| Flutter analysis / scoped formatting / diff whitespace | Clean |
| Native real-HTTP failure/stream transport | Passed: safe retries, one-attempt writes, UTF-8 completion, idle timeout, cancellation |
| Native live account/game/chat/interview journey | Passed with real Node/SQLite/provider requests |
| Native profile HTTP/policy benchmark | Passed |
| Native profile catalogue/rendering | **135/135 boards passed**, 45 problems × three difficulties |
| Separate published-package cleanup probe | Reproduced diagnostic loss under timeout; see backlog |
| Normal profile preview / real keyboard input | Passed: real typing/filter recovery, guest instant launch, action, hint transport and undo |

The account journey deliberately uses UI sign-in, Progress resume, debrief navigation and the Chat send control. Canonical gameplay actions, hint/undo, profile/target writes, interview generation/reopening and persistence checks use the real application controller or ApiClient inside the native process. This proves native client/server integration; it is not a claim that every form button and mechanic was manually clicked.

Board generation uses all registered problems, all three difficulties and seed zero with `forceTemplate: true`. Generated boards are adopted into the real GameController and rendered on PlayScreen. This tests generation/parsing/rendering, not complete solutions for every problem or seed.

## Profile transport performance

Twenty warmup calls per client, then 200 interleaved measured calls per client, against the same minimal loopback HTTP server and empty-plans JSON. Both clients consume and decode the body; the Effect path also runs the app's error/retry policy and model normalization. Separate keep-alive clients avoid including cold connection setup. This is a small same-machine HTTP benchmark, not an internet/server-load benchmark or a pure runtime-only comparison.

| Path | Median | p95 | Mean |
| --- | ---: | ---: | ---: |
| Direct HTTP + JSON | 0.134 ms | 0.186 ms | 0.138 ms |
| Effect ApiClient | 0.190 ms | 0.263 ms | 0.197 ms |

The wrapper added about **0.056 ms median / 0.059 ms mean** here. Its relative mean overhead is about 42% against this exceptionally short baseline; the absolute cost is small for an application request. Effect adds reliability and ownership, rather than making raw HTTP faster. This difference includes application policy/parsing, so do not attribute all of it to the package runtime.

A separate 1,000-operation probe of a simple Effect measured 0.012 ms median with a shared Runtime and 0.013 ms with a fresh Runtime plus shutdown. These are single-effect lifecycle costs, not throughput figures for complex streams/resources.

- Two transient failures followed by success: **757 ms**, exactly three requests; measured request-start intervals **254 / 503 ms**, matching the configured 250 / 500 ms backoff plus transport/scheduler cost.
- A configured 50 ms deadline: **53 ms** observed, with retries disabled for this measurement.
- Cancellation scheduled at 10 ms: operation returned at **11 ms**, about 1 ms after the signal.
- 401, 429, 500 and malformed successful JSON: one request each. A POST receiving 503: one request.
- RSS across the 400 measured HTTP calls: **141.375 → 142.359 MiB**, about **0.984 MiB** growth. No forced GC or long soak was performed; this is a bounded observation, not proof of leak freedom.

Raw values: [benchmark.json](macos-effect-2026-10-11/benchmark.json).

## Native application performance

All **135 boards** (45 problems × three difficulties, seed zero) generated and rendered in the final profile run. Template generation measured 3 ms median, 10 ms p95 and 34 ms maximum, including transport and parsing.

Across **583 sampled test frames**:

| Frame phase | Median | p95 | Maximum | Above 16.67 ms |
| --- | ---: | ---: | ---: | ---: |
| Build | 2.574 ms | 18.605 ms | 73.674 ms | 44/583 |
| Raster | 2.420 ms | 5.511 ms | 27.875 ms | 1/583 |

Build-time outliers during this route/render workload exceed a 60 Hz frame budget, so do not call this uniformly smooth. This includes startup, transitions and different board shapes; instrumented pumps sample frames rather than reproducing continuous user interaction. These measurements do not isolate Effect as the cause. The small transport-wrapper cost was measured separately; a CPU/DevTools trace is needed before assigning UI build costs to the package.

Raw board/frame values: [catalogue.json](macos-effect-2026-10-11/catalogue.json). The final profile run passed and emitted no accessibility-bridge warning.

Final live journey stage timings (include UI pumping/navigation, HTTP and parsing):

| Stage | Elapsed |
| --- | ---: |
| Signup and UI login | 4.147 s |
| Catalogue/lessons/profile/target/company round trips | 0.034 s |
| Resume, hint, undo, canonical solve | 6.677 s |
| Debrief navigation and live chat completion/persistence | 78.996 s |
| Interview generation and saved-kit reopening | 51.095 s (`opencode-go`) |
| Account isolation/thread cleanup | 0.094 s |

Raw values: [journey.json](macos-effect-2026-10-11/journey.json). The final native journey passed with no collected Flutter exception.

Provider latency dominates AI operations. Increasing the timeout allows a provider/fallback to finish; it does not reduce that latency. An earlier live interview call returned via `opencode-go` in 85.234 seconds, and another fell back to `template` in 48.809 seconds. Both were real backend calls, rather than mocked responses.

## What Effect handled

- Typed transport errors at a shared service boundary, with expected failures separated from package defects/interruption.
- Bounded, exponential retries for safe transient reads, and single-attempt writes/generation/chat.
- Abortable native HTTP, per-attempt deadlines, interruptible schedules and Runtime shutdown.
- Pull-based SSE consumption with application connect/idle deadlines, UTF-8 decoding and terminal-event validation. Native transport checks cover successful completion, idle timeout and cancellation without replay.
- Preserved public `ApiException` contracts, so existing widgets/controllers continue to present recovery UI.

## Manual native preview

The normal profile app (WidgetsFlutterBinding, rather than a test binding) was opened against the disposable API with in-memory account/progress storage. Real desktop input verified Learn search → empty state → Show all concepts recovery, Explore → guest briefing → instant generation, a recommended select action, hint transport, move-history expansion and Undo move. Undo returned the turn to the read operation. The preview remains on the adventure map.

**Application content gap, still open:** the array-max-min board showed `[5, 58, 86, 65, 26, 35]`, but its built-in hint claimed the values were ordered and that examining every value was unnecessary. `HINT_LADDER.read` in `packages/provider-chain/src/providers/template.ts` contains binary-search-specific wording reused for other read operations. This requires problem-specific hint grounding and tests. Effect can propagate a validation error once the application detects it; it cannot infer algorithmic correctness from a successful HTTP response. Hint transport passed; hint correctness did not.

This and the UI frame outliers are application improvements, not additions to the core package. Manual evidence: [manual-checks.json](macos-effect-2026-10-11/manual-checks.json).

## Fix and remaining gaps

Fixed during this validation: native interview and Chat action requests now use `ApiConfig.generateTimeout` (`API_GENERATE_TIMEOUT_MS`, default 240 seconds), rather than hardcoded 120/240-second values. Two new regression tests verify configured deadlines abort the HTTP attempt and do not replay the mutation.

**Reproduced package diagnostic defect:** timeout awaits cleanup, but discards its failure Cause. The standalone probe releases once in both variants; ordinary completion exposes a cleanup Defect, whereas timed completion exposes only Expected('deadline'). The cleanup defect/stack disappears from the returned result. This did not cause a failed resource release in the live app journey; it is a separately injected failure with a concrete reproducer.

Package requests, in priority order:

1. Preserve cleanup failures/defects when timeout wins.
2. Typed selective retry predicates, replacing our Exit-boxing workaround.
3. Capped/error-dependent retry schedules, independent production jitter and an elapsed-budget helper. Exponential delay, jitter and outer timeout already exist.
4. Optional lifecycle tracing/metrics beyond the existing manual structured logger.
5. Optional HTTP/SSE adapter with bounded framing and safe cancellation; core stream primitives already exist.
6. Optional circuit-breaker/rate-limit policies composed with existing bounded concurrency.

See [the forwardable package backlog](macos-effect-2026-10-11/package-backlog.md) for evidence, acceptance tests and separate application improvements (awaited async close, composite Cause mapping, overall request budget). No upstream issue or package release was created.

## Proof boundaries and test harness notes

- This is local macOS validation with Node/SQLite, not Rust cutover, iOS/Android acceptance, production network failover or a sustained-load/retention test.
- All catalogue boards at one seed and three difficulties are checked; exhaustive mechanic interactions and all random seeds remain outside this run.
- Profile synthetic `WidgetTester.enterText` uses an unregistered client ID (-1) that Flutter accepts only inside a debug assertion. Form journeys therefore use debug builds; profile UI checks use navigation/rendering. This is a harness limitation, not an Effect or app search defect.
- Observing accessibility during an earlier native test enabled an external SemanticsHandle and tripped the framework's end-of-test check after the journey assertions completed. The fixture now settles foreground/accessibility before WidgetTester records that baseline, and does not inspect accessibility during the test body. It also disables propagation of host desktop mouse events while retaining synthetic test gestures, preventing real pointer events from corrupting the instrumented gesture state. Interactive checks afterward use the normal binding and real input.
- Native instrumentation cannot write into host `/tmp` from the sandbox. Reports are emitted to stdout and saved by the host; app sandbox protections stay enabled.
- Earlier rapid instrumented route changes emitted macOS accessibility-bridge warnings after accessibility was enabled mid-run. The final run initialized that platform state before the test and emitted none. Full VoiceOver acceptance remains outside this run.
- UI replay/route tests use deterministic pump waits. Their total durations include the waits and must not be described as user-perceived route latency.

## Reproduction

From the repository root, start a disposable actual backend:

```sh
mkdir -p /tmp/dsa-macos-effect-20261011
PORT=8798 DSA_DB_PATH=/tmp/dsa-macos-effect-20261011/live.db pnpm --filter @dsa/api start
```

In another terminal, from `apps/mobile`:

```sh
fvm flutter analyze
fvm flutter test
fvm flutter test integration_test/effect_transport_test.dart -d macos
fvm flutter test integration_test/effect_macos_journey_test.dart -d macos --dart-define=API_BASE_URL=http://127.0.0.1:8798 --dart-define=NATIVE_SETUP_DELAY_MS=20000
fvm flutter drive --driver=integration_test/driver.dart --target=integration_test/effect_macos_benchmark_test.dart -d macos --profile
fvm flutter drive --driver=integration_test/driver.dart --target=integration_test/effect_macos_catalogue_test.dart -d macos --profile --dart-define=API_BASE_URL=http://127.0.0.1:8798 --dart-define=NATIVE_SETUP_DELAY_MS=20000
fvm dart run tool/effect_package_probe.dart
```

During `NATIVE_PREPARE_VISIBILITY`, bring the native window forward and let the OS accessibility observer settle before the 20-second setup delay ends. Avoid driving desktop input during the test body. Save the `NATIVE_*_JSON` stdout records. No real-account cleanup is required; the test database is disposable. Keep native test launches sequential because they share an application bundle.

For a safe interactive preview (same app with temporary in-memory account/progress stores):

```sh
fvm flutter run -d macos --profile --target=tool/macos_effect_preview.dart --dart-define=API_BASE_URL=http://127.0.0.1:8798
```

The preview's data resets when it closes; its disposable backend remains available while the preview runs. Existing device account/progress stores were not changed.
