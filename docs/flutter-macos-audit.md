# Flutter macOS learning audit

Audit date: 3 October 2026. Native debug app, Flutter 3.47.5 / Dart 3.13.4, isolated local API on port 8788, persistent SQLite test database. Synthetic accounts and resume content were used. Existing web work and the normal API database were preserved.

## Reproduced issues and changes

| Area | Reproduced issue | Change and verification |
| --- | --- | --- |
| Desktop shell | Desktop used a stretched mobile layout. | Five-destination navigation rail above 720 logical pixels; centered content capped at 1080. Native 800- and 1440-wide windows inspected; widget test changes between desktop and phone navigation while retaining a draft. |
| Briefing | Long mission choices pushed the Start action below the default macOS window. | Collapsible mission chooser, visible learning objective and difficulty explanation. Native Prefix Sum briefing inspected; generation still requires the primary action. |
| Patterns and tracks | Practice links generated immediately without a briefing or usable loading state. | Route through the normal problem briefing. Native Patterns journey and both library widget tests verified. |
| Board | Numeric labels repeated and branch candidates looked like recommended selections. | Suppress identical text labels; distinguish current operands from branch candidates. Native rotated-search board and operand tests verified. |
| Final answers | Typing did not enable Submit; the displayed target object could be sent instead of the oracle's answer destination. | Rebuild on input and share oracle-provided answer destination between TypeScript and Dart. Native high-difficulty rotated search completed and opened its debrief, replay and code. |
| Assign value | Prefix Sum required a new variable, `p_1`, that the client could not select; typing did not enable Assign. | Add oracle assignment destinations to shared guidance and both clients. Native saved run resumed after API restart, offered `p_1`, accepted `20`, and advanced. Regression checks cover canonical assignment destinations for every registered game at all three difficulties. |
| Chat code | Multiple copy buttons were detached from their code blocks. | Language header and exact-snippet Copy beside each fenced block; horizontal scrolling for long code. Narrow-width widget copy tests passed. |
| Resume | Rebuilding the form minted new skill IDs, causing false unsaved status and destabilizing references. | Retain saved skill IDs and stable IDs for newly edited skills. Saved-form status regression passed. |
| Session recovery | Starting while the API was unavailable erased a valid saved token. | Preserve credentials during transport/server failures and offer Retry session. Native offline startup displayed recovery, and retry after restarting the API restored the account and its stamp without entering credentials. Regression also covers clearing a genuinely rejected token. |
| Resume import | Duplicate extraction actions and misleading extraction copy. | One extraction/review action, explicit review before saving, draft retention. Real provider extraction with synthetic input and native save verified. |
| Interview | Past kits were noninteractive text and could not be reopened after restart. | Fetch/open controls with loading state. Saved native kit reopened and its selected question opened contextual Chat; regression covers reopening and regeneration. |
| Interview fallback | Provider validation details leaked into the normal UI. | Plain fallback status; strict enum instructions added to generation prompt. Native built-in kit was usable. A successful real-provider kit after the prompt change is not established. |
| Notebook search | No-results search had no clear recovery. | Named empty state and Show all concepts reset. Native search/reset and widget coverage verified. |

## Native journeys exercised

- Sign-in, five primary destinations, exploration, briefing, real-provider high-difficulty game generation, board interaction, final submission, debrief, replay and code.
- Chat tutoring with streamed Markdown/code; conversational practice preview, generation and reopening the same saved game; returning from gameplay to its originating conversation.
- Cancellation and retry: stopped output remained recoverable, retry completed without duplicating the user question, and a generated study plan saved to Progress.
- Progress recommendation/resume, practice history, review entry and saved Markdown plan disclosure.
- Synthetic resume extraction/review/save, interview target save, interview generation fallback, saved-kit reopening and selected-question Chat entry. A real-provider reply evaluated the learner's invariant reasoning and asked the next follow-up. The answer draft survived the app restart; evidence included the selected interview question.
- API restart with persisted conversation/game restoration. Actual-provider tutoring and game generation were exercised separately from mocked tests.

## Automated validation

| Check | Result |
| --- | --- |
| Root TypeScript check | Passed |
| TypeScript unit/integration suite | 809 passed, 2 skipped |
| Registered-game playability | 45 games, 30 seeds, low/medium/high via the oracle suite |
| Web production build | Passed |
| Flutter analysis | No issues |
| Flutter tests | 89 passed |
| macOS debug build | Passed |
| Diff whitespace check | Passed |

Local logs are in `.dev/macos-audit-*.log`; `.dev/flutter-macos-progress-wide.jpg` records the expanded native Progress window, and `.dev/flutter-macos-interview-chat.jpg` records real-provider answer feedback and a follow-up. Tests include account-scoped progress/drafts, explicit guest import, narrow mechanics, code copying, desktop/phone shell changes, large text and keyboard insets. These are automated coverage, not physical-device claims.

## Remaining proof boundaries

- This was broad native macOS workflow testing, not a manual execution of all 45 games or every combination of filters and provider failures. Oracle and widget suites supply the broader deterministic coverage.
- Physical iOS/Android, OS background/foreground network transitions and a complete VoiceOver audit remain unverified.
- Flutter 3.47.0 emitted native accessibility-tree failures during route changes. The project is pinned to 3.47.5, whose audited runtime did not emit those failures in the exercised flows. This does not prove every screen-reader flow; Flutter tracks a related macOS semantics issue in [flutter/flutter#187198](https://github.com/flutter/flutter/issues/187198).
- Compact/large-text/mobile-keyboard layouts were covered in widget tests; native windows were inspected at the default and expanded desktop sizes.
- Account switching and destructive conversation operations were covered by automated tests rather than a second native account-switch/delete journey. No production or personal data was deleted.
- Interview generation fell back to a validated built-in kit when real-provider output failed schema validation. The user could continue practice, but real-provider interview-kit quality needs a separate successful run.
