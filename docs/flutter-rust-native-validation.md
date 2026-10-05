# Flutter clients against the native Rust backend

Validation date: 5 October 2026. Flutter 3.47.5, native macOS and a wirelessly connected Xiaomi M2007J17I physical phone (Android 12/API 31). No emulator or simulator was used.

## Scope and isolation

The backend was a release build of commit `ef49313d710045913b96d835f9512fcec1313dc1`, extracted into an isolated checkout. It listened on `127.0.0.1:8797` and used `/tmp/dsa-native-e2e/test.sqlite`, a disposable SQLite database. This avoided the unrelated, in-progress guidance edits in the shared checkout. The service ran without Node or a JavaScript worker. OpenCode, local LLM and Laya adapters were disabled. AI requests used the existing benchmark's local HTTP provider on port 18997; no external model quality or availability is established by this test.

`integration_test/rust_journey_test.dart` runs the actual native Flutter application with its real HTTP client and controllers. It creates a synthetic account, uses in-memory client credentials/progression, and verifies:

- UI sign-in and authenticated identity.
- Owned seed-zero easy binary-search generation and resume through Progress.
- Hint retrieval and Undo, including removal of the undone trace frame.
- Ten correct canonical actions, a won terminal state and debrief navigation.
- Durable learning history containing the completed run.
- Chat input, streamed assistant output, completion and persisted user/assistant messages.
- Absence of Flutter exceptions during gameplay and at the end of the journey.

The deterministic moves are dispatched through the real game controller. Sign-in, navigation, expansion, Undo, debrief entry and Chat input are driven through native widget interactions. This is one complete HTTP-backed client journey, not a manual execution of every game or screen.

## Issues discovered and fixed

| Issue | Fix and regression coverage |
| --- | --- |
| Hints, feedback and expanded history squeezed the board and controls vertically. | The playing arena scrolls as a whole with a bounded board height; screen regression exercises all three together. |
| Multiple pointers overflowed one cell when binary search collapsed. | Fit the pointer group within the cell; regression renders lo/mid/hi together at 66 pixels. |
| Long trace labels had ellipsis without a width constraint. | Constrain the action label; narrow trace regression retains code/scrub affordances. |
| Landscape debrief results exceeded the available height. | Scroll the results header with the tab content; screen regression switches to a short landscape surface. |
| Nested app shell/screens both resized for the keyboard. | Let each screen's Scaffold handle keyboard space. |
| Landscape keyboard left too little height for Chat controls. | Compact Chat prioritizes the composer, returning context/retry controls when space permits; landscape keyboard regression checks Send remains reachable. |

## Results

| Check | Result |
| --- | --- |
| Native macOS real-HTTP journey | Passed; 13 seconds after build |
| Physical Xiaomi Android real-HTTP journey | Passed; 18 seconds after build/install |
| Flutter unit/widget suite | 95 passed |
| Flutter analysis | No issues |
| Diff whitespace check | Passed |

Unit/widget tests use contract fixtures and complement the real-HTTP native test. Android installation was manually approved on the unlocked phone; earlier install-prompt timeouts were retried. The final successful runs exercised the final layout fixes. Local execution logs are in `/tmp/dsa-native-e2e/{macos,android,flutter-tests,analyze}.log`; they are scratch evidence, not durable application data.

## Reproduction

Use a **disposable database**, not personal or production data. From the repository root, start the existing local benchmark provider:

```sh
python3 - <<'PY'
import importlib.util
import http.server
spec = importlib.util.spec_from_file_location('benchmark', 'scripts/rust-container-benchmark.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
http.server.ThreadingHTTPServer(('127.0.0.1', 18997), module.Provider).serve_forever()
PY
```

In another terminal, start Rust with remote-provider test settings (set `SDKROOT` to the installed macOS SDK if the native compiler needs it):

```sh
PORT=8797 API_HOST=127.0.0.1 DSA_DB_PATH=/tmp/dsa-flutter-test.sqlite \
LOCAL_LLM_ENABLED=0 LAYA_ENABLED=0 OPENCODE_ENABLED=0 OPENCODE_GO_ENABLED=0 \
OPENROUTER_API_KEY=test-only OPENROUTER_BASE_URL=http://127.0.0.1:18997 \
OPENROUTER_MODEL=benchmark-remote \
cargo run --locked --release --manifest-path services/api-rust/Cargo.toml
```

From `apps/mobile`:

```sh
flutter analyze
flutter test
flutter test integration_test/rust_journey_test.dart -d macos \
  --dart-define=API_BASE_URL=http://127.0.0.1:8797
```

For a connected physical Android phone, use its actual serial from `adb devices`, allow USB installation on the unlocked phone, and route its localhost to the host service:

```sh
adb -s <physical-device-serial> reverse tcp:8797 tcp:8797
flutter test integration_test/rust_journey_test.dart -d <physical-device-serial> \
  --dart-define=API_BASE_URL=http://127.0.0.1:8797
adb -s <physical-device-serial> reverse --remove tcp:8797
```

The tests install a debug application. Do not point this test at a production API: it creates synthetic durable records.

## Migration acceptance boundaries

The existing [Rust migration report](../services/api-rust/MIGRATION.md) covers the broader oracle/HTTP/database validation. [GitHub run 37211452779](https://github.com/iamudesharma/dsa_game/actions/runs/37211452779) passed both behavior and container-memory checks for backend commit `ef49313`. The five-minute 20-player/two-AI smoke benchmark peaked at approximately 138.3 MiB under a 256 MiB Linux container limit. A five-minute run does not replace the original long soak acceptance requirement.

This audit adds native Flutter client proof. It does not establish exhaustive native UI coverage, real remote-provider quality, Android lifecycle/network transitions, or iOS behavior. Web UI was not rerun in this native-device audit; its earlier evidence and CI build are separate. Production backup/rollback rehearsal and default-command cutover remain separate acceptance work; Node defaults are preserved and Rust still reports `migrationComplete: false`.
