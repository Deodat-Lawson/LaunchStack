# Realistic local Vantage samples and Context separation

Date: 2026-11-16. Base: `d287c594af823e5bccd821f8b216b61c9c97d16c`. Branch: `codex/vantage-realistic-sample-docs-20261116`. This work adds fictional sample documents, checks the current report path, and separates setup from weekly decisions. It does not change retrieval policy, increase budgets, merge, or deploy.

## Sample documents and import

The [Harborlight Atlas corpus](../samples/vantage/harborlight-release/README.md) contains 12 logical documents and 13 Markdown versions, totaling 15,749 UTF-8 source bytes. All organizations, people, customers, tickets and measurements are fictional. Codex authored these fictional documents for this task; no customer material or web source was copied.

The set includes a superseded release proposal and its current replacement, focused QA retests with an unresolved defect, limited security permission, a rollback runbook with no accountable decision owner, customer/support notes, an inconsistent metric denominator, finance definitions, ordinary infrastructure work, a recruitment distractor, a decision log and open actions. All versions predate the fixed `2026-11-16T00:00:00Z` corpus cutoff. The release-plan versions retain distinct identities and dates.

`manifest.json` lists the only files ingested. `expectations.json` contains six authored human review cases and exact quote anchors; it is excluded from document ingestion and model input. These are calibration examples, not independent Gold or held-out quality evidence.

The dev-only importer defaults to an offline validation/hash report. Applying it requires the existing loopback acceptance database, the exact named sample workspace, an explicit company ID and the existing test account's active owner membership. It inserts database-backed preview files, exact versions and plain-text chunks atomically. It neither migrates nor invokes OCR, embeddings or document ingestion workers. An advisory lock and full stored-byte verification make a repeated import reuse the existing records; drift and partial/foreign content fail closed.

The dedicated `Harborlight Analytics (fictional sample)` workspace was created through the normal authenticated workspace API. The actual local import created 12 documents, 13 versions, 13 preview files and 13 chunks. Re-import returned the same references without duplicates. Hash inventories confirmed that the original workspace's 54 documents, versions, chunks, files, review runs and configuration were unchanged.

All 13 preview URLs returned authenticated HTTP 200 and matched their source-file SHA-256 values. The QA document was visually readable in the real source viewer, survived reload and displayed its ready state; there were zero Syncing rows.

## Context and This week

The Vantage navigation now uses **Context** at `/context`. `/agenda` remains a compatibility alias to that view. The view contains:

- My business responsibilities and explicit role confirmation.
- Required company context and its existing administrator permissions.
- Personal starred documents and their preference CAS.
- Exact source-scope inspection and configuration.

**This week** contains the week selector, Generate/history controls, generated evidence-backed review topics and human decision editors. It does not duplicate the configuration forms. Context does not fetch or display a selected historical report and does not expose Generate or the decision editor. Links between views retain the selected week. An unconfigured This week links to Context; the existing legacy review fallback remains on This week when Weekly Review is disabled.

The sample configuration uses the weekly-priorities and finance-definition documents as the two company-required sources. Release plan and open actions are the two Stars. The Engineering lead role is fictional sample configuration, not a claim about the test account owner's real responsibilities. Baseline still leaves role ranking and internal follow-up off. QA remains optional. Configuration was saved through the existing authenticated policy, Stars and role APIs with their current versions. No access grants were widened.

Actual browser checks confirmed the separated views, the retained week, an injected accepted report, authorized readback/reload and the QA preview. The report remains clearly labeled as injected engineering evidence.

## A defect exposed by longer fixture text

The first injected report was rejected with `candidate_not_admitted`. Offline reproduction through the actual test ports and canonical V2.1 runner established the cause: the dev-only deterministic adapter copied six 500-character source prefixes without fitting the serialized report budget. Realistic Markdown produced a 4,032-byte report against a 3,528-byte allowance; Unicode and escaped text produced 5,477 against 3,334. The runner correctly raised `report_budget_exceeded`.

Only the injected adapter was changed. It trims excerpts on Unicode code-point boundaries until the complete serialized UTF-8 report fits the existing 2,800-byte useful reserve, accounting for JSON escaping and reference metadata. The normal six references remain stable in the regression cases. It retains the production/wrong-database refusal and injected evidence label. Generation/Judge budgets, admission, validators, fixture text and semantic policies were not relaxed.

The resulting Markdown and Unicode regression reports were 2,800 and 2,799 bytes. Both reached the canonical runner's Generation and injected Judge stages successfully. A subsequent normal UI Generate completed and persisted an accepted injected report.

## Executed verification

