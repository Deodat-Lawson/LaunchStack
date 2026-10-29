# Vantage compact topics and detail drawers — local handoff

## Version and running routes

Worktree: `C:\Users\junku\orca\LaunchStack\test-output\vantage-action-first-20261028\source`.
Branch: `feat/vantage-action-first-ui-local`. Starting commit: `b44cbe33442039a60cd2c7e9f08f0bf229e0a1e4`, a descendant of Joseph integration `301dcfc90fbfd6af33551b0cf0b3a7a2ced68df0`.

The sample already had compact rows on its main screen, but its Weekly Review and drawer repeated the decision and proposed action. The API-backed Context-Aware Demo still rendered large inline topic cards. Both presentations now use compact topic rows in this same worktree. No additional prototype was created.

- <http://localhost:3110/dev/vantage-action-sample> — captured synthetic report and local preview interactions. Its banner states that edits reset on reload.
- <http://localhost:3110/dev/vantage-action-sample?at=/review> — the sample's Weekly Review.
- <http://localhost:3110/dev/vantage-context> — authenticated, API-backed Joseph-integrated demo, with its existing review callbacks and exact-source authorization.
- Port 3104 remains the separate stable demo at `7bf2f201e0c56ff60b615477b5421e668563d28a`. It was not edited.

No attached screenshot was available in this session. The described enormous cards match the old Context-Aware Demo. A read-only capture of the stable version was taken as an additional visual reference; it is not a same-commit comparison.

## Start the existing prepared environment

The local server was left running on port 3110. To restart it from the existing prepared checkout:

```powershell
Set-Location 'C:\Users\junku\orca\LaunchStack\test-output\vantage-action-first-20261028\source'
$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
node scripts/dev/vantage-action-runtime.mjs --check
node scripts/dev/vantage-action-runtime.mjs --serve
```

Docker Desktop must be running. This existing launcher uses its verified isolated PostgreSQL runtime on port 55438, database `vantage_week2_tl_contract_v1`, container `launchstack-vantage-week2-tl-20261022-portable-db` and volume `launchstack-vantage-week2-tl-20261022-portable-data`. It does not use `pdr_ai_v2`. No preparation, migrations or seeding were performed for this UI refinement. Credentials remain in the ignored `test-output/vantage-context-demo/runtime/credentials.json`; do not copy their contents into logs.

The Company Architecture is still `unreviewed`. Joseph's required-context generation gate remains blocked. Saved reports and citations remain readable. This task made no generation request and invoked no paid model.

## Presentation changes

`topic-presentation.ts` provides a small frontend-only view model: title, objective issue, optional reason, optional approach details and a distinct decision question. It does not alter the report object or persist renamed topics.

The two known synthetic topics have concise wording guarded by the exact complete supporting fact text, rather than topic IDs alone. Changed facts fall back to their original wording. The general fallback keeps the original title and complete first fact, including qualifiers and negation. Missing facts do not become inferred progress. Original title, facts, interpretation, decision question, proposed step, rationale, unknowns and exact citations remain available in the drawer.

`CompactTopicRow` uses a native button, an action title, a short issue and AI/review status. There are no inline evidence paragraphs, decision panels or review buttons. The selected row has a restrained purple state. No suggestion is labeled as an accepted commitment.

`TopicDetailSheet` reuses the existing shadcn Sheet and Studio container behavior. The API-backed screen retains its current report/topic IDs, expected version, busy guards, Keep/Dismiss callbacks, decision modal, exact-source dialog and related commitment behavior. The sample retains its existing local preview controller and history. No parallel state-management system was introduced.

The drawer separates Issue from Why this matters, explicitly labels AI interpretation, exposes useful concrete approach details without repeating the title, and keeps exact sources in compact expandable evidence. Full statements/conflicts and original wording can be opened separately. Keep, Dismiss and Record Decision remain contextual actions. Historical questions and actual commitments retain their distinct types and controls.

| Before                                                                                       | After                                                                     | Why                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Sample Weekly Review rows were approximately 129px and 112px, with repeated decision content | Approximately 88.7px per topic; two topics visible together               | Make the issue scannable before investigation                                                                                |
| Old stable Context-Aware Demo cards measured approximately 732px and 606px                   | Current API-backed rows measure approximately 89.7px                      | Move detailed reasoning and review actions into the drawer; the stable measurements are a different-version visual reference |
| Evidence initially expanded multiple full source statements                                  | Compact exact-source buttons, with full statements in a nested disclosure | Preserve inspection without a wall of text                                                                                   |
| Interim dark drawer footer had a bright fallback background                                  | Existing panel/accent tokens throughout                                   | Fix contrast based on actual rendered screenshots                                                                            |
| Decision and proposed step repeated the action title                                         | Distinct decision only when useful; concrete approach details on demand   | Separate the issue from implementation detail                                                                                |

The screenshot review led to an explicit improvement pass: corrected dark footer/focus/selection tokens, labeled interpretation, corrected singular conflict wording, and nested the full evidence statements. No font-size-only redesign was used.

