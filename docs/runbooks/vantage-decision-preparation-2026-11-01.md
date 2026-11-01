# Vantage decision preparation ? local frontend refinement

Local branch: `feat/vantage-decision-preparation-20261101`.

## Version and isolation

The existing action-first checkout at `C:/Users/junku/orca/LaunchStack/test-output/vantage-action-first-20261028/source` was clean at `b7da3ce7f57c678d15384a78b4fa24b9ec36512d`, branch `feat/vantage-action-first-ui-local`. It is the newer Joseph-integrated UI baseline. The stable checkout is `demo/vantage-integrated-mvp` at `7bf2f201e0c56ff60b615477b5421e668563d28a`, serving port 3104.

All changes are in a new managed worktree: `C:/Users/junku/.codex/worktrees/514f/LaunchStack`. The integrated commit was imported locally for managed worktree creation; no remote was fetched or changed. Existing dirty files and both original checkouts were preserved. The three user screenshot attachments were not available in this session; a real browser before-reference was captured from the stable running application.

## Running frontend

Open <http://localhost:3111/dev/vantage-context>. This is the API-backed contextual review with its existing native Weekly Review navigation. The captured local-state sample is separately available at <http://localhost:3111/dev/vantage-action-sample?at=/review>.

```powershell
Set-Location 'C:\Users\junku\.codex\worktrees\514f\LaunchStack'
node scripts/dev/vantage-decision-runtime.mjs --check
node scripts/dev/vantage-decision-runtime.mjs --serve
```

The server reuses the owned existing `launchstack-vantage-week2-tl-20261022-portable-db` container and `launchstack-vantage-week2-tl-20261022-portable-data` volume, loopback PostgreSQL port 55438, database `vantage_week2_tl_contract_v1`. Only this previously stopped container was started. The stable checkout and its database on 55437 were not reconfigured. At the final check its original process was no longer running; the cause was not established. Its existing replay-only launcher was started again without setup or seeding. See the final port verification. No migrations, seed, reset, provider or worker was run.

The local launcher reuses installed dependency junctions and the prior synthetic fixture/auth files. It uses cached fonts, refuses generic dotenv files and runs replay mode without a model provider. It is a local-worktree launcher, not a newly verified clean-clone bootstrap. Private credentials are in ignored `test-output/vantage-context-demo/runtime/credentials.json`; keep them out of logs and screenshots.

## Presentation changes

| Before                                                                                                                | After                                                                                             | Why                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Context rows included issue descriptions; native topics expanded facts, interpretation, questions and controls inline | Title, truthful suggestion/review status and chevron                                              | Users can scan recommendations before investigating               |
| Full narrative and technical replay metadata competed with the topic list                                             | Concise topic-count insight, expandable full summary and secondary report details                 | Keep the main surface focused without rewriting the saved summary |
| Company Architecture and role setup occupied large cards                                                              | Small disclosure entries retaining unreviewed status and exact-source inspection                  | Preserve context access without making it the main report         |
| Native topics used inline or nested detail content                                                                    | V1-specific responsive Sheet, retaining original callbacks and citations                          | Keep native and contextual report semantics separate              |
| Sources and rationale were visible alongside every recommendation                                                     | Issue/reason/question/step inside details; expandable evidence, unknowns, conflicts and rationale | Investigation is available on demand                              |

The shared contextual rows no longer render their issue text at all. No topic is removed by a new admission rule. The existing dismissed-topic disclosure and native status filter retain their original behavior. Original titles and complete report wording remain in details. Native Rules topics retain Rules labels, AI suggestions retain AI labels, and human decisions/actual linked commitments retain their existing distinct presentation.

Detail sheets reuse the existing pane-scoped shadcn Sheet. At mobile widths they occupy the available viewport. Keep, Dismiss, Edit and Record Decision retain their existing IDs, version arguments, loading/stale locks and error behavior. Keep is not mapped to action creation. Native `VantageEvidenceRef` and V0 `{kind,id,version}` remain separate types and source-opening paths.

Screenshot review prompted an additional improvement pass: separate source-reported Issue from AI interpretation, compress closed role/setup copy, remove the native summary's truncated inline source narrative and simplify its filled decision box. No Generator contract, model policy, retrieval, backend validation, source identity, ACL or persistence code was changed.

## Files changed

- `apps/web/src/app/employer/tools/vantage/_screens/ContextDemoScreen.tsx`
- `apps/web/src/app/employer/tools/vantage/_screens/AgendaScreen.tsx`
- `apps/web/src/app/employer/tools/vantage/_components/CompactTopicRow.tsx`
- `apps/web/src/app/employer/tools/vantage/_components/TopicDetailSheet.tsx`
- `apps/web/src/app/employer/tools/vantage/_components/NativeTopicDetailSheet.tsx` (new)
- `apps/web/src/app/employer/tools/vantage/_components/compact-topic.module.css`
- `apps/web/src/app/dev/vantage-action-sample/ActionWorkspace.tsx`
- `apps/web/__tests__/components/vantage-context-demo.test.tsx`
- `apps/web/__tests__/components/vantage-native-detail.test.tsx` (new)
- `scripts/dev/vantage-decision-runtime.mjs` (new)
- `scripts/dev/vantage-decision-acceptance.mjs` (new)
- `apps/web/next.config.ts`: hides the Next development indicator only for the explicitly enabled development demo on port 3111; other modes keep the existing defaults.
- This runbook.

