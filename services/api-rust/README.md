# Rust backend migration preview

The machine-readable migration ledger — what is ported, validated, pending or
blocked, with evidence — is [`MIGRATION.md`](./MIGRATION.md). This file is the
narrative; the ledger is the record.

All 43 Node route patterns have native Rust implementations. Deployment acceptance is pending; Node remains the default. Implemented
routes: health, signup, login, logout, auth/me, lessons, companies, learning
dashboard, filtered/paginated practice history, saved reflections, thread
creation/search/rename/deletion, paginated saved messages, study-plan reads,
resume and target reads/writes, completion-progress sync, owned interview-kit
reads/generation, grounded model-assisted resume parsing, streaming chat with
replay/regenerate/cancel, and plan/interview/game action cards. Catalogue,
suggestions, decisions, game generation, retrieval, actions, hints, undo,
debriefs, and all four coach HTTP routes are registered. Unknown routes return
Node-compatible 404 errors. No JavaScript runtime or worker is used by Rust.
The root `dev:api:rust`, `build:api:rust`, and `test:api:rust` scripts are opt-in;
existing Node commands are unchanged.

From the repository root:

```sh
cargo test --locked --manifest-path services/api-rust/Cargo.toml
cargo run --locked --manifest-path services/api-rust/Cargo.toml
```

Use a disposable `DSA_DB_PATH` and a different `PORT` while Node is running.
Do not open the production database concurrently with Node. The root `.env`
is loaded; exported environment settings override it. Relative database paths
are resolved against the repository root (containers should use absolute paths).

