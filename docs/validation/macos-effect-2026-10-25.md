# macOS Effect follow-up — 24–27 October 2026

This follow-up upgrades the Flutter consumer to hosted `effect_core 0.0.3`, fixes the remaining application reliability/content issues from the 11 October report, and records new checks. The historical report remains unchanged. React continues to use npm Effect; backend SQL/OpenAI adapters are not installed in the Flutter client.

## Implemented

- Native selective retry replaces the successful-Exit workaround. Only safe reads retry transient network/timeouts/502/503/504; writes, authentication, generation and SSE are never automatically replayed.
- `API_READ_BUDGET_MS` / `ApiPolicy.readBudgetMs` bounds the entire read operation, including retries/backoff, at 15 seconds by default. Per-attempt deadlines remain. Awaited protected cleanup can extend a deadline's return time.
- Idempotent `ApiClient.closeAsync()` awaits request/reader shutdown before closing transport. Synchronous Flutter `close()` starts that same shutdown.
- Composite timeout/cleanup causes remain visible through `ApiCleanupException.cause`, with a safe UI message and no automatic retry. Core regression tests cover both expected cleanup failures and defects, stack preservation, release once and no replay.
- Optional core lifecycle callbacks and aggregate metrics are available on `ApiClient`. Observer failures cannot change outcomes; events do not contain headers, tokens, request bodies or error values.
- Responses have an 8 MiB default accumulation bound; SSE frames have a 1 Mi-character bound. Both are configurable. SSE now handles LF, CRLF and CR even across byte/UTF-8 boundaries, and retains multiline-data, early-EOF and terminal-event checks.
- Shared hints no longer assume every read is binary search, every container is a stack, every swap finishes sorting, or every traversal is a one-way linked list. Regressions include the actual unsorted array case; Node/Rust template data and hashes are synchronized.
- Explore subscribes only to account/completion changes for its dashboard. Gameplay state updates no longer rebuild the unrelated map. A captured widget trace showed one TopicScreen build before and zero after, with equivalent PlayScreen/GameBoard counts. The VM ring retained roughly the final 1.5 seconds, so these are sampled trace counts, not totals for the whole journey.

## Validation

| Check | Result |
|---|---|
| Full Flutter unit/widget suite | 418 passed |
| Additional reader-cleanup regressions | 2 passed; the complete stream file passed all 16 tests |
| UI regressions after narrowing Explore subscriptions | 24 passed |
| Flutter analysis | Passed |
| Full TypeScript suite, including React Effect transport | 870 passed, 2 opt-in live-provider tests skipped |
| TypeScript project typecheck | Passed |
| Expanded oracle matrix | 272 checks passed: 45 problems × 3 difficulties × 100 seeds = 13,500 canonical winning runs |
| Rust template parity | 4,050 seeded/difficulty template hashes passed |
| Native profile transport/failure matrix | Passed |
| Native five-minute ownership soak | Passed |
| Native real-backend account/game/chat/interview journey | Passed |
| Final native catalogue/frame run | 135/135 boards passed; p95 build 19.759 ms |
| VoiceOver | Enabled-state smoke checks passed; screen-reader cursor/activation remains unverified; restored off |

The native tests run on macOS with Flutter 3.47.5 / Dart 3.13.4, against disposable SQLite and Node API on port 8798. No emulators or simulators were used. The native journey uses UI sign-in/chat controls and real controllers/API calls for canonical gameplay, profile writes and persistence. It is not a claim that every mechanic was manually clicked. The seed matrix is finite, not exhaustive over every possible seed.

## Effect performance and ownership

The native profile benchmark used 200 interleaved warmed loopback requests per path. Raw HTTP median was **0.125 ms** (p95 0.201); the app wrapper median was **0.205 ms** (p95 0.298): about **0.080 ms median overhead** including the app's policies and parsing. A simple Effect measured 0.013 ms median with either shared or owned runtime. These are same-run measurements, not a controlled release-to-release speed comparison.

Transient-read recovery took 757 ms, with observed backoff intervals of 254/503 ms. A 50 ms deadline returned in 54 ms; cancellation triggered after 10 ms returned in 13 ms. Cleanup remains cooperative and awaited.

The five-minute soak completed **5,428 client lifecycles / 12,665 requests**, including safe-read retries, terminal SSE and repeated awaited close. All **63,326 fibers completed**, with **zero active fibers** after each shutdown. Sampled RSS ranged from 33.9 to 86.6 MiB, ending at 38.9 MiB. This demonstrates bounded observed behaviour during this run; it is not a universal leak-freedom or multi-day soak claim. Active cancellation, paused-stream close and cleanup failures are separate regression checks.