## Focused verification

The combined suite passed **83 tests across seven suites**, including 27 contextual UI tests and seven new native detail tests. It covers exact source opening, drawer content, native decisions/editor handoff, Keep/Dismiss version payloads and locks, refresh-failure recovery, enhancement freshness, historical question controls, routing and immutable presentation adapters. The 27 contextual and seven native tests were rerun after the screenshot-driven changes and passed.

Full web TypeScript and scoped ESLint passed. Logs are ignored under `test-output/decision-tests.log`, `decision-polish-tests.log`, `decision-native-final.log`, `decision-typecheck-final.log` and `decision-lint.log`.

```powershell
Set-Location 'C:\Users\junku\.codex\worktrees\514f\LaunchStack\apps\web'
$env:NODE_PATH = (Resolve-Path '../../node_modules/.pnpm/node_modules').Path
node node_modules/jest/bin/jest.js --config jest.config.js --runInBand --runTestsByPath __tests__/components/vantage-context-demo.test.tsx __tests__/components/vantage-native-detail.test.tsx __tests__/components/vantage-agenda-row.test.tsx __tests__/components/vantage-pending-questions.test.tsx __tests__/vantage/vantage-tool.test.ts __tests__/vantage/topic-presentation.test.ts src/app/dev/vantage-action-sample/sample-model.test.ts --testMatch '**/*.test.ts' '**/*.test.tsx'
node ../../node_modules/typescript/bin/tsc --noEmit
```

No PostgreSQL mutation suite was needed for these frontend-only changes. Browser verification uses actual saved contextual/Rules reports and real authorized GETs, while review/decision writes use intercepted synthetic responses. That verifies frontend handoff and payloads without changing existing saved human reviews; it does not claim newly persisted decisions or database end-to-end writes.

## Browser artifacts and remaining scope

Before/after screenshots and machine-readable browser results are in ignored `test-output/vantage-decision-preparation/before/` and `after/`. Before captures use the stable application (different commit/database), rather than claiming a same-version before/after comparison.

Run headless acceptance from the worktree root with `node scripts/dev/vantage-decision-acceptance.mjs --after`. The runner keeps synthetic auth in memory, blocks Generation/product writes and external requests, and never uses the foreground desktop. Check the runner's final output/result for the exact executed check count.

Company Architecture remains unreviewed; Joseph's required-context gate still blocks fresh generation. Existing captured output remains independently readable. No fresh model behavior, production activation, new durable role/star persistence or generation-quality improvement is claimed. The prototype/sample still labels its local interactions as resetting on reload. Both contextual and native reports remain separate saved reports, and their original citations and data have not been rewritten.

## Mobile layout correction

The final visual pass found that `height: 100dvh` ignored the local workspace banner. At a 390x844 viewport, the contextual sheet ended at y=897 and its 65px footer ended below the viewport. The sheet now uses 100% of its containing Studio pane with non-shrinking header/footer. A fresh bounding-box check passes: sheet y=53..844, footer y=779..844. This keeps all review buttons visible while preserving pane scoping. No shared Sheet primitive was changed.

Evidence: `test-output/vantage-decision-preparation/mobile-geometry/result.json` and `mobile-context-footer-geometry.png`.

The desktop/mobile light/dark browser matrix passed 23/23 checks before a final development-overlay adjustment. The actual saved native Rules report had no linked action; real linked-action navigation was therefore absent, while its positive path is covered by a component fixture. A simulated source 409 verified contextual withholding. Six review/decision writes used intercepted fixtures, and actual source reads returned 200. No Generation POST or external/unintercepted product write was sent.

A subsequent mobile pointer check covers a Next development indicator that overlapped Keep. The indicator is disabled only for the explicit development preview on port 3111; this is not an application warning suppression or production configuration change. See the final browser result for the post-adjustment check count.

## Final browser evidence

- Full headless matrix: **23/23 passed**, 24 screenshots, actual saved contextual and Rules report reads, zero blocked requests/errors. Result: `test-output/vantage-decision-preparation/after/result.json`.
- After the preview-only indicator change: **5/5 targeted checks passed**, including unobstructed ordinary mobile Keep clicks in light/dark using intercepted fixture responses. Result: `test-output/vantage-decision-preparation/mobile-pointer/result.json`. This supplements the full matrix; a second full matrix was not run after the config-only change.
- Final mobile screenshots without the developer overlay: `mobile-pointer/context-mobile-light-pointer-sheet.png` and `context-mobile-dark-pointer-sheet.png`.
- Before: `before/before-context-list-desktop.png`.
- After contextual list/drawer: `after/after-context-list-desktop.png`, `after-context-sheet-desktop.png`.
- After native Rules list/drawer/source: `after/after-native-list-desktop.png`, `after-native-sheet-desktop.png`, `after-native-source-desktop.png`.
- Exact contextual source and company profile: `after/after-context-source-desktop.png`, `after-architecture-desktop.png`.

Reproduce the targeted mobile pointer check with `node scripts/dev/vantage-decision-acceptance.mjs --mobile-pointer`. Browser test writes remain fixtures, not newly persisted decisions. No linked action exists in the actual saved Rules report; positive linked-action behavior is covered by a component fixture only.

Final port verification: both 3104 and 3111 returned HTTP 200. Stable tracked HEAD remains `7bf2f201e0c56ff60b615477b5421e668563d28a` with a clean working tree. The original unexpected process exit was not attributed to a verified cause.