On this machine, the default SDK fails with an unknown `arm64e.x1` architecture.
The validated build workaround is:

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk cargo test --locked --manifest-path services/api-rust/Cargo.toml
```

## Resource limits

| Setting | Default |
| --- | ---: |
| `DSA_RUNTIME_WORKERS` | 2 |
| `DSA_MAX_REQUESTS` | 32 |
| `DSA_MAX_GAME_OPERATIONS` | 4 |
| `DSA_MAX_AI_REQUESTS` | 2 |
| `DSA_MAX_PASSWORD_OPERATIONS` | 1 |
| `DSA_SQLITE_CACHE_KIB` | 8192 |
| `DSA_CACHE_BYTES` | 33554432 |
| `DSA_BODY_BYTES` | 1048576 |
| `DSA_JSON_TOKENS` | 4096 |
| `DSA_PROVIDER_BYTES` | 2097152 |
| `DSA_SSE_BYTES` | 65536 |
| `DSA_DB_QUEUE` | 32 |
| `DSA_RATE_ENTRIES` | 4096 |

Configuration rejects invalid/zero/out-of-range values. Request admission lasts
until the response body is consumed or dropped. Body reads have a 15-second
deadline. Overload returns 429 and `Retry-After: 1`. Password hashing has one
blocking worker permit retained even after HTTP cancellation. SQLite executes
on a dedicated thread with a bounded, fail-fast queue; cancelled queued jobs
are skipped. In-flight transactions finish atomically.

SQLite uses WAL, foreign keys, 8 MiB page cache, no memory mapping, and file-backed
temporary storage. Existing migration SQL is copied exactly and checked against
Node by a test. Old scrypt hashes and SHA-256 session-token hashes are compatible.

Cache accounting measures serialized bytes and keys, **not process memory**.
Game and coach persistence use this shared cache. Chat uses fail-fast AI admission
and bounded SSE output; per-account admission prevents concurrent responses.
Remote fallback applies only before the first delta, with a 15-second failure
cooldown. Disconnects and cancellation release upstream reads and preserve
partial replies. Health reports `migrationComplete: false`.

## Reference and acceptance work

Generate bounded, compressed Node reference fixtures for all registered problems,
30 seeds, and three difficulties:

```sh
pnpm --filter @dsa/api exec tsx ../../scripts/rust-reference.ts
```

Fixtures and route inventory go to ignored `run/rust-reference`. State hashes
cover every accepted canonical action through the real Node engine. This is a
reference dataset, not HTTP gameplay parity. The separate gameplay HTTP suite
contains 134,681 Node response hashes across 4,050 complete journeys; its current
validation status appears in the checkpoint below. Separate chat HTTP
fixtures already compare SSE ordering, payloads, failures and cancellation.

All 45 seeded instance generators are ported and checked against 5,805 Node
reference cases. All 45 oracles pass 4,050 complete journeys against Node, including
legal actions, invalid moves, terminal states, canonical traces, answers, code
listings and complexity metadata. Engine-level fixtures also pass 4,050 journeys,
checking progress, rejected replay frames and terminal debrief telemetry. Hint
screening and undo match Node at 3,247 played states across all problems and
difficulties. Gameplay HTTP is registered. Pending implementation includes coach
HTTP integration and provider protocols, external decision-service adapters, game
action cards, and cutover. The deterministic decision engine passes 1,255 Node fixtures, and `/api/suggest`
and `/api/decide` match 134 serialized Node HTTP responses through Rust middleware.
`/api/catalogue` matches Node byte for byte for all 16 topics and 45 playable problems.
The post-game debrief route matches 271 Node HTTP status/JSON-content fixtures,
including unfinished games; owned debriefs restore after restart with legacy
bearer and cookie authorization.
Owned game persistence restores 135 Node-created snapshots (all 45 problems at
three difficulties), preserves reflections and completion timestamps, and rejects
malformed snapshots without deleting their rows. Guest snapshots retain the
three-hour expiry and 25-state undo depth. Deterministic templates match 4,050
Node specs. These component checks do not establish memory acceptance.
Legacy completion stamps
support RFC3339, RFC2822, ISO dates, and common slash/English date formats;
JavaScript's additional nonstandard Date.parse heuristics remain a compatibility
edge case to cover before cutover.

Thread/history pagination applies LIMIT inside SQLite before decoding JSON.
Dashboard, study-plan lists, and message pages stream from a single read
transaction with two queued 32 KiB chunks. Only one message/record is decoded
at a time, and client disconnect releases the cursor and worker. The dedicated
SQLite worker is occupied while a large response streams; its queue remains
bounded and rejects overflow. Dashboard aggregates remain catalogue-sized,
and retain the original review stages, recommendation precedence, and completion
stamp ordering. Imported completions do not create performance evidence.
First authenticated learning access recovers saved streaming messages and
running action records directly in SQL without loading the full message history.

Build the preview Linux image from the repository root:

```sh
docker build -f services/api-rust/Dockerfile -t dsa-api-rust-preview .
docker run --rm --memory=256m --memory-swap=256m -p 8788:8787 dsa-api-rust-preview
```

The Linux image and resource target are unverified until Docker is available.
Do not switch defaults on the strength of auth/health memory measurements.
Acceptance still requires Node/Rust baseline comparison and a 60-minute mixed
workload of 20 players plus two AI requests: peak cgroup memory below 230 MiB,
no OOM, no steady growth, and complete behavior parity. Run this against the
finished backend, including filesystem memory charged to the container.

For implemented-route parity and a clearly labelled idle RSS comparison:

```sh
python3 scripts/rust-auth-smoke.py
python3 scripts/rust-learning-smoke.py
```

The smoke test launches each server with its own temporary database, compares
signup/login/auth-me/logout and error responses, and stops both processes.
Idle RSS samples are saved to `run/rust-reference/auth-smoke.json`; these are
neither load-test peaks nor Linux cgroup measurements.
The learning smoke test seeds a legacy Node database, copies it with SQLite
backup, then compares Node/Rust replies using the same account tokens and data.
It covers ownership, recovery, cursors/search/filtering, reflections, thread
mutations, saved plans, public reference data, and dashboard calculations.
The current release build passes profile defaults, strict validation, Unicode limits,
progress merge precedence, and malformed JSON as well as learning routes.
The release comparison passed all 67 requests. A separate local mock-provider
comparison passed 13 model-backed cases per runtime, with no paid calls.

At cutover, back up with SQLite's backup facility (the Rust `Db::backup` primitive
is tested), stop Node, then launch Rust. Keep the pre-cutover database snapshot
and Node start command for rollback. No cutover or production database access
has occurred in this preview.

## Recorded local verification

Native Rust component and HTTP integration tests and Clippy with warnings denied pass using the
SDK workaround above; the release build also passed. The complete TypeScript suite passed (832 tests; two live-provider tests skipped).
Frontend type-checking and a production build passed. Browser validation covers guest gameplay through terminal debrief, hints, coach, login, profile, target, interview kits, dashboard, and streaming chat with durable reload. AI browser checks use a local mock provider.
Reference capture produced 4,050 winning runs across 45 registered problems.
The auth smoke comparison passed for the implemented endpoints and sampled
95,872 KiB Node idle RSS versus 5,296 KiB Rust preview idle RSS on an earlier
auth-only preview. These samples predate the account and streaming additions. This compares
the full Node service with an incomplete Rust preview and does not establish
the memory savings of the finished replacement. The static reference drift test
also passed. The Docker daemon was unavailable on the latest check (OrbStack socket missing).
Linux image execution, cgroup memory, the 60-minute workload, and cutover remain unverified locally. The GitHub workflow performs the Linux acceptance workload.

Shared contract exports are regenerated at development time with:

```sh
pnpm --filter @dsa/api exec tsx ../../scripts/rust-contracts.ts
```

Rust consumes the checked-in JSON directly, with no JavaScript runtime dependency.
Drift tests compare exports to the live shared schemas; a Rust test rejects
unsupported schema keywords. Installed Zod measures schema string limits in
Unicode code points; explicit JavaScript slices and progress timestamp limits
still use UTF-16 units. Validation retains error paths, details, defaults, and
strict unknown-key rejection. Profile reads validate legacy JSON and recover
corrupt values to the same empty resume/null target defaults as Node.

Chat differential validation uses a local mock provider and copies of a legacy
database containing 1,200 prior messages:

```sh
python3 scripts/rust-chat-smoke.py
```

It compares SSE ordering, duplicate replay, regeneration, scoped references,
provider failures/cooldowns, prompt context, action previews, plan idempotency,
and account ownership (23 HTTP cases; 11 mock-provider calls per runtime).
Rust integration tests separately cover disconnect/deletion races and explicit
cancellation with a 64-byte output budget. No paid providers are called.
Seeded fixtures and oracle journey hashes live under `tests/fixtures`; the
Docker image excludes them. Regenerate them with `rust-instance-fixtures.ts`,
`rust-oracle-fixtures.ts`, `rust-scan-fixtures.ts`, `rust-stateful-fixtures.ts`,
`rust-runtime-fixtures.ts`, and `rust-hint-fixtures.ts` through the API workspace's
`tsx` executable. The scan fixtures cover alternate assignments, reversed
comparison arguments, wrong comparisons, and early submissions in 90 journeys.
Static client-visible oracle metadata is exported by `rust-oracle-data.ts`;
its `--check` mode checks drift without modifying the file. Runtime code never
executes these JavaScript listings. Cache accounting does not include transient
oracle states; the finished service still needs total-container memory testing.

### Gameplay and coach continuation (2026-10-04)

The Rust router now registers generate, game retrieval, action, undo, and hint,
using the native provider chain, oracle runtime, guidance, and durable snapshots.
All four coach routes now run native Rust handlers with guardrails, bounded context, fallback replies, account ownership, pagination, and restart recovery.

Fresh verification in this checkpoint:

- All 38 Node gameplay validation/error fixtures match.
- Owned gameplay HTTP recovery preserves the board and spec after restart;
  ownership checks precede malformed action validation for action, hint, and undo.
- All 38 library unit tests and four snapshot/persistence tests pass, including
  135 legacy Node snapshots, guest expiry, and bounded mutation admission.
- Coach context budgeting matches 84 Node windows, including oversized snapshots,
  count limits, newest-turn truncation, Unicode token estimates, and summary caps.

Game cache reads renew TTL through the shared cache without serializing and
replacing the full board and undo payload again. They still validate restored
state and check ownership. Cache accounting remains serialized payload plus keys,
not total process or container memory.

The complete gameplay HTTP journey suite is a separate long-running check.
Coach snapshots match 8,100 initial/terminal Node payloads across 4,050 seeded
journeys. Spoiler detection and digit-free rewrites match 32,256 Node cases,
and deterministic fallback/repetition avoidance matches 8,100 Node cases.
Coach persistence restores 45 Node records without changing their public shape,
checks owner isolation and guest-game expiry, and paginates owned metadata in SQL
without fetching stored boards. All components are wired to coach HTTP.
A passing implementation fixture is not proof of
the 256 MiB deployment budget, frontend browser behavior, or cutover acceptance.

## Latest behavioral verification

The release gameplay HTTP comparison passed 134,681 responses across all 45
registered problems, 30 seeds, and three difficulties. Coach HTTP journeys passed
all 45 problems and three difficulties. Action cards retain the generated owned
game across replay and restart. The web production build passes. These checks do
not establish container memory acceptance. Browser coverage is recorded above.

GitHub Actions runs release Rust behavior tests, Clippy, formatting, TypeScript
checks, client tests, and the frontend build. Node remains selectable until the
separate container acceptance benchmark passes. External Laya is opt-in using
`LAYA_ENABLED=1`, `LAYA_BASE_URL`, optional `LAYA_MODEL`, `LAYA_API_KEY`, and
`LAYA_TIMEOUT_MS` (default 1500). It uses bounded transport and shared AI admission;
unusable responses fall back to deterministic heuristics. No local process starts.

## Container acceptance and rollback commands

Routine GitHub validation runs a five-minute Rust-only memory workload with a
256 MiB hard memory/swap limit, two CPUs, 20 players and two external mock AI
workers. A measured memory failure permits one five-minute retry at 512 MiB.
The peak limits are 230 and 460 MiB respectively. SQLite and charged filesystem
memory are included; the frontend and mock provider are outside the budget.
Both jobs have a 30-minute hard timeout, target 10–15 minutes on a normal runner,
and obsolete runs are cancelled automatically. PR branches run once per PR
update; push validation runs only on main/master.

Quick memory acceptance requires at least five minutes, 54 samples, no OOM or
workload errors, observed simultaneous AI operations, exercised players, and
bounded warmed memory growth. It covers all 45 problems and three difficulties
using seed zero. This is a short constrained-memory check, not proof of hour-long
stability. Reports label `measurementProfile=quick` and retain the original
256 MiB result when falling back.

Routine Rust behavior tests use `DSA_PARITY_SEED=0`, preserving every game and
difficulty plus the rest of the unit/integration suites. The exhaustive 30-seed
HTTP suite remains available manually with `cargo test --locked --release
--manifest-path services/api-rust/Cargo.toml` and no parity seed environment
setting. An optional manual hour-long comparison uses `python3
scripts/rust-container-benchmark.py --backend both --profile soak --seconds
3600`; build the Node baseline image first. It is not part of routine CI.

After all behavior and memory acceptance gates pass, use the native backup
command (reads the source without applying migrations and refuses an existing
destination):

```sh
services/api-rust/target/release/dsa-api --backup run/dsa.db run/dsa-before-rust.sqlite
# Stop the Node service before starting Rust on the production database.
DSA_DB_PATH=run/dsa.db services/api-rust/target/release/dsa-api
```

Rollback after stopping Rust can run Node against the current compatible
database to retain newly written history:

```sh
DSA_DB_PATH=run/dsa.db pnpm --filter @dsa/api start
```

For recovery to the checkpoint, keep the live database intact and run Node
against the backup path instead. This restores the checkpoint and consequently
excludes writes made after backup; it performs no automatic history deletion.

```sh
DSA_DB_PATH=run/dsa-before-rust.sqlite pnpm --filter @dsa/api start
```

Native backup tests cover committed WAL data, integrity and overwrite refusal.
Old account/session and database recovery tests cover Node-compatible storage;
no production cutover or production rollback has been performed.

## Replay and external-service compatibility

Direct game actions with `actionId` atomically persist owned snapshots and receipts
in the existing `learning_actions` table. Restart and replay return the original
response; conflicting reuse returns 409. Guest receipts share the 32 MiB cache
and three-hour game lifetime. If a guest response receipt is evicted, compact
seen IDs prevent reapplying the move: clients receive 409 and reload the game.
Guest games admit at most 4,096 distinct action IDs during their lifetime.

External HTTP adapters never spawn a server or model. Session transcripts,
flat/nested prompts, stateless fallback, llama-server schema/GBNF/JSON-object
format downgrades, and partial-spec salvage are covered by local mocks and
135 protocol / 1,485 salvage differential cases. Enable remote endpoints explicitly
with `OPENCODE_ENABLED` / `LOCAL_LLM_ENABLED` and their `*_BASE_URL` settings.
`*_MODEL`, `*_TIMEOUT_MS`, `*_TEMPERATURE`, and `*_MAX_TOKENS` configure requests;
remote session timeout defaults to 200 seconds, llama-server to 60 seconds.
Failed provider tiers cool down for 15 seconds before retrying in subsequent
requests; schema repair occurs within the original admitted AI operation.

The running browser validation services use disposable SQLite and a mock remote
AI server. No production account, database, or paid provider was used.

The harness can be checked against a disposable backend with a separately running
mock AI server (no Docker or memory acceptance result):

```sh
python3 scripts/rust-container-benchmark.py --http-smoke http://127.0.0.1:8789
```

The local harness smoke passed 345 gameplay responses, concurrent coach/chat
operations, saved stream replay, SQL message pagination, and oversized input
rejection. Browser owned practice also completed in ten moves with zero mistakes
and one hint; its debrief and scheduled review are visible in dashboard history.

Game read, action, undo, hint, and debrief handlers share a separate immediate-admission limit. It bounds simultaneous decoded board/undo allocations while SQLite persists their changes. Excess operations receive the standard 429 envelope and `Retry-After`; clients should retry the same action ID before advancing. Coach operations remain bounded by the AI limit. Serialized cache accounting excludes these transient decoded objects.


The backend-only budget may increase to 512 MiB after a measured memory failure.
CI keeps the original reports and writes the larger-budget reports under
`fallback-512/`. Functional errors without OOM and incomplete measurements do
not trigger fallback. For a standalone five-minute 512 MiB check use
`python3 scripts/rust-container-benchmark.py --memory-mib 512`.

Compressing HTTP requests reduces transfer bytes, but JSON still requires
decoding in memory. Small gameplay commands do not contain the retained undo
histories. Request compression is therefore not enabled as a memory fix; the
body limit and decoded snapshot admission bounds remain in effect.


On Linux, the SQLite worker periodically checkpoints and syncs database/WAL
writes, then advises the kernel to release clean file-cache pages. This bounds
retained filesystem memory under history churn without deleting records or
changing SQLite's user-space page-cache limit. It can increase disk I/O under
heavy load. Filesystem charges remain included in the container benchmark.