- Web: 201 focused tests across 16 suites passed for configuration, navigation/view separation, authority/budget/repository behavior, auth origins, development pool reuse and sanitized errors. Four additional test-provider regressions passed in a separate suite. The worker's 71 UI checks and the previous 130-check run overlap this coverage and are not added again.
- Pipeline: 52 checks across the role-ranking, internal-decision and dynamic-context test files passed, with no application provider calls.
- Importer: 9 Node tests passed, including path/date/byte validation, remote database rejection, complete reuse and drift refusal. Both dev scripts passed Node syntax checks. Repository ESLint ignores these `.mjs` files; their checks are not represented as ESLint coverage.
- Current-source web TypeScript: 0 diagnostics. Changed/new TypeScript lint: 27 files, 0 errors and 0 warnings. The existing Pages-directory notice is informational.
- Actual local PostgreSQL: transactional insertion, exact repeated reuse, unchanged old-workspace inventories and 13 authenticated preview hash comparisons passed. These are additional executions, not a relabeling of the saved November 14 evidence.
- Actual authenticated Chrome: Context/This week separation, injected Generate, report reload and source preview/reload passed. Both localhost:3199 and 127.0.0.1:3199 passed login, Context and report reload. Switching back to the original workspace reopened both its older report and its previously accepted real-model report, then restored the sample workspace.

The first aggregate Jest invocation referenced a nonexistent auth-test filename. Its failure was preserved; the corrected invocation passed all 201 tests. A preview text-locator timeout was resolved by checking the visible frame body and exact text/hash; no source was altered to accommodate the assertion. A TypeScript check overlapped a dev-server restart and encountered five disappearing generated `.next/types` files; the stable rerun completed with zero diagnostics.

One initial configuration request returned 503 and succeeded on an explicit repeat; its specific cause was not captured. During later hot reloads the long-running task-owned dev server exhausted its V8 heap. Only that server was restarted; no database reset, migration, connection-limit increase or budget increase was used. The recovered warm-path checks passed. This remains a development-server limitation, not a production soak result. No new PostgreSQL connection-limit marker appeared in that server log.

## Coverage and interpretation

The baseline collector selected 5 of the 12 logical sample sources: weekly priorities, finance definitions, current release plan, open actions and pilot metrics. It retained both required sources and both Stars and used release-plan revision 2. The other sources, including QA and the standalone security review, remained accessible as documents but were absent from this report snapshot under the unchanged budget and selection policy.

An accepted report therefore cannot establish full QA coverage, an independent retest, or complete security evidence merely because those documents exist in the workspace. The human case list can identify absent support; it must not be treated as input evidence or as a proven semantic score. Baseline remains the default. No role-ranking, gap-planner, matching or promotion change was made here.

The local pre-indexed import checks document preview and the authorized collection-to-report path. Production upload/OCR/embedding behavior, all four retrieval modes on this corpus, independent Gold quality, load/soak reliability and migration rollback were not tested. Paid application verification retains the original ten-attempt ledger, including earlier unknown usage; its final outcome is recorded below.

## Bounded live result: rejected oversized output

One additional real Generation attempt was made through the normal authenticated Weekly Review route and the existing capped verification gateway. The configured provider returned HTTP 200 with a structurally valid two-topic JSON report. An offline replay of that exact saved input/output passed the canonical deterministic report validation, but its serialized output was **5,410 bytes against the actual 2,850-byte report allowance**. The pipeline correctly refused admission with HTTP 409 before dispatching Judge. The prior accepted injected report remained active and readable.

This is a retained failure of this live canary. It is not a completed real Generation + Judge check for this corpus, and the earlier successful real-model check on the smaller synthetic workspace is not substituted for it. No prompt, source text, budget, validator, active-pointer guard or Judge criterion was changed to force acceptance. No live retry or output repair was attempted. Resolving reliable model compliance with the existing serialized output bound is follow-up work.

Total usage is **5 of the original 10 authorized provider attempts**, not a fresh ten-call allowance. The earlier four include two Weekly Review stages and two automatic workspace-starter requests; one starter request has unknown usage and remains counted. The only new upstream request was this rejected Generation. The tightened gateway prevented unrelated UI requests from consuming more attempts. No new embedding, OCR or public-search request was made. The paid gateway was stopped, and the app was restored to baseline/injected mode.

## Publication scope

The branch also includes the already authorized November 16 fixes needed for the sample trial: shared development auth/middleware pool lifetime, sanitized auth errors, explicit localhost/loopback auth origins, title-unit and final-context-budget fixes, truthful retrieval aggregates and source readback redaction, plus their focused tests. The e2e fixture now stores actual tenant-owned preview bytes and follows Context to This week.

Only source, tests, the fictional corpus, importer and this sanitized report are intended for publication. Existing frozen audit reports, previous local engineering reports, `.env` files, sessions, database snapshots, raw provider payloads, runtime logs and browser artifacts remain local and uncommitted. The branch is pushed without a PR, merge, force push or deployment.
