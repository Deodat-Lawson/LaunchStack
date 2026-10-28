# Vantage action-first local sample

## Verified local baseline

The selected source is the locally available `feat/vantage-joseph-integration` checkout at `301dcfc90fbfd6af33551b0cf0b3a7a2ced68df0` (October 26). It contains the stable Vantage `7bf2f201e0c56ff60b615477b5421e668563d28a` and Sophia integration `9971ad0625c38cdb32dc28f37f15e93b29ce4371` ancestors. The user confirmed this exact Joseph branch. No fetch or pull was used.

The sample lives in a separate local worktree, `test-output/vantage-action-first-20261028/source`, on `feat/vantage-action-first-ui-local`. The original dirty `feat/weekly-agenda-contract-v1` checkout and the earlier demos are preserved. The native managed-worktree tool could not accept the nested repository as `sourceRoot`, so a normal local Git worktree was created from the verified Joseph commit. No remote branch was created.

Candidate paths below are relative to `C:/Users/junku/orca/LaunchStack`:

| Candidate                                                        | Branch / commit                                                                | Commit time (Eastern) | Starting state / disposition                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Main checkout `.`                                                | `feat/weekly-agenda-contract-v1` / `a9d3e64240551a648c36ba04bce6078e0408168e`  | Oct 17, 01:02         | Dirty; preserved. No integrated Joseph panel/flag in the inspected Vantage application paths.                       |
| `test-output/vantage-sophia-integration/20261025T201037Z/source` | `integration/vantage-sophia-v0` / `9971ad0625c38cdb32dc28f37f15e93b29ce4371`   | Oct 25, 17:08         | Clean; retrieval integration ancestor, not the latest Joseph host. Not separately started in this task.             |
| `test-output/vantage-publication-20261026/clean`                 | Detached / `a945a707c5bb1bbbf3471459627a90412318c026`                          | Oct 26, 16:15         | Clean publication snapshot; no integrated Joseph panel/flag in inspected application paths. Not separately started. |
| `test-output/vantage-frontend-mvp/20261026161746Z/source`        | `demo/vantage-integrated-mvp` / `7bf2f201e0c56ff60b615477b5421e668563d28a`     | Oct 26, 16:19         | Clean earlier stable demo; retained as an ancestor, not selected. Not separately started.                           |
| `test-output/vantage-joseph-integration-20261026/source`         | `feat/vantage-joseph-integration` / `301dcfc90fbfd6af33551b0cf0b3a7a2ced68df0` | Oct 26, 16:44         | Clean; selected and run through the isolated checkout on port 3110.                                                 |

The selected branch actually wires `PersonalContextPanel` into `ContextDemoScreen`, enables the personal-context client, and gates generation through `VANTAGE_CONTEXT_DEMO_JOSEPH_ENABLED` in `demo-service.ts` and the Joseph personal host. Fresh browser reads verified multi-role choices, optional primary role, exact-version document stars, required coverage, readable unreviewed Architecture, and preservation of the saved replay/citations while new generation is blocked. This is integrated functionality, not just a branch-name match. Current generation was deliberately not invoked. An additional `C:/Users/junku/LaunchStack-vantage-demo` candidate was inaccessible to Git inspection; it is not presented as verified.

## Figma design source

