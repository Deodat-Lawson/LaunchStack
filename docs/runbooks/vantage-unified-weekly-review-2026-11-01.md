# Unified Weekly Review - local implementation handoff

## Baseline and scope

Continuing the existing isolated worktree `C:/Users/junku/.codex/worktrees/514f/LaunchStack`, branch `feat/vantage-decision-preparation-20261101`, initially clean at `5463407f87c092ca660b0248e3a2ba9e558c233e`. No reset or checkout replacement was performed. The stable 3104 checkout and original action-first checkout were preserved.

All four user references were read: desktop Weekly Review, mobile Weekly Review, Decision drawer and My context sheet. The reference's unsupported implications were not copied: this UI does not claim the samples are identical, privacy rejected approval, the profile was reviewed, or a model extracted the fixture-built company facts.

## Open the functional frontend

URL: <http://localhost:3111/dev/vantage-context/review>. The old <http://localhost:3111/dev/vantage-context> and `/context-demo` aliases remain valid.

```powershell
Set-Location 'C:\Users\junku\.codex\worktrees\514f\LaunchStack'
node scripts/dev/vantage-decision-runtime.mjs --check
node scripts/dev/vantage-decision-runtime.mjs --serve
```

The existing server is left running. The launcher uses its saved isolated PostgreSQL database on 55438 and existing auth/fixture files. It runs in replay mode. No seed, migration, reset, new database, connector or Generation call is needed. Credentials remain in ignored `test-output/vantage-context-demo/runtime/credentials.json`; never paste that file into a shared report. The stable port 3104 uses its own unchanged checkout/database.

## Unified experience

One primary Weekly Review entry sits beside Actions, Evidence and Metrics. Mobile has a pane-scoped bottom navigation with safe-area spacing. A currently authorized context-aware saved report is the primary view. The alternative saved report remains an explicit secondary screen via `?report=rules` and retains its own records, topics, decisions and source types. It is not merged into the primary list. Legacy `/agenda?week=...` and `/context-demo?week=...` paths enter the unified view; return links preserve the week. If content is missing or withheld, the alternative is offered explicitly rather than silently hiding an access/freshness failure behind another report.

The primary list defaults to All and exposes To review, Decided and Dismissed filters. No Topic Admission Gate, suppression or semantic merge was added. Rows show their actual question, deduplicated exact source count, unknown count and only supported differences/unreviewed/decision states. Source count is provenance, not a semantic support score. Existing original title/text remains inspectable.

Decision drawers put the question before exact factual statements and sources, unknowns, suggested steps and expandable reasoning. Go, No-go and Needs more evidence prefill the existing confirmation form. Nothing is saved until Save decision; Keep/Dismiss remain secondary CAS-backed review operations. None creates an action or closes a historical question. Drawers retain source-overlay stacking, Escape and focus restoration, full-pane mobile geometry and unobstructed footers.

My context reuses the actual role/primary/star client and its independent save/reload/revision guards. It labels supplied facts and unreviewed company context truthfully and offers Inspect profile only. Role/star changes affect future preparation; the saved report retains its original context. The existing required-context checks remain intact; no new profile-review gate was introduced. Save roles and immediate star controls remain separate supported actions; no fake global Save or profile-review workflow was invented. Detailed local storage and source diagnostics live in secondary details.

Historical questions retain exact original IDs and their independent review/version state. Their compact section says progress is unverified, rather than asserting they are active unresolved business issues.

## Conservative substantive brief

`weekly-brief.ts` is presentation only and does not match company names, topic IDs or the Synthetic Orbit example. It prefers the whole compact saved summary. Otherwise it chooses up to two complete, bounded statements with exact refs present in the supplied report catalog. A conflict is not treated as covered by sharing IDs: its complete wording must be retained, or the full compact conflict is used. If no safe concise statement fits, a complete saved decision question is shown as a question. No sentence is clipped to lose a trailing negation or qualification.

For a factual preview, one independent short source statement may be shown under Also recorded, with its exact ref and any unreviewed-source label. This naturally retains the sample's complete human-review statement that the supplied document contains no approval record. It never becomes proof of rejection or absence elsewhere. Full original summary, facts and unknowns remain available under Read full brief. No numeric figures/dots are invented from free text; generic reports can omit them.

