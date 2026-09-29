# DSA by playing — Flutter mobile client

A native-feeling Flutter client for the DSA learning game. You do not solve a
coding problem; you **play** a generated mini-game whose moves *are* the
algorithm's operations, and you finish with a replay, the real code and a
complexity analysis.

Built against the shared HTTP contract in
`packages/game-schema/src/*` — the same API the Next.js web client uses. No web
code was copied; the Dart models are hand-written mirrors of the TypeScript
types.

---

## Running it

```bash
cd apps/mobile
flutter pub get
flutter run
```

### The API base URL

The client reads its base URL from a compile-time define and defaults to
`http://127.0.0.1:8787`:

```bash
# iOS simulator / macOS desktop / Chrome — the default is already correct
flutter run

# Android emulator — the host is 10.0.2.2, not 127.0.0.1
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8787

# A real phone on the same wifi — use your laptop's LAN IP
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:8787
```

`127.0.0.1` on a handset means *the handset*, so a device that cannot reach the
server shows a "Cannot reach the API" card with the URL it tried — that is the
single most common setup mistake and the error state names it.

Start the API first (`pnpm dev` at the repo root, port 8787).

### Cleartext HTTP for local development

The game API is plain HTTP in dev, which both mobile platforms block by default.
The exceptions added here are dev-only:

| Platform | File | What it does |
| --- | --- | --- |
| Android | `android/app/src/main/AndroidManifest.xml` | `android:usesCleartextTraffic="true"` plus `android:networkSecurityConfig` |
| Android | `android/app/src/main/res/xml/network_security_config.xml` | permits cleartext for `127.0.0.1`, `localhost`, `10.0.2.2`, `10.0.3.2` |
| iOS | `ios/Runner/Info.plist` | `NSAllowsLocalNetworking` + `NSExceptionDomains` for `localhost` / `127.0.0.1`, and `NSLocalNetworkUsageDescription` so the LAN prompt has a reason |
| macOS | `macos/Runner/*.entitlements` | `com.apple.security.network.client` |

Remove all four before shipping over HTTPS.

---

## Dependencies, and why

The budget is deliberately three packages. This is a client for a laptop demo,
and every dependency added is one more thing to audit, update and tree-shake.

| Package | Why | Why not dio / riverpod / google_fonts / shared_preferences |
| --- | --- | --- |
| `http` | The only transport. Six endpoints, no interceptor or retry policy needed, and `MockClient` ships inside it, which is what makes the widget tests possible. | `dio` would add interceptors, formatters and a bigger web bundle for features this client never uses. |
| `provider` | `ChangeNotifier` lives in the Flutter SDK, but the widget layer needs *a* way to rebuild on state change without writing one. `provider` is the smallest thing that does that. | `riverpod` (or `flutter_riverpod`) would be a larger dependency and a bigger mental model for two controllers. Generators (`build_runner`, `freezed`, `json_serializable`) were deliberately avoided: they add a build step, and the contract says to hand-write the models. |
| `cupertino_icons` | Ships with `flutter create` and is used for the couple of Cupertino-styled affordances. | — |
| `shared_preferences` | The one persistence in the app: mission stamps, world badges, map frames and notebook drafts. Everything else stays server-side or in memory. | A heavier store (sqlite, hive) for what is one JSON blob plus a handful of draft strings. |

Not added, on purpose: `google_fonts` (a network fetch at startup and a bundled
font; the themed Material 3 theme is the visual identity here).

### The TypeScript package as a dependency — not used

The brief asked to consider a path dependency on `packages/game-schema` *if it
works without a build step*. It does not: the package is TypeScript source that
is consumed through `tsc`/pnpm workspace resolution, and there is no Dart/JSON
artefact of the types to point a `pubspec.yaml` at. Consuming it would have
meant a generated JSON-schema step before `flutter pub get` could work.