[Editable Vantage concept](https://www.figma.com/design/5wCUeJfhHCvJHouOvssidH) contains seven frames: desktop home (`2:2`), desktop detail (`2:3`), Weekly Review (`2:4`), Joseph context (`2:5`), dark home (`2:6`), mobile home (`2:7`), and mobile detail (`2:8`). Only synthetic sample content and public product design tokens/icons were sent to Figma. No credentials, cookies, or production data were uploaded.

The concept uses editable text, Lucide vectors, reusable button/tab/task-row instances, and scoped LaunchStack color/spacing variables. Structural read-back found no image-filled nodes; text uses Inter and JetBrains Mono. The source of truth for colors and type is `packages/design-tokens/tokens.css`. Figma library discovery found generic community kits but no LaunchStack Code Connect files or compatible product-token library, so the small concept component set was built from local product conventions.

Figma's Starter MCP tool-call limit was reached after the seven frames were built. High-fidelity design-to-code responses were obtained for home and detail; final screenshots were exported for six light frames into `../../../audit/figma-*.png`. The dark screenshot and further design-context calls were unavailable. This is a real tooling limit, not a completed dark-frame visual comparison. Local dark-mode checks use measured product tokens. The context illustration's Engineering primary role is an example selection; the implemented initial state must use the captured unconfirmed roles and no invented primary selection.

The Figma concept is a development reference only. The application uses local React components, existing shadcn controls, the product's tokens and installed Lucide icons. No Figma SDK, embed, remote asset URL, or runtime design-service request belongs in the sample.

## Initial audit recorded before redesign

Recorded 2026-10-28 before the redesign against isolated checkout `301dcfc90fbfd6af33551b0cf0b3a7a2ced68df0`. The preview was `http://localhost:3110/dev/vantage-context`, using the authenticated synthetic workspace and its existing saved data. This is a local browser observation, not production or live-model validation.

## Current experience

- At 1440 × 900, the heading, replay controls and explanatory text, Joseph blocker, Architecture strip, and long saved summary occupy nearly the full first viewport. Discussion topics begin at the bottom; historical questions and the separate Weekly Actions view require further navigation or scrolling. [Desktop baseline](../../../audit/baseline-desktop-1440x900.png).
- At 390 × 844, the header, week selector, replay explanation, and Joseph blocker occupy the first viewport. The Architecture strip begins at the bottom; the summary, topics, questions, and actions are below it. [Mobile baseline](../../../audit/baseline-mobile-390x844.png).
- The saved report is labelled **Recorded AI replay · no fresh model call** with original response and saved times. It has two **AI suggestion** topics. Each expands inline to observed source claims with exact-version source buttons, interpretation, a decision question, a proposed next step, uncertainty/rationale, and Keep, Dismiss, and Record decision controls. The summary repeats much of the same run-17 reconciliation narrative; the first suggestion and the prior question also concern closely related privacy review evidence, but are different records. A review choice explicitly does not create a Weekly Action.
- The prior question is a separate human review queue, labelled **Historical · current status unverified**, with origin week, Dismiss and Confirm addressed. The screen says its review does not change an existing commitment. Do not merge it into a current action or infer completion. [Historical question](../../../audit/pending-questions-desktop.png).
- Weekly Actions has Open, Resolved and All filters, and the synthetic response contains no actions; both Open and All show “No actions in this view.” The Add an action dialog asks for action, owner, due date and a test, and its Add button is disabled while required fields are blank. No action was created. [Actions](../../../audit/weekly-actions-desktop.png).
- Evidence shows three private notes, kind filters, search, Add evidence and per-row action controls. The suggestion immediately above these rows says “Nothing is logged yet” and calls a conversation/link the draft's first source, which is confusing alongside the visible three notes. No evidence was edited. [Evidence](../../../audit/evidence-desktop.png).

## Context and evidence controls

- The Joseph disclosure opens a large nested panel before the report. Current suggested Founder and Engineering responsibilities are checked but explicitly await user confirmation; the six listed documents are currently unstarred. Choices are process-memory demo state, apply to future context preparation, and do not change permissions or retroactively change the saved report. No role or star was changed. [Joseph expanded](../../../audit/joseph-expanded-desktop.png).
- Required coverage reports shared Company Architecture **Not included** because the canonical profile is **unreviewed**; required context is incomplete and replay/generation is disabled. The separate Architecture strip says the current authorized context is available to inspect, also **unreviewed**. These describe different states: a readable source is not a complete, accepted generation bundle. Earlier report and citations remain available.
- Saved report details show historical synthetic-resolver roles `engineering, founder`, one personal star, six selected references, partial manifest, and stopped research. These belong to the saved replay and are not the current unconfirmed selections or proof of a new prepared bundle.
- Inspect Company Architecture opens a source dialog with its exact version, unreviewed status, profile fields, explicit unknowns and provenance. Individual report citations open dialogs with exact source version, excerpt, provenance and the warning that a source reference does not itself verify the report's interpretation. These dialogs are good candidates for a compact detail panel while keeping exact sources reachable. [Architecture dialog](../../../audit/architecture-dialog-desktop.png), [report citation](../../../audit/report-source-desktop.png).
- The same unreviewed Architecture appears in the blocker, coverage, source strip, saved summary, and source dialog. Keep the meaningful distinctions and provenance, but reduce repeated prose in the primary review surface. Long topic facts, rationale, exact versions and context diagnostics can live behind explicit detail controls; decision question, current state and source access should remain easy to find.

## Boundaries and evidence

The named isolated headless Playwright session used a local-origin allowlist and an explicit guard for local GET/HEAD plus only synthetic email sign-in. No replay, model generation, review submission, source ACL change, action creation, role save, star mutation, seed, or reset was performed. Browser screenshots were inspected; the full-page screenshot option only captured the fixed viewport because the app scrolls within a container. Responsive conclusions above concern the two tested viewport sizes. Exact GET capture and additional route/color checks are held in the adjacent ignored `audit` artifacts; they are synthetic runtime evidence, not production validation.

## Implementation scope and hierarchy

The new development route is `/dev/vantage-action-sample`. It uses the existing `ToolNavProvider`, `ToolFrame`, pane-scoped shadcn `Sheet`, `Tabs`, `Button`, `Input`, `Select`, and `Checkbox`. Navigation is limited to Your week, Weekly review, and Your context; there is no new application sidebar. Semantic tokens supply the purple accent, deep-navy dark surfaces, ink contrast ladder, spacing and radii. Inter remains the product typeface; JetBrains Mono is reserved for provenance/IDs.

| Before                                                              | After                                                                                 | Why                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Long summary and repeated context notices precede review work       | A heading, compact blocker and searchable review queue lead the page                  | The user can find the next review item immediately.                              |
| Lengthy topic titles and inline report sections                     | Short presentation aliases, with original titles and full text in the drawer          | Scanning improves without changing stored meaning.                               |
| Decisions, old questions and accepted actions spread across screens | Separate item types, real counts, status labels and empty action state                | A proposal or historical question is not an assigned commitment.                 |
| Exact citations repeated throughout long cards                      | Evidence tab with source disclosures, exact version/hash/provenance and original body | Detail remains inspectable without dominating the queue.                         |
| Joseph controls interrupt the main report                           | Dedicated context view and context tab                                                | Multi-role, primary-role, document stars and required coverage remain reachable. |

The sample captures the selected week from fresh authenticated local GET responses: two proposals, one historical question, zero commitments, six exact source bodies. It preserves full report fields and does not manufacture exact versions for historical references. New review events, decision notes, role selections and stars are local React state only; Reset or reload restores the captured state. Kept/reviewed/dismissed/addressed states are labelled as preview changes and never create commitments, evidence of completion or company approval.

The server route remains development-only and uses native workspace authentication, the existing Vantage access guard, and the captured synthetic actor/company binding. Captured source bodies are immutable sample evidence: current document ACLs and version changes are **not** revalidated by this preview. It must not be adopted as a live source-delivery implementation without returning to the existing authorized source APIs. The original demo's authorization, generation and storage paths are unchanged.

## Running the local sample

From PowerShell:

```powershell
Set-Location 'C:\Users\junku\orca\LaunchStack\test-output\vantage-action-first-20261028\source'
node scripts/dev/vantage-action-runtime.mjs --check
node scripts/dev/vantage-action-runtime.mjs --serve
```

Open `http://localhost:3110/dev/vantage-action-sample`. The original Joseph screen remains at `http://localhost:3110/dev/vantage-context`. Native sign-in uses the existing synthetic account; its `loginEmail` and `loginPassword` are in ignored `test-output/vantage-context-demo/runtime/credentials.json`. Do not copy that file into Git or Figma.

The helper reuses the existing owned synthetic PostgreSQL instance on `127.0.0.1:55438`, checks its database identity, clears live-provider credentials through the existing child-environment builder, and runs Next.js locally. It does not migrate, seed, reset or start generation workers. The existing Docker Desktop installation was started; it restored PostgreSQL and its existing Docling container. No container image was pulled. The first compile attempted Google font retrieval and was stopped; the final running process uses cached local Inter/JetBrains files with the offline font response helper.

`--prepare` can recreate missing local dependency junctions and copy the existing synthetic runtime descriptors from the selected baseline. No package install is needed on this laptop. This helper intentionally depends on the existing baseline's installed packages/font cache and local synthetic DB; it is not a clean-machine provisioning script. Figma is not involved in startup or runtime.

## Visual refinement evidence

The first local home views (`../../../audit/first-render-light-1440.png` and `first-render-dark-1440.png`) were compared with the exported Figma concept. The refinement pass restored the source-specific unreviewed-context cue, added a compact row description and any known action owner/date, aligned decision-note state with the remaining-review count, and added explicit captured-source provenance. The native ToolFrame navigation, content-right primary action, complete source text and actual initial role selection take precedence over illustrative Figma simplifications.

Font verification found a real first-render defect: `document.fonts.status` was loaded while Chromium rendered the `Inter Fallback` face backed by Arial. The task's stale build cache was preserved and regenerated after removing fallback faces from the offline font mock. Browser CSS and Chromium `CSS.getPlatformFontsForNode` then confirmed that the actual custom Inter face rendered the heading, row title and metadata glyphs. The original font source and baseline cache were not modified. See `../../../audit/computed-fonts-rebuilt.json` and `actual-glyph-fonts.json`. Final screenshots must use this rebuilt runtime; the earlier images remain evidence of the refinement, not final fidelity.

Keyboard testing found a second actual defect after local review actions: disabling/removing the focused control moved focus to the document body, so the shared Sheet correctly ignored Escape outside its pane. The sample now retains focusable completed controls, treats repeated same-status choices as no-ops, and restores focus to a stable control when a form closes. Fresh browser checks confirmed Keep, Dismiss, decision save and historical confirmation all retain focus inside the drawer; Escape closes it and returns to the opener. The shared Sheet's neighboring-pane rule was preserved.

Tooling also attempted to resolve pnpm through its installed version shim and encountered a registry failure. Those wrapper sessions were cancelled; checks use the already installed Node CLI entry points instead. No dependency was installed. This is distinct from the successful direct-CLI checks reported below.

## Review decisions before adoption

Keep the three record types distinct when wiring this design to live storage. Decide whether review completion should merely clear the review queue or create an explicitly confirmed action through the existing commitment flow. Confirm the presentation aliases and compact evidence hierarchy, then connect roles/stars to the existing revision-checked personal-context client. Preserve server-side ACL/version checks when replacing the captured-source adapter. A production adoption should include live-data loading/error/stale-state coverage; this exploratory sample intentionally validates the captured synthetic scope.

## Executed validation and artifacts

- Six deterministic sample-adapter tests passed. They cover separate record types, exact-version deduplication, preserved unversioned historical references, real commitment fields, no inferred owner/date/commitment, and unchanged captured data.
- Forty-two existing Vantage component tests passed across `vantage-context-demo.test.tsx`, `vantage-personal-context.test.tsx` and `vantage-pending-questions.test.tsx`. These use synthetic API doubles, not live model/database evaluation. Machine-readable results: `test-output/vantage-action-component-tests.json`.
- Full web TypeScript check passed: `node ../../node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false` from `apps/web`.
- Scoped ESLint passed for the new TypeScript files; the existing dependency layout requires `NODE_PATH` to point to the source root's `node_modules/.pnpm/node_modules`. Direct installed CLI entry points avoid package-manager downloads. Formatting and script syntax checks passed.
- The full headless acceptance run before the last Weekly Review refinement passed **17/17 checks**, with **17 screenshots**, at `test-output/vantage-action-acceptance/2026-10-28T05-24-45-389Z/result.json`. It includes the final capture-authority wording and covers initial counts, original demo preservation, search/type filters/empty states, source identity/body/original title, drawer tabs, review and decision actions, idempotence, historical-question confirmation, roles/primary/stars, saved/current context separation, keyboard/Escape/focus return, reduced motion, actual custom Inter glyphs, and responsive layouts.
- Responsive home checks ran at 1440×900, 1280×800, 768×900 and 390×844 in both themes, plus a 420px ToolFrame host at a 1440px viewport. The last case is an emulated narrow pane using the real container-based frame and sheet; a complete live Studio multi-pane session was not exercised.
- The final run recorded zero blocked external/non-read requests, zero failed HTTP responses, zero console errors and zero page errors. One local `/api/auth/get-session` GET was canceled during navigation (`net::ERR_ABORTED`) and is retained in the result. Native synthetic sign-in is the allowed authentication POST; no product mutation request was submitted.
- Earlier runs exposed selector/timing assumptions in the runner and the actual font/focus defects described above. They are retained as failed/partial evidence, not counted as passes. The capture-authority wording was included in the passing full run; it avoids implying current access validation.

The subsequent Weekly Review refinement replaces the long visible summary with a clearly labelled, faithful two-sentence presentation brief. The native **Read full saved summary** disclosure immediately below retains the complete original. Targeted desktop/mobile validation passed at `../../../audit/weekly-targeted-2026-10-28T05-30-18-395Z/result.json`: the 714-character expanded summary matches the capture exactly, the historical question remains separate, actual Inter renders, and the 390px page has no horizontal overflow. The first targeted mobile screenshot exposed topic-text overlap from the inherited fixed button height; setting the rows to grow with their content fixed it. The final row geometry confirms title, decision text and metadata stay within both rows. No blocked requests or console/page errors were recorded; two local GETs were canceled during navigation. This final targeted check is separate from the earlier 17/17 full matrix.

Final Weekly Review captures: [desktop](../../../audit/weekly-targeted-2026-10-28T05-30-18-395Z/weekly-desktop.png), [full saved summary](../../../audit/weekly-targeted-2026-10-28T05-30-18-395Z/weekly-desktop-expanded.png), [mobile brief](../../../audit/weekly-targeted-2026-10-28T05-30-18-395Z/weekly-mobile.png), and [mobile topics and carried question](../../../audit/weekly-targeted-2026-10-28T05-30-18-395Z/weekly-mobile-carried-forward.png). The earlier full-run Weekly screenshot predates this final refinement.

The full-run screenshot set includes `light-desktop-1440.png`, `dark-desktop-1440.png`, both 1280/tablet/mobile/pane variants, `light-drawer-desktop.png`, `light-drawer-mobile.png`, `light-weekly-desktop.png`, `light-context-desktop.png`, and Evidence/History captures. Baseline and Figma exports are in the adjacent `../../../audit/` folder. These local evidence files are ignored and are not embedded into the application or committed as runtime assets.

To reproduce the browser run while the local server is running:

```powershell
node scripts/dev/vantage-action-acceptance.mjs
```

The runner launches headless Chromium from the existing Playwright installation, privately reads the synthetic credentials, and writes a timestamped result/screenshots under `test-output/vantage-action-acceptance/`. It blocks external browser origins and product writes. A production build, live AI/retrieval evaluation, real ACL churn, clean-machine provisioning and deployment were not run. The application sample requires no Figma connection.
