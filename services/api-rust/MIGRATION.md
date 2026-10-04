# Rust backend migration ledger

> Node remains the source of truth and the default runtime. Rust is opt-in via
> `pnpm dev:api:rust`, `pnpm build:api:rust`, `pnpm test:api:rust`.
> `GET /api/health` reports `migrationComplete: false`. **No cutover has occurred.**
>
> This file is the machine-checkable record. The human-facing narrative lives in
> `services/api-rust/README.md`; the two must stay consistent.

## Summary

Route patterns (method + path), counted from the source:

| | Count |
| --- | ---: |
| Node route patterns | 43 (across 36 distinct paths) |
| Live in Rust (`src/lib.rs`) | 43 (across 36 distinct paths) |
| Return **501 `MIGRATION_INCOMPLETE`** | 0 |
| Catch-all status | Unknown routes use Node-compatible 404 envelopes; internal failures use `ApiError` |

Component status counts are not yet established. Populate them as modules are
planned; an unpopulated table is more honest than an invented one.

| Status | Count |
| --- | ---: |
| not-started | - |
| analyzed | - |
| planned | - |
| migrating | - |
| ported-unverified | - |
| ported-known-gaps | - |
| validated | - |
| blocked | - |
| deprecated | - |

## Implemented components and proof boundaries

| Component | Native implementation | Evidence |
| --- | --- | --- |
| Auth / accounts / resume / target / interview kits | `auth.rs`, `account.rs`, `resume.rs`, `interview.rs` | Legacy scrypt and session compatibility, account fixtures, mock model smoke, browser profile and kit generation |
| Gameplay / catalogue / oracle / templates / guidance / hints / undo / debrief | `game_routes.rs`, `runtime.rs`, `oracle_*.rs`, `template.rs`, `guidance.rs`, `hints.rs`, `debrief.rs` | All 45 problems, 30 seeds and three difficulties; 134,681 release HTTP comparisons |
| Owned snapshots and direct action replay | `games.rs` | Legacy snapshots, restart/isolation, atomic receipt failure, guest receipt eviction tests |
| Coach / guardrails / budget / fallback / persistence | `coach_*.rs` | 135 HTTP journeys, 8,100 snapshots, 32,256 guardrail cases, 8,100 fallbacks, 84 budget windows; owned recovery/isolation/pagination |
| Learning history / dashboard / threads / plans | `learning.rs`, `history.rs`, `dashboard.rs` | 67 Node HTTP smoke comparisons, native learning tests, browser dashboard |
| Streaming chat / cancellation / action cards | `chat.rs`, `sse.rs` | Durable replay, regeneration, cancellation/disconnect, ordered events, bounded output, plan/interview/game cards; browser stream and reload |
| Providers / decision layer | `provider.rs`, `game_chain.rs`, `game_provider.rs`, `decisions.rs` | Bounded admission/cancellation/timeout, remote HTTP mocks, 135 llama protocols and 1,485 salvage comparisons; Laya confidence and heuristic fixtures |
| Contracts / numeric and random semantics | `contracts.rs`, `compat.rs`, exported JSON data | Contract drift, seeded oracle/runtime/template and HTTP fixtures |
| SQLite / limits / cache / backup | `db.rs`, `config.rs`, `cache.rs`, backup CLI | Existing migration IDs, bounded worker and caches, ownership/expiry, WAL backup and overwrite refusal |

There are no remaining 501 route stubs. Fixtures normalize nondeterministic
IDs and timestamps. AI output is validated structurally and with pinned mocks;
live provider availability/output is outside deterministic parity evidence.
Unusual malformed legacy records and nonstandard JavaScript `Date.parse` forms
beyond the accepted common stored formats remain edge-case compatibility limits.

## Deployment acceptance still pending

| Gate | How it runs |
| --- | --- |
| Linux 256 MiB container and sixty-minute mixed workload | GitHub Actions `container-memory`, Node and Rust reports uploaded together |
| Peak below 230 MiB, no OOM or steady growth | Evaluate cgroup reports; cache accounting alone cannot prove this |
| Default-command/CI deployment cutover | Only after behavior and measured memory acceptance; Node remains selectable |
| Production backup, stopped-Node handoff and rollback exercise | Native backup command and explicit commands in README; production data untouched |

Do not treat earlier macOS idle RSS as evidence for Linux acceptance.

## Verification record