**Decision: the Dart models in `lib/models/` are self-contained, hand-written
mirrors of the contract.** The trade-off is real — a field added to
`api-types.ts` will not appear in the client until someone adds it here — and it
is mitigated three ways:

1. Every `fromJson` is defensive (`lib/models/json.dart`), so a *new* field is
   ignored rather than crashing, and a *changed* field degrades to a default.
2. `test/fixtures.dart` is a hand-written copy of the contract's shapes, and
   `test/contract_test.dart` asserts against it, so drift shows up as a failing
   test the moment the fixture is updated.
3. Enum values the client does not know fall back (see
   `MechanicId.parse`, and every other `parse` in `lib/models/enums.dart`)
   instead of throwing.

`packages/game-schema/src/json-schema.ts` is the one artefact that *would* have
been the right input to a generator; if a build step is ever acceptable, that is
the file to generate from.

---

## Architecture

```
lib/
  main.dart                     app root, DI, shell theme
  models/                       Dart mirrors of the TS contract
    json.dart                   defensive coercion helpers
    enums.dart                  every closed string union + a `parse` fallback
    variables.dart              Variables / VarValue / Attrs
    action.dart                 sealed class Action + 10 variants
    state.dart                  GameState, GameObject, GameContainer, Cursor, …
    trace.dart                  TraceFrame, TracePointers, Complexity
    spec.dart                   GameSpec, Palette, Vocabulary, Narration
    problem.dart                ProblemMeta, TopicDto, CatalogueResponse
    provider.dart               ProviderTier, CoachSource, availability
    api.dart                    requests, responses, ActionOutcome, Debrief
  services/
    api_client.dart             typed HTTP, one place for every failure mode
    api_exception.dart          sealed error taxonomy
  state/
    catalogue_controller.dart   GET /api/catalogue + health probe
    game_controller.dart        generate → play → debrief, history, hints
  theme/palette.dart            Material 3 theme from spec.visual.palette
  screens/                      topic · problem · play · debrief
  widgets/
    board/                      the board: tiles, slots, nodes, links, pools
    mechanics/                  one widget per mechanic + the registry
    replay/                     replay board + code viewer
    algorithm_strip.dart        live lo/mid/hi/i/j + variables
    trace_rail.dart             action history, scrubable
    hint_button.dart
    common.dart                 error cards, provider badges, chips
    generation_loader.dart      themed loading state
```

### State: two `ChangeNotifier`s

`CatalogueController` owns the topic list. `GameController` owns one game:
`gameId`, `spec`, `state`, `outcome`, `phase`, `debrief`, the hint, and a
**history of full state snapshots**.

### About that "undo stack"

The API has no undo endpoint. The server holds the authoritative state per
`gameId` and validates every action against it, so a real undo would mean
resimulating the algorithm — which only the oracle can do.

What the client does instead is keep a full `GameState` snapshot after every
action it received, and let the player **rewind the view** to any of them
(the `Rewind` button, or tapping a row in the trace rail). The rewound board is
clearly labelled read-only, and the next action snaps back to live. This is an
honest affordance — "look at the board on both sides of that mistake" — rather
than a fake undo that would desynchronise from the server.

### Selection is engine-owned

`GameState.selection` belongs to the oracle: tapping an object emits a real
`selectObject` action and the engine decides what it means. To make taps feel
instant anyway, `MechanicViewState` keeps a short list of pending taps, renders
the union with the engine's selection, and clears it the moment the response
lands. The engine's answer always wins.

### The board never scrolls horizontally

A board the player has to pan is a board they cannot see while deciding.
`SlotGrid` derives its column count from the available width and wraps into extra
rows, keeping slot `index` labels readable across the wrap; the only horizontally
scrolling surface is the free-object pool, which is a tray rather than the
algorithm's state. The whole board region is vertically scrollable so a short
screen (with the outcome banner and hint card open) can never clip the last row.

### Runtime theming