This is extractive presentation, not semantic entailment verification or a new ranking algorithm. It uses the saved topic ordering; unsupported or long content can yield a restrained question fallback. A future structured contract is documented separately in `docs/design/vantage-weekly-brief-contract-followup.md` and is not active.

## Files changed

- `apps/web/src/app/employer/tools/vantage/VantageTool.tsx`
- `apps/web/src/app/employer/tools/vantage/_screens/ContextDemoScreen.tsx`
- `apps/web/src/app/employer/tools/vantage/_screens/unified-review.module.css` (new)
- `apps/web/src/app/employer/tools/vantage/_components/CompactTopicRow.tsx`
- `apps/web/src/app/employer/tools/vantage/_components/TopicDetailSheet.tsx`
- `apps/web/src/app/employer/tools/vantage/_components/compact-topic.module.css`
- `apps/web/src/app/employer/tools/vantage/_components/MyContextSheet.tsx` (new)
- `apps/web/src/app/employer/tools/vantage/_components/my-context.module.css` (new)
- `apps/web/src/app/employer/tools/vantage/_components/WeeklyBrief.tsx` (new)
- `apps/web/src/app/employer/tools/vantage/_components/weekly-brief.module.css` (new)
- `apps/web/src/app/employer/tools/vantage/_lib/weekly-brief.ts` (new)
- `apps/web/src/app/employer/tools/vantage/_components/PendingQuestions.tsx`
- `apps/web/src/components/vantage-context/PersonalContextPanel.tsx` (copy/presentation only)
- `apps/web/src/app/dev/vantage-context/VantageContextPreview.tsx`
- `apps/web/__tests__/components/vantage-context-demo.test.tsx`
- `apps/web/__tests__/components/vantage-personal-context.test.tsx`
- `apps/web/__tests__/components/vantage-unified-navigation.test.tsx` (new)
- `apps/web/__tests__/vantage/weekly-brief.test.ts` (new)
- `scripts/dev/vantage-unified-acceptance.mjs` (new)
- `apps/web/src/app/employer/tools/vantage/_lib/use-sheet-focus-recovery.ts` (new)
- `apps/web/src/app/employer/tools/vantage/_components/NativeTopicDetailSheet.tsx` (focus recovery only)
- `apps/web/__tests__/components/vantage-focus-recovery.test.tsx` (new)
- This runbook and the separate future-contract proposal.

No backend, Generation contract/policy, persistence schema, source validation, quality-experiment record or default V0 provider was changed.

## Verification

Focused unit/component regression: **112/112 tests passed across eight suites**. Coverage includes legacy URLs/alternative-report separation, exact refs, source revocation and stale save withholding, role/star revisions and request locks, all decision outcomes requiring confirmation, kept/dismissed semantics, historical queue independence, concise extraction with late qualifiers and immutable stored text. These tests do not call Generation or mutate demo reports.

```powershell
Set-Location 'C:\Users\junku\.codex\worktrees\514f\LaunchStack\apps\web'
$env:NODE_PATH = (Resolve-Path '../../node_modules/.pnpm/node_modules').Path
node node_modules/jest/bin/jest.js --config jest.config.js --runInBand --runTestsByPath __tests__/components/vantage-context-demo.test.tsx __tests__/components/vantage-personal-context.test.tsx __tests__/components/vantage-pending-questions.test.tsx __tests__/components/vantage-unified-navigation.test.tsx __tests__/vantage/weekly-brief.test.ts __tests__/components/vantage-native-detail.test.tsx __tests__/vantage/vantage-tool.test.ts __tests__/components/vantage-focus-recovery.test.tsx --testMatch '**/*.test.ts' '**/*.test.tsx'
node ../../node_modules/typescript/bin/tsc --noEmit
```

Logs are ignored under `test-output/unified-tests-final.log`, `unified-typecheck-final.log` and `unified-lint-final.log`. Initial failures were isolated test-environment/copy expectations and integration type options; they were corrected without removing access or revision assertions. A real dark-theme contrast error was corrected to use canonical panel tokens, and the brief was refined to retain the approval-record qualifier.

