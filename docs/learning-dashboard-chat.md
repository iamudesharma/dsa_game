# Learning Dashboard and Chat

Web routes: `/dashboard`, `/chat`, `/chat/[threadId]`. Both sections require an account; guest practice remains available. Shared navigation connects the map, patterns, tracks, history, tutor, and profile.

## Persistence and ownership

SQLite migrations run on startup/database access. `DSA_DB_PATH` selects the database (default `run/dsa.db`). Back up that file before deploying. Account practice stores validated snapshots, traces, undo history, timestamps, mistakes, hints, and outcomes. Oracle handles are reconstructed from the registered problem registry. Signed-in coach transcripts and general tutor conversations are durable; guest games and coach threads retain their bounded in-memory behavior.

Browser completion stamps, resume drafts, chat drafts, and context selections are account-scoped. Guest stamps are imported only after an explicit click and remain completion-only evidence. Reflections enter account history and tutor context only after Save to history.

Dashboard totals and recommendations are deterministic. Reviews follow 1, 3, 7, and 14 days; a repeat win without mistakes/hints advances the interval, otherwise it returns to one day. Completion and this practice schedule are not mastery assessments.

## Tutor

The existing OpenCode Go and OpenRouter configuration supplies streaming text. Buffered in-game coach calls retain spoiler protections. General tutor replies can include solutions, Markdown, and code, with no execution. History is enabled by default; resume and target context require selection. Contact details and links are excluded from resume prompts.

`/api/learning` provides owned thread CRUD/search, transcripts, SSE message sending, cancellation, regeneration, action execution, practice/reflection history, dashboard summaries, and saved plans. Requests use client IDs; only one active response per account/thread is allowed. Partial replies and interrupted/failed states persist. Typed SSE events include status, text, actions, completion, and errors.

Action offers are derived from validated server catalogue entries. Only oracle-backed games are playable. Interview cards invoke existing grounded kit generation and require a saved target; plans are saved only by clicking a card. No available model leaves history readable and offers relevant deterministic practice links. History totals are computed on the server and source links accompany available evidence.

Message/context/output limits, deadlines, concurrency, and rate limits bound upstream usage. Earlier stored turns remain available even when excerpts replace them in the prompt. Authorization is enforced by authenticated ownership, independently of model text.

## Validation

Automated coverage includes account ownership, imported stamp honesty, SQLite restart recovery, every registered snapshot at easy/medium/hard, review intervals, partial streaming failures, cancellation, duplicate sends, regeneration, saved plans, action idempotency/CORS, and coach transcript recovery. The oracle playability suite covers 30 seeds across all difficulties.

Live checks used an isolated SQLite database and API port 8788. OpenCode Go streamed a tutoring response in the browser. A medium binary-search game generated from its card was played to completion and reopened in debrief; Dashboard displayed its mistake record. Dashboard/Chat document widths were checked at 390px. Switching to a second browser account showed empty practice and conversations with no inherited drafts. A live history reply cited the completed run and its one comparison mistake, while acknowledging the small sample. Full screen-reader and physical-device acceptance remain manual checks.

Deferred: arbitrary attachments, voice, web browsing, executable code, and a dedicated timed mock-interview room.

## Web and Flutter delivery (2026-10-02)

Both clients now expose Explore, Learn, Progress, Chat, and Profile. Learn groups the topic notebook, patterns, and tracks. The shared catalogue supplies 16 reviewed topic lessons and answer-format metadata. Flutter has authenticated learning models/API methods, UTF-8/CRLF SSE parsing, conversation recovery, explicit context selection, preview actions, saved plans, filtered/paginated history, and account-scoped drafts/progress with explicit guest import.

The backend plans bounded structured preview actions using recent conversation and prior cards, validates them against shared schemas and the playable registry, and stores successful result IDs. Choosing instant practice after a successful generated action reopens that result. Both clients recover the latest saved game state; Flutter no longer reopens the original generation snapshot. Typed run, replay-step, problem, and interview-question references are ownership-checked. History retrieval filters all owned records before selecting relevant evidence, and pagination remains additive for older clients.

Further live testing completed a high-difficulty rotated-search run begun on web, reopened its original card on Flutter, took the next step there, recovered it on web after reload, and finished with 13 moves, zero mistakes, and zero hints. This exposed and fixed numeric search-window controls, stale-cursor guidance, comparison target-pool selection, and cold-link authentication timing. Comparison/swap operands are now local choices until submission, with replacement and clear controls. Short-screen control panels scroll instead of overflowing.

Validation in this pass:

- TypeScript checks and web production build passed.
- 807 TypeScript tests passed; two opt-in provider tests were skipped. The 30-seed, three-difficulty oracle suite passed.
- Flutter analysis passed; all 81 tests passed, including Chat → preview → game → conversation → Progress resume, account isolation, stream framing, operand replacement, and large-text/keyboard layout cases.
- macOS debug build passed. Live Flutter desktop and 390px web journeys were exercised against the same isolated SQLite database on port 8788.
- Real OpenCode Go tutoring, a conversational high-difficulty/Python follow-up, and real-provider game generation were exercised separately from mocked tests.

Physical Android/iOS devices, a complete screen-reader audit, and every game's UI journey on both clients remain unverified. Automated oracle coverage proves the algorithm journeys, not every input/layout combination on every device.

Follow-up verification on 2026-10-03 confirmed that the regenerated live review persisted across a server restart. With selected-run inputs and the last 40 recorded steps supplied, it correctly named the target, array, branch sequence, final index, and recorded totals, cited the run, and distinguished a clean completion from evidence of retention. The selected-run context regression and TypeScript checks passed after this addition. Contextual Chat links now prefill their explicit prompt even when an empty new-chat draft was previously saved.
