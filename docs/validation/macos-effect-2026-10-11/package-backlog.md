# Requests for effect_core after the macOS application validation

Inspected version: the hosted `effect_core 0.0.1` resolved by this app, rather than a newer local checkout. The app consumes this package at HTTP and streaming reliability boundaries. SQL and OpenAI packages are not needed in this Flutter client: it talks to the application backend.

## P1: Retain cleanup failures when timeout wins (reproduced)

`Effect.timeout` awaits `worker.interruptAndAwait()` but ignores the worker's resulting Cause. A resource release that throws `StateError('release-defect-marker')` is visible as a Defect without timeout. With a 10 ms timeout around sleeping work, release still runs exactly once, but the result contains only Expected('deadline'). The cleanup defect has disappeared from the returned result.

Reproducer: `apps/mobile/tool/effect_package_probe.dart`; run `fvm dart run tool/effect_package_probe.dart` from `apps/mobile`. Evidence: `package-probe.json` in this directory. Published source: `lib/src/core.dart`, `Effect.timeout` around lines 663–683.

Request: preserve non-interruption cleanup failures when timeout wins, e.g. a documented composite Cause containing timeout and cleanup failure. Do not discard the failure or skip awaited cleanup. Acceptance: test both expected cleanup failures and defects; verify release once, retained stack trace, timeout plus cleanup diagnostics, and no retry of a cleanup defect through an expected-error schedule. This is a package diagnostic defect, not evidence that application resources failed to release during the live journey.

## P1: Selective typed retry

Published `retry(Schedule)` repeats every standalone Expected failure. Our API client must encode permanent failures as successful Exit values, pass them through the schedule and restore their failure channel. This works, but makes a safety-critical rule harder to review.

Request: a typed `while` predicate or `retryWhile` that sees E, plus optional attempt metadata. Acceptance: 503 retries; 401, malformed data, cancellation and defects do not; predicate false preserves the original Cause; backoff remains interruptible and test-clock driven. Mutating HTTP operations remain single-attempt unless the application supplies an idempotency contract.

## P1: Richer retry schedules and independent production jitter

Schedule already has exponential factor, jitter and a seed. Do not add these again. It lacks a maximum delay and an error-dependent delay callback. Every retry evaluation currently constructs `Random(schedule.seed)`, with default seed zero, so default jitter across equivalent retry runs follows the same sequence.

Request: capped delays, a hook for Retry-After/error-specific delay, and a production entropy default with an explicitly deterministic seed for tests. Add a convenient overall elapsed budget while retaining per-attempt deadlines. Outer `timeout` can already bound a composed retry; a budget helper is an ergonomics request, not a missing timeout primitive.

Acceptance: cap extreme exponential delay; respect server-directed delay only for permitted operations; stop at elapsed budget; separate clients do not all choose identical jitter by default; seeded TestClock tests remain reproducible. Our app deliberately fails 429 once today, rather than immediately retrying it.

## P2: Runtime/request observability

Runtime already supports an injected logger and structured `log`. It does not automatically publish fiber/request spans, attempt timings, cancellation reason or cleanup duration. Application measurements in this report required Stopwatches and custom reports.

Request: optional, low-overhead lifecycle observer/tracing hooks, stable correlation IDs and adapters for metrics/export. Acceptance: observe attempts, retry delays, timeout, interruption and cleanup failure; redact request content/tokens; observer failure does not change Effect outcomes; benchmark disabled-hook overhead. Slow-finalizer diagnostics should preserve awaited cleanup semantics.

## P2: Optional HTTP and SSE integration package

The app still owns AbortableRequest wiring, HTTP error classification, UTF-8/SSE framing, terminal-event validation, connect/idle deadlines and transport teardown. Core already provides native stream adaptation and bounded buffers; those are not missing.

Request: an optional `effect_http`/SSE adapter rather than HTTP dependencies in core. Include bounded frame size, CRLF and UTF-8 split-boundary handling, multi-line data, early EOF/malformed event errors, safe body consumption, request cancellation and separate connect/idle limits. Acceptance: native macOS and browser tests, idle/abort/early consumer exit, no automatic SSE replay, and no mutation retry without explicit opt-in.

## P2: Optional service resilience combinators

Circuit breakers and rate-limit/bulkhead policy are not present in the published API inspected here. Core already has bounded concurrency primitives.

Request: shared per-service circuit-breaker and token-bucket helpers that compose with existing Semaphore/Clock and typed errors. Acceptance: half-open probes, fair cancellation-aware waits, bounded queued work and injected-clock tests. This is a prospective enhancement; the native journey did not encounter a breaker-related outage.

## Application work, not package requests

- Open: the real native array-max-min hint claimed unsorted values were ordered. The shared `HINT_LADDER.read` text needs problem-specific grounding; typed Effect success cannot certify learning-content correctness.
- Open: final native profile p95 build time was 18.605 ms, with 44/583 sampled build frames above 16.67 ms. Profile the UI/layout/semantics/transition workload before attributing this to core; measured request-wrapper median overhead was only 0.056 ms.

- Fixed in this validation: interview and Chat action requests now consume `ApiConfig.generateTimeout` instead of hardcoded 120/240-second deadlines; two regression tests verify abort and one attempt.
- `ApiClient.close()` starts Runtime shutdown without awaiting it because Flutter dispose is synchronous. An explicit awaited async close path would improve service-level shutdown verification. Runtime already supports awaited shutdown.
- `_runEffect` currently labels unrecognized/composite failure causes as cancellation. Preserve and report Sequential cleanup causes when the package exposes them; this mapping is application glue.
- A default read may consume three 10-second deadlines plus 750 ms backoff and cleanup. Configure an overall user-operation budget if a roughly 30-second outage wait is undesirable.
- Provider response time is independent of the Effect wrapper. A larger deadline permits completion; it does not make AI generation faster.

No upstream issue was filed and no package publication was changed by this validation.