Append-only. Each entry is a command and its result. Prior results are
historical and must be re-run to be cited as current.

| Date | Command | Result |
| --- | --- | --- |
| - | `pnpm test` | recorded 832 pass, 2 live-provider skipped (historical) |
| - | `pnpm test:api:rust` | recorded 34 pass (historical) |
| - | `python3 scripts/rust-auth-smoke.py` | passed for implemented endpoints (historical) |
| - | `python3 scripts/rust-learning-smoke.py` | 67/67 requests (historical) |
| - | `python3 scripts/rust-account-model-smoke.py` | 13 model-backed cases per runtime, mock provider (historical) |

## Current validation checkpoint (2026-10-03)

Suggestion/decision HTTP parity (134 responses), catalogue response-byte parity,
and game snapshot persistence tests (135 Node snapshots) pass. Library/binary
Clippy passes with warnings denied. A full release run reached the guidance
synthetic-state tests and failed there; all-target Clippy also reported three
warnings in guidance files. Those parallel guidance changes remain unregistered
in the service. This is not a passing full-suite or migration acceptance result.

## Debrief checkpoint (2026-10-04)

`src/debrief.rs` ports the post-game teaching builder. The initial implementation
passed 4,050 seed/difficulty cases with initial and terminal payloads (8,100
comparisons). The allocation reduction is being rechecked against those cases.
`GET /api/game/:gameId/debrief` passes 271 Node HTTP status/JSON-content fixtures;
JSON object key ordering is ignored in this comparison. Restart recovery and
account isolation pass with legacy bearer and cookie sessions. Completed games
restore from SQLite; unfinished games preserve the 409 error and unknown games
preserve the 404 error. No production database or default runtime was changed.

## October 4 verification checkpoint

- Gameplay HTTP parity: 134,681 responses, 45 problems, 30 seeds, three difficulties, release pass.
- Coach HTTP: 135 differential journeys passed; owned restart/isolation/pagination/game-immutability test passed.
- Game action cards: owned generation, replay and restart pass, with cross-account rejection.
- Unknown routes now return Node-compatible 404 envelopes.
- TypeScript: 832 passed, two live-provider tests skipped; typecheck and frontend production build pass.
- Browser: catalogue, guest generate/play, hints, coach and binary-search terminal completion verified against Rust.
- External Laya confidence parsing, session transcripts/nested prompts, HTTP-only stateless/llama-server adapters, grammar downgrades, and partial-spec salvage pass mocks and differential fixtures.
- GitHub validation and 256 MiB container benchmark workflow added; no remote run or memory acceptance is claimed.

Direct gameplay action-ID replay, atomic receipt persistence, guest receipt eviction, browser profile/interview/dashboard, and streaming-chat reload are implemented and tested. Measured container acceptance and deployment cutover remain outstanding. Node defaults remain unchanged.

## Final local regression checkpoint

The native regression suite passed 115 tests with only the long full gameplay
HTTP test filtered. A separate current gameplay HTTP recheck passed all 45
problems and three difficulties at seed 0; the earlier full release test passed
all 30 seeds and 134,681 responses. CI reruns the full release suite without
filters. Formatting and all-target Clippy with warnings denied pass.

Browser verification also covers owned practice creation, saved move and hint
counts after reload, and their appearance in dashboard history. Test-only services
use disposable SQLite and mock remote AI. The container workload preserves the
existing 30 chat requests per user per hour; after exercising each test account's
chat allowance, both AI workers continue coaching for the rest of the hour.
No local Docker or remote workflow measurement is claimed.

The benchmark HTTP harness smoke passes 345 gameplay responses plus concurrent
AI operations, stream replay, message pagination, and oversized input rejection.
The latest TypeScript rerun passes 832 tests (two live-provider tests skipped),
with typecheck passing. The browser owned mission completes in ten moves with
zero mistakes and one hint; debrief/history/scheduled review are verified.
Concurrent guidance mutation work has invalidated some live-tree test runs;
passing snapshots must not be presented as a stable final-tree acceptance gate.

## Pre-push validation checkpoint

After the temporary guidance mutations were restored, all 13 guidance integration
tests pass, including `every_gap_branch_matches_node`. Formatting and all-target
Clippy with warnings denied pass. This closes the previously reported local
guidance failure; the GitHub workflow still provides full release and container
acceptance gates before default cutover.