## Verification

- **55 tests passed in four suites**, including **14 real isolated PostgreSQL tests**. Covered presentation fallbacks/qualifiers, original-data immutability, drawer/review/source behavior and existing service persistence, concurrency, ACL and stale-source guards. PostgreSQL tests used port 55437 and their own synthetic fixture companies with cleanup, preserving the saved demo reports/reviews.
- Full web TypeScript check: passed (`tsc --noEmit`).
- Scoped ESLint and formatting checks: passed for changed frontend files.
- **20/20 final headless browser checks passed** across both routes: 1440/1280 desktop, 768 tablet, 390 mobile, 420px pane, light/dark, keyboard, Escape/close/focus restoration, topic switching, exact sources, tabs and reduced motion. The 420px check emulates narrow geometry; it is not a complete multi-tool Studio session.
- No blocking console/page errors, failed HTTP responses, blocked requests or external requests in the final run. Five personal-context GETs ended in `ERR_ABORTED` during navigation; these are recorded, not counted as successful reads.
- Sample review/decision/historical controls were exercised as labeled local preview operations. On the API-backed screen, browser review PATCH responses were intercepted with synthetic test doubles and their report/topic/version payloads checked. **No review PATCH reached the server.** Exact-source inspection used real authorized GETs. Real persistence and stale/concurrency behavior were covered separately by PostgreSQL tests.
- Captured report JSON and backend/pipeline files were unchanged. No production schema, public contracts, generator, provider, prompt, retrieval, ACL, canonical storage or human decision semantics were edited.

Reproduce the headless matrix against the running server:

```powershell
node scripts/dev/vantage-topic-refinement-acceptance.mjs
```

The runner reads the local synthetic credential privately, keeps authentication in memory and prevents paid calls and product writes. It uses installed Playwright in headless mode and does not take control of the Windows desktop.

Focused test invocation, from `apps/web` with the existing isolated test database environment provided privately:

```powershell
$env:NODE_PATH = (Resolve-Path '../../node_modules/.pnpm/node_modules').Path
node node_modules/jest/bin/jest.js --config jest.config.js --runInBand --runTestsByPath __tests__/components/vantage-context-demo.test.tsx __tests__/vantage/topic-presentation.test.ts src/app/dev/vantage-action-sample/sample-model.test.ts __tests__/server/vantage-context-demo.integration.test.ts --testMatch '**/*.test.ts' '**/*.test.tsx'
node ../../node_modules/typescript/bin/tsc --noEmit
```

The integration suite requires its verified synthetic PostgreSQL variables; do not substitute a generic application `.env`. The ignored `test-output/vantage-topic-refinement/run-tests.mjs` used the existing saved isolated-runtime configuration without printing credentials.

An intermediate screenshot run triggered a hydration warning because Playwright's default caret hiding added an empty inline style to a server-rendered input before hydration. Controlled diagnostic runs isolated the instrumentation effect. The final runner waits for functional client handlers and captures with `caret: 'initial'`; no application warning suppression was added. An initial focus assertion also ran before the close transition completed; the final check waits for actual focus restoration. Earlier failed evidence remains saved.

## Local evidence

All raw screenshots and results are ignored, synthetic-only files under `test-output/vantage-topic-refinement/` in this worktree.

- Same-worktree before: `baseline/sample-weekly-1440x900.png`, `baseline/sample-drawer-overview-1440x900.png`.
- Separate old stable reference: `stable-before-v2/legacy-topics-1440x900.png`.
- Final matrix: `acceptance-2026-10-29T04-22-08-854Z/result.json`.
- Final compact list: `acceptance-2026-10-29T04-22-08-854Z/light-weekly-desktop-final.png`.
- Drawer: `acceptance-2026-10-29T04-22-08-854Z/light-drawer-desktop.png` and `legacy-sheet-desktop.png`.
- Evidence: `acceptance-2026-10-29T04-22-08-854Z/light-evidence-desktop.png` and `legacy-exact-source-desktop.png`.
- Dark mobile: `acceptance-2026-10-29T04-22-08-854Z/dark-drawer-mobile-final.png`.
- Narrow pane: `acceptance-2026-10-29T04-22-08-854Z/light-drawer-pane-420-final.png`.
- Test log/result: `focused-final.log`, `focused-final.json`.

## Scope and remaining limitations

This is a local frontend refinement on the latest action-first Joseph descendant. The sample is captured-data presentation with simulated edits that reset on reload; the API-backed route retains real service callbacks. No fresh generated report or newly persisted human approval was claimed. Unknown personnel, historical progress and unreviewed Company Architecture remain truthful. Long unfamiliar topics use conservative original-text fallbacks and may need further editorial presentation work; detailed originals are always available.

The stable and Joseph worktrees, original checkout's unrelated dirty files, report/source identities and stored human reviews remain preserved. This work does not activate V0 production generation, add Company Architecture approval, change role/star persistence or close Joseph/TL production-host dependencies. No remote push, merge or deployment was performed.