Browser acceptance uses headless Playwright, real synthetic auth and real GETs of saved reports, exact source content, 13 unreviewed company facts and the independent historical queue. Write actions are intercepted fixture responses so original records remain unchanged; no newly persisted review/role/star/action state is claimed. Generation/product writes and external calls are blocked. The 3104 server is never used or restarted by this runner.

```powershell
Set-Location 'C:\Users\junku\.codex\worktrees\514f\LaunchStack'
node scripts/dev/vantage-unified-acceptance.mjs
```

Before/after screenshots and machine-readable results are in ignored `test-output/vantage-unified-review/before/` and `after/`. Final screenshot/result filenames and executed browser totals are recorded in `after/result.json`. The original before captures are this same 3111 worktree before edits, rather than a different demo branch.

## UI review

| Before                                                | After                                                                   | Why                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Separate Context-Aware Demo and Weekly Review entries | One Weekly Review, explicit alternative saved report                    | One product experience without merging backend records                 |
| Topic-count insight                                   | Complete extractive brief plus independently cited supplementary record | Explain the issue while retaining uncertainty                          |
| Inline role/setup/profile sections                    | My context sheet with real save/reload controls                         | Keep settings out of the reading flow                                  |
| Title/status-only rows                                | Question and differentiating source/unknown metadata                    | Show what decision is being prepared                                   |
| Secondary Record decision button                      | Three supported outcomes with explicit confirmation                     | Make human judgment visible without creating commitments               |
| Technical demo banner                                 | Short secondary replay footer and expandable report diagnostics         | Preserve truthful disclosure without implementation-heavy primary copy |

## Limitations

The Company Architecture remains unreviewed and the existing Required Context gate can block fresh generation. No profile approval workflow, production role/star persistence, new source retrieval or Generation integration was activated. Settings retain the existing demo server lifetime. Source refs demonstrate provenance, not semantic entailment. The brief may use a longer original topic title or question because no reviewed short-headline contract exists. Numeric highlights are omitted without reliable structured input. Human-state persistence is unchanged and browser writes are simulated for preservation; production database writes were not retested for this frontend-only change. No paid models, push, PR, merge or deployment occurred.

## Post-save keyboard correction

Browser testing reproduced focus falling to the document body after review/decision/context saves. The existing Studio Sheet correctly ignores Escape outside its pane, so this left an open drawer that could not be closed by Escape. A local focus-recovery hook now observes only its drawer and restores the header when a save removes/disables the focused control and focus is otherwise lost. It never takes focus from another pane or an open nested confirmation/source dialog. No shared Sheet, auth or backend behavior was changed. Unit tests cover recovery, other-pane preservation, closed drawers and nested modals; browser checks exercise each supported save outcome.

A focused browser follow-up found the context portal header could mount after the open effect. The late-attachment case was reproduced as a failing unit test, fixed with temporary portal attachment observation, and rerun successfully. Recovery still refuses to take focus from another pane or an open nested modal.

## Final browser results

The complete final headless run passed **25/25 checks** with **14 real screenshots**, zero unexpected errors/blocked requests and no Generation POST. It covers unified navigation and legacy deep links, explicit separate Rules-report selection, substantive brief/full expansion, exact document/company reads, desktop/mobile light/dark decision and context drawers, unobscured controls, nested-source focus, all decision outcomes and post-save Escape, role/primary/star revision payloads, source-409 withholding and independent historical reviews.

Writes were fixture responders, not server mutations. Fresh live readback retained report version 1, personal revision 0 and pending-question version 3. Browser validation is the authenticated synthetic development preview only; it does not validate a live customer workspace, provider or production write path.

Screenshots in `test-output/vantage-unified-review/after/`:

- `desktop-dark-review.png`, `desktop-light-review.png`
- `desktop-dark-decision.png`, `desktop-light-decision.png`
- `desktop-dark-context.png`, `desktop-light-context.png`
- `mobile-dark-review.png`, `mobile-light-review.png`
- `mobile-dark-decision.png`, `mobile-light-decision.png`
- `mobile-dark-context.png`, `mobile-light-context.png`
- `desktop-document-source.png`, `desktop-company-source.png`

The acceptance runner's final 25-check execution preceded formatting-only changes to the runner; syntax and formatting were checked afterward without claiming another browser execution. Initial diagnostic failures and the fixed keyboard issues remain documented under the ignored diagnostic folders.