Evidence: [benchmark](macos-effect-2026-10-25/benchmark.json), [soak](macos-effect-2026-10-25/soak.json), [cleanup probe](macos-effect-2026-10-25/package-probe.json), [widget trace summary](macos-effect-2026-10-25/widget-trace.json).

## Frame performance

The final uninstrumented 135-board run passed on 25 October. Across 572 sampled
frames, build median/p95/max were **4.221 / 19.759 / 73.497 ms**, with 44 frames
above 16.67 ms. Raster median/p95/max were **3.645 / 7.620 / 35.769 ms**, with
three frames above 16.67 ms. The route-build/layout workload still misses a
60 Hz budget on some frames. Removing the unrelated Explore rebuild did not
establish a material improvement in aggregate p95; the before/after difference
is too small to claim one. This remains an application UI performance limitation,
not a reproduced Effect bottleneck. The instrumented trace also contains costly
layout/viewport regions; instrumentation itself adds overhead, so use the
uninstrumented timing data for frame claims. These samples cover initial board
renders and navigation, not a continuous gameplay FPS measurement.

[Final frame evidence](macos-effect-2026-10-25/catalogue-final.json).

## Real backend journey

| Operation | Observed duration |
|---|---:|
| Signup and UI sign-in | 4.477 s |
| Profile/target round trip | 0.048 s |
| Resume, hint, undo and solve | 6.609 s |
| Live Chat completion | 45.335 s |
| Interview generation and reopening (`opencode-go`) | 31.013 s |
| Persistence and second-account isolation | 0.055 s |

These timings include test/UI work and provider latency. They do not measure Effect alone. Guest learning and gameplay remain available; personal history and Chat remain account-owned. [Journey evidence](macos-effect-2026-10-25/journey.json).

## Manual accessibility closeout — 27 October

VoiceOver was observed off, enabled with the user's approval, and restored to
off after the check. The normal profile preview used in-memory token/progress
stores and the disposable backend. With VoiceOver enabled, the native AX tree
exposed navigation, lesson buttons and input; Learn navigation, real text entry,
empty search and Show all concepts recovery worked. The current Control-Option
modifier configuration was inspected without changing preferences.

Control-Option cursor/activation commands did not produce a verifiable navigation
result through the automation tool. **Full VoiceOver keyboard/speech acceptance
remains unverified.** This observation alone does not distinguish tool event
routing from application accessibility behaviour, so it is not assigned to
Effect or reported as a screen-reader pass. Accessibility semantics and large-text
widget regressions passed separately. The app remains open on Learn with the
search cleared; VoiceOver is confirmed off.

## Package requests

The old core requests—cleanup cause preservation, selective retry, richer schedules, observers and resilience helpers—are available in the hosted release. The remaining adapter requests are **POST/body support for SSE** and **bounded structured error-response decoding**; request correlation is a smaller ergonomics opportunity. The app retains its existing bounded transport adapter because `effect_http 0.0.2` is GET-only for SSE and discards non-2xx bodies. [Forwardable package backlog](macos-effect-2026-10-25/package-backlog.md).

No package release, upstream issue, push or deployment was performed. Native provider acceptance here covers the configured successful journey, not every provider, outage combination, device or long-duration production workload.

## Reproduce

From `apps/mobile`:

```sh
fvm flutter analyze
fvm flutter test --concurrency=1
fvm flutter drive --driver=integration_test/driver.dart --target=integration_test/effect_macos_soak_test.dart -d macos --profile
fvm flutter drive --driver=integration_test/driver.dart --target=integration_test/effect_macos_validation_test.dart -d macos --profile --dart-define=API_BASE_URL=http://127.0.0.1:8798 --dart-define=PROFILE_WIDGETS=true
fvm flutter test integration_test/effect_macos_journey_test.dart -d macos --dart-define=API_BASE_URL=http://127.0.0.1:8798
fvm flutter drive --driver=integration_test/driver.dart --target=integration_test/effect_macos_catalogue_test.dart -d macos --profile --dart-define=API_BASE_URL=http://127.0.0.1:8798
```

From the repository root, start an isolated API with a disposable `DSA_DB_PATH` and `PORT=8798`, then run `pnpm exec vitest run`, `pnpm typecheck`, and `PLAYABILITY_SEEDS=100 pnpm exec vitest run packages/dsa-oracles/src/playability.test.ts`. Rust template validation used Xcode's macOS 26 SDK because this host's command-line macOS 27 SDK was incompatible with the installed linker.