The shell theme is one dark Material 3 theme. `PlayScreen` and `DebriefScreen`
wrap themselves in a `Theme` built from `spec.visual.palette`, so a generated
game looks like its own world while the topic and problem screens stay neutral.
Palette strings are parsed defensively (`#RGB`, `#RRGGBB`, `#AARRGGBB`, a small
CSS-name table); an unparseable colour falls back to the shell palette.

---

## Verification

```bash
cd apps/mobile
flutter pub get
flutter analyze        # No issues found!
flutter test           # 23 tests
flutter build web --release
flutter build apk --debug
```

Both builds were run and both succeeded (output in the handover notes). The
tests are not decoration — they found five real defects during development:

- `state.selection` coerced non-string elements to `''`, inventing object ids
  that do not exist (`Json.stringList` now drops them).
- "Generate a game" generated the game but never navigated to it.
- `ObjectTile` asked for infinite width inside the pool's `ListView`.
- The board region overflowed when the outcome banner squeezed it.
- `LinkPainter._arrowHead` walked `Path.computeMetrics()` twice and threw
  `Bad state: No element` during paint, which killed the whole linked-list
  board.

`test/mechanics_layout_test.dart` renders **all ten mechanics** against three
board shapes (linear array, stack + queue, linked list) on a 360×640 phone and
asserts no overflow and no exception, because a spec may enable any subset in
any order and every combination is a different layout.

---

## Anything in the contract that was awkward to model

**`Container` collides with Flutter's `Container`.** The contract's
`Container` is a game stack/queue. Dart has no namespacing, so the model is
`GameContainer` and the mapping is documented at the class. Every widget file
that needs both would otherwise need a `hide` on one of them.

**`Variables` and `internal` are `Record<string, number | string | boolean |
null>`.** Dart cannot express a union of primitives without `dynamic`, and the
brief forbids `dynamic` in models. `VarValue` is a sealed hierarchy
(`NumValue` / `TextValue` / `FlagValue` / `NullValue`) so the algorithm strip can
ask for a real `num?` while still rendering whatever the engine sent. A weaker
tier that writes `"17"` for a number still displays as text *and* answers
`number('17')`.

**`Record<string, string | number | boolean>` (`tags`, `meta`, `internal`)**
became `Attrs`: an unmodifiable wrapper with typed accessors. It has no
operators, because nothing indexes it by anything but a literal key.

**`Record<string, GameObject>` etc.** stay maps keyed by id, because the oracle
owns the ids. The lookups the board needs (ordered slots, occupancy, pool,
per-kind objects) are getters on `GameState` rather than pre-baked lists, so
there is exactly one definition of "which object is in this slot". That
definition resolves occupancy from *either* `Slot.occupantId` **or**
`GameObject.slotId`, because oracles in the wild use both and a board that
trusted only one would render half-empty.

**`Action` is a `sealed class`.** A new action type is a compile error, not a
silently-unhandled branch, and `switch` expressions over it are exhaustive.
`outcome.expected` is a `Partial<Action>`, so it goes through the same lenient
reader — the only field it truly needs is `type`.

**`TraceFrame` has no state.** A replay frame carries `pointers` and
`variables` but not the board, so the debrief's replay has two honest modes: a
real board for every frame the client dispatched (it holds the post-action
snapshot), and a labelled "pointers only" view for the canonical trace, which
the client never played. Inventing a board for those would teach the wrong
thing. `GameState.withObjects` / `withVariables` exist solely to project a
frame's pointers onto a snapshot without touching the engine's state.

**`z.array(z.tuple([Line, Line]))`** (the spec's `mapping`) is
`List<MappingRow>`, matching the shape `DebriefResponse.mapping` already uses —
so the client does not need to care whether it came from the spec or the
debrief.

**`codeLine` is 1-based** and indexes both `pseudocode()` and `code(lang)`, which
is why the code viewer can highlight "your lines" in both blocks with one set of
line numbers.
