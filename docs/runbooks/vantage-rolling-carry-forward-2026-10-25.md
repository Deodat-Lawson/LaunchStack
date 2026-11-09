# Vantage rolling historical question carry-forward — 2026-10-25

The original human-reviewed pilot question now survives through a saved week with zero generated topics and reaches the following week's model and UI unchanged. Persistence is deterministic; model repetition is not required. Historical questions remain unverified, and only explicit human review removes them from the active collection.

Implementation baseline: isolated local branch **feat/vantage-previous-context**, parent **72c0bd36b4ba5743b5dbbefc9ee5c939dc1a6232**. The local implementation commit is recorded in the final delivery and the ignored final-commit.json artifact. No push, merge, reset, rebase, production database mutation, production configuration change, or unrelated checkout edit was performed.

## Evidence and artifacts

Paths below are relative to this isolated source repository. Raw synthetic inputs, provider requests/responses, saved reports and evaluations are ignored by Git and separate from previous baselines.

- [Full actual three-week reports](../../test-output/rolling-carry-forward/20261025T162731Z/three-week-reports.md), including every topic, fact/citation, decision question, next step, unknown and human intervention.
- [Exact original-ID lineage proof](../../test-output/rolling-carry-forward/20261025T162731Z/lineage-verification.json).
- [Independent semantic evaluation](../../test-output/rolling-carry-forward/20261025T162731Z/evaluation.md).
- [Successful live run](../../test-output/rolling-carry-forward/20261025T162731Z/live-02/run-summary.json); [SQL chain readback](../../test-output/rolling-carry-forward/20261025T162731Z/live-02/C-chain-verification.json).
- [Actual saved C3 pending view](../../test-output/rolling-carry-forward/20261025T162731Z/live-02/C-week-3.pending-after-save.json).
- Actual component render: [desktop](../../test-output/vantage-pending-questions-ui/20261025T164630Z/desktop.png), [mobile](../../test-output/vantage-pending-questions-ui/20261025T164630Z/mobile.png), [after explicit review](../../test-output/vantage-pending-questions-ui/20261025T164630Z/after-review.png), [render checks](../../test-output/vantage-pending-questions-ui/20261025T164630Z/render-verification.json). Real PendingQuestions component and styles, actual saved synthetic C3 payload, mocked HTTP. This is not a full authenticated browser acceptance test.
- Previous unchanged evaluation: [72c0bd3 report](../../test-output/vantage-cross-week-quality/20261025T153856Z/report.md).
- New artifact directory: **test-output/rolling-carry-forward/20261025T162731Z/**. Each attempt has a separate label; none overwrites old outputs.

## Exact implementation

| File(s) | Change |
| --- | --- |
| pipelines/src/vantage/pending-questions-v1.ts | Internal typed ledger, eligibility, exact-ID deterministic merge, explicit human terminal reviews, authorized projection and fingerprints. |
| pipelines/src/vantage/repository-v1.ts | Read one latest earlier saved report; merge ledger with same-week state; validate exact origin metadata and native source state; include full lineage in snapshot version; persist ledger with generation; additive read/review functions with CAS. |
| pipelines/src/vantage/contract-v1.ts | One optional internal GenerationInput.pendingHistoricalQuestions field. Existing external DTOs and GenerationResult unchanged. |
| pipelines/src/vantage/pending-question-context-v1.ts | Separate bounded model projection; preserve complete human question/decision or omit whole entry; suppression of dismissed/withdrawn old prose. |
| pipelines/src/vantage/generation-v1.ts | Skeptical pending-question prompt section and diagnostics, using existing call and budgets. |
| pipelines/src/vantage/revalidate-previous-v1.ts | Sanitize history used for reasoning; retain original authorized action identity internally to suppress repeated unchanged work. |
| pipelines/src/vantage/rules-v1.ts | Empty-evidence summary recognizes separately displayed pending questions; no invented topics or facts. |
| apps/web/src/server/vantage/pending-questions.ts | Thin actor/company-bound service extension. |
| apps/web/src/app/api/vantage/agendas/[id]/pending-questions/route.ts | Separate authenticated GET/PATCH extension, strict request schema, private/no-store response, existing workspace/pilot authorization. |
| apps/web/src/app/employer/tools/vantage/api.ts | Typed extension calls; existing response shapes unchanged. |
| apps/web/src/app/employer/tools/vantage/_components/PendingQuestions.tsx | Separate historical/unverified section, origin week, original question, past decision, historical date, Dismiss and Confirm addressed. |
| apps/web/src/app/employer/tools/vantage/_screens/OverviewScreen.tsx | Mount section even for empty saved reports; avoid false “caught up”; explicit manual draft entry point with no current evidence, including skipped weeks. |
| fixtures/vantage-previous-context/pending-questions.json | Synthetic multi-week carry fixtures. |
| pipelines/src/vantage/pending-questions-v1.test.ts; pending-questions-generation.test.ts; repository-v1.integration.test.ts | Determinism, provenance, budget, suppression, concurrency, authorization and actual PostgreSQL continuity coverage. |
| apps/web/__tests__/api/vantage/pending-questions.route.test.ts; components/vantage-pending-questions.test.tsx; components/vantage-overview-screen.test.tsx; server/vantage-pending-questions.test.ts; vantage/pending-questions-client.test.ts | New extension and view tests, CAS conflicts, privacy, empty week and skipped-week manual drafting. |

No new table or migration. Joseph/Sophia ContextManifestV0, evidence-snapshot interfaces, adapters, schema and retrieval pipeline are unchanged. Company Architecture, task tracking, public research and document retrieval were not added.

## Persistence and authority

The existing vantage_contract_state.payload JSON (repository state.data) gains an optional pendingHistoricalQuestions object:

~~~ts
interface PendingHistoricalStateV1 {
    version: 1;
    questions: PendingHistoricalQuestionV1[];
    reviews: Record<string, {
        status: "dismissed" | "addressed";
        reviewedAt: string;
        reviewedBy: string | null;
        reason: string | null;
    }>;
}
~~~

Each question stores exact questionId = originTopicId, originReportId, originWeekStart, originGeneratedAt, title, original question, original topic origin, original suggested due date and original source refs. humanReview retains kind (recorded-decision / kept-topic / authored-or-edited), contentVersion, status, decision and decidedAt.

Eligibility is explicit: founder-authored/edited topics, kept topics, or questions with a recorded human decision, excluding dismissed or empty questions. A decision is conservatively retained until the separate explicit terminal review; its prose is never heuristically parsed as completion. AI-only suggestions do not become permanent obligations.

Human authorship/review and a recorded decision establish that a question was requested or a past choice was made. They do **not** establish current-world facts or completed work. Original AI question/title/due provenance remains visible in the internal record. Human terminal review establishes that the question is addressed/dismissed for carry-forward; it does not change a linked Commitment or assert a technical outcome.

Terminal reviews are tombstones, not deletion. Full original records remain stored for lineage. The ordinary UI/model projection excludes terminal entries. Unsupported refs, unavailable origins, missing sources, foreign-company content, future-cutoff content and document sources lacking actor-authorized verification are withheld; only an unavailable count is exposed. Withheld records remain in storage.

## Rolling algorithm and same-week behavior

1. Select the single latest saved report where company matches and weekStart is earlier than the current week, ordered descending, limit one. No history ranking, multi-week search or discovery of older topics.
2. Merge its persisted ledger, the current same-week ledger, and newly eligible topics from that one predecessor. Current original content wins, then previous original content; exact original IDs deduplicate. Similar questions with distinct IDs remain separate.
3. Preserve explicit human review tombstones. Explicit dismissal on the original topic is also recognized. Deadline, AI judgment, missing evidence, document changes and Commitment status never close a question.
4. Revalidate origin identity/company/week/status/version/timing by the exact IDs already carried. These are metadata-only origin checks, not rereading Week 1 prose to reconstruct Week 3 questions. Native source rows are checked for provenance, timing and fingerprinting; no workspace document bodies are fetched.
5. Project currently authorized active questions to the generator/UI; keep the complete private ledger separately.
6. After generation, take the existing write lock, re-read source/history state and compare the full input fingerprint and report version. Reject drift, then save the current report and ledger atomically.

Same-week drafts are not historical seeds. Regeneration reuses current pending lineage and reviews, while current topics remain existing reviewedTopics. Same-week regeneration cannot reopen a terminal question. A skipped calendar week still carries the latest saved ledger; older AI summary/topics remain excluded by the existing calendar-prior history assembler.

The snapshot binds actor, predecessor state, current state, original identities/versions, human reviews and native source rows, including pending questions omitted from the prompt. Existing host authorization is still required; company-scoped repository calls do not themselves authenticate a session. The service rechecks access before persistence, and the additive route uses existing vantageContext.

## Storage versus prompt budgets

Persistent questions and tombstones have no six-item or 4 KB truncation. Native validation queries run in batches of 100 with no total count cap; the PostgreSQL test saves and displays 105 questions and reviews the 105th.

The model sees at most six combined pending/history entries and a **4,096-byte combined historical JSON envelope**. Pending human questions are considered first, sorted deterministically by origin week and exact ID; old AI prose uses remaining capacity. A question/decision too large to fit is omitted whole instead of changing its meaning. Up to eight original ref IDs are projected per pending question with an omitted-ref count.

The existing 18,000-byte user payload and 23,500-byte total-message proxy remain, leaving the existing 500-byte repair reserve. Current evidence wins when the outer envelope is full. ModelMetadata records availableCount, unavailableCount, promptIncludedCount, promptOmittedCount and modelInvoked. A prepared empty-input projection is not a provider invocation.

Prompt version: **vantage-agenda/contract-v1.5-history.2-rolling**. Output schema and 2,400 output-token cap are unchanged; 20-second attempt timeout, maximum two existing attempts, one-second retry wait, and 45-second total budget remain. No default second model call was added.

## Real A/C evaluation and comparison

Azure deployment **gpt-6-luna**, actual provider model **gpt-6-luna-2026-09-22**. All eight provider responses in live-02 were HTTP 200, one attempt, validated AI results, no repair/fallback. The two empty cases used Rules with zero calls. The observer also preserved the prior B implicit-contradiction repeats; all three recognized that CSV generation succeeded while notification was absent.

The credential-free YAML is copied from the approved synthetic baseline, SHA-256 **2b5e377779313de1e13868b4c61f0633d15b63a3eb82e03d761f399768e02bb9**. Absolute config path is used. Credentials/endpoint remain local and are not stored in artifacts. The shared transport sent the same model, max_completion_tokens=2400 and schema instructions; no substitute model or new endpoint was used.

Total usage: **22,239 input + 8,910 output = 31,149 tokens**, including 5,387 reasoning tokens already counted in output. AI durations: 4,757–15,184 ms; successful whole observer: 72,845 ms. Prior evaluation used 28,636 total tokens; this replay used 2,513 more. Different stochastic responses and newly generated prior reports mean this is not an isolated token-cost benchmark. Billing was not inspected.

The live-01 launcher failed before any provider/database call because Windows environment PATH casing removed Git from the child search path. Its log/configuration/command record remain separate. Only the ignored launcher was corrected; live-02 completed.

### Experiment A: important question without evidence

Original controlled question has a human access-gate decision. With no current evidence, the new output says:

> No current eligible evidence establishes progress on 1 pending question(s) from previous reviews. Their progress is unverified; they remain listed separately for human review. Missing feedback proves neither completion nor failure, and no new action is proposed.

There are zero new factual topics, zero citations and zero model calls. The exact original question/decision remains in the separate pending projection. The baseline had a generic empty summary and no persisted/displayed question. The expired optional AI-only showcase/icon suggestion has zero pending questions. This distinguishes appropriate uncertainty from loss of a human-requested question.

With unrelated current signup evidence, the model retains uncertainty about the deletion prerequisite without attaching an unrelated citation to it. With an existing open action, it asks for the recorded test result without creating another Commitment. Its phrase “no … acceptance criteria are supplied” is too broad: the supplied action contains a test definition, even though no complete go/no-go threshold is provided.

### Experiment C: actual generated/save/read chain

Synthetic company 706, three reports retained:

| Week | Actual saved report ID | Generated topics | Active carried questions |
| --- | --- | --- | --- |
| Oct 26 | a90a32ca-cafc-47e9-b807-b719813f6e86 | 3 | 0 before human feedback |
| Nov 2 | 4cca954c-7872-4cf2-a170-4969bb21ef22 | 0 | 2 |
| Nov 9 | 88699d94-4134-488c-9f11-75d201d9f815 | 2 | 2 |

Week 1's actual deletion topic asks:

> Should the deletion dry run be the next readiness check for the synthetic pilot?

Its original ID **e637cb46-0e71-4b30-9dcb-583f56768db6** and human decision are identical in Week 2 storage and Week 3 input. Week 3's previous-report ID is Week 2's, not Week 1's. Two pending questions were actually transmitted to the provider. Exact-origin metadata/source validation still occurs, as described above.

Week 2 says:

> No supplied current item reports the deletion dry-run result, so the previously recorded pilot-readiness question remains unknown; if it is still relevant this week, checking for that result is a useful focus before revisiting go/no-go.

It generated no topics. The baseline also produced no topics but lost this original question from the next context. New deterministic storage retains it regardless of this improved summary wording.

Week 3's new acceptance topic proposes:

> Check for dated evidence of any technical acceptance review since the rescheduling call, including the previously requested deletion dry-run result. Use what is documented to identify any remaining check; do not infer readiness from the schedule change.

This is a concrete use of the original question with current scheduling evidence. It does not claim that deletion failed, succeeded, or was not attempted this week. The separate invitation-link topic suggests an unprompted find-the-link test and a comparison of one placement/label change. Completed invoice work and the expired optional showcase are not regenerated as new topics.

The original invoice question intentionally remains pending despite five passing checks and a human-updated done Commitment: that action status is not explicit closure of the question. In a separately labeled post-chain human-review exercise, Confirm addressed removes only the invoice question; Dismiss then removes the pilot question. Same-week Rules regeneration and a next-week snapshot keep both closed. All three primary reports' generated prose and the single existing action are preserved.

### Remaining content-quality errors

The Week 3 source says the customer **requested moving** the pilot date. The summary says the customer **moved** it and treats Nov 27 as the revised start. The topic fact correctly preserves “requested,” but the summary is overconfident. The previous baseline preserved “asked to move.” Citation validity did not catch this semantic error.

The dry-run step's “since the rescheduling call” can unnecessarily narrow the search; a valid earlier result could also be relevant. Some recommendations remain open-ended. These are recorded reasoning limitations, not grounds to erase human questions or expand this task into retrieval redesign.

## Tests and reproduction

Node 24.19.0; pinned repository pnpm 10.15.1. All commands run from the isolated source root. Logs capture exact commands, durations and exit codes.

| Check | Observed result |
| --- | --- |
| Targeted generation/history/Contract v1/V0 unit suite | **215/215**, 14 files; includes 35 new generation/carry cases, 12 pure-ledger cases, 48 V0 cases. |
| Fixed PostgreSQL pipeline suite | **84/84**, including **53 real PostgreSQL repository tests**. |
| Fixed API/auth/history suite | **203/203**, including 21 actual PostgreSQL route/auth tests; sessions and model are doubles there. |
| Focused web pending/overview/route/client/service tests | **44/44**; final overview rerun **9/9** after a test-only TypeScript option correction. |
| Pipeline and web TypeScript | Passed. |
| Scoped web ESLint and Git diff whitespace | Passed. |
| Broader Vantage UI regression run | **302 passed, 2 failed**. Both are unchanged HEAD tests in vantage-suggestions.test.tsx expecting two patchTopic arguments although unchanged implementation supplies the CAS third argument. Left untouched. |
| Live provider | Eight validated AI generations plus two intentional empty Rules generations; no provider fallback. |
| Actual UI render | Desktop/mobile no overflow or browser errors; exact-ID/version review request verified against mocked HTTP. |

Do not sum overlapping suite counts as unique tests. PostgreSQL used only the existing dedicated localhost test database on port 55437, with its persistent Docker volume retained. Migrations were already current (4 engine, 28 product); no table migration was added. Production connectors/data were never used.

~~~powershell
pnpm --filter @launchstack/pipelines test src/vantage/generation-v1.test.ts src/vantage/contract-v1.test.ts src/vantage/previous-context-generation.test.ts src/vantage/previous-context-v1.test.ts src/vantage/revalidate-previous-v1.test.ts src/vantage/pending-questions-v1.test.ts src/vantage/pending-questions-generation.test.ts src/vantage/proposals/context-v0.test.ts src/vantage/context-v0
pnpm --filter @launchstack/pipelines typecheck
pnpm exec node scripts/dev/vantage-integration-tl-test.mjs
pnpm --filter @launchstack/web test --runInBand __tests__/components/vantage-pending-questions.test.tsx __tests__/components/vantage-overview-screen.test.tsx __tests__/api/vantage/pending-questions.route.test.ts __tests__/server/vantage-pending-questions.test.ts __tests__/vantage/pending-questions-client.test.ts
pnpm --filter @launchstack/web typecheck

# Existing approved credentials loaded locally, never supplied on the command line.
# A fresh label is mandatory; prior attempt artifacts are not overwritten.
node test-output/rolling-carry-forward/20261025T162731Z/run.cjs live live-03

# Real component, actual saved synthetic view, mocked API:
node test-output/vantage-pending-questions-ui/render.mjs test-output/rolling-carry-forward/20261025T162731Z/live-02/C-week-3.pending-after-save.json
~~~

The ignored run.cjs pins pnpm, whitelists environment variables for the provider observer and guards the synthetic database identity. A/B histories are controlled authored fixtures. C uses actual model output saved/read via the repository; it never substitutes manual summaries. C's human decisions and invoice action resolution are explicit synthetic interventions identical in intent to the earlier comparison. Fixture dates/write clocks simulate future weeks; provider timers and PostgreSQL clocks remain real. Replays create a new synthetic company and retain it; model wording, IDs and token use can vary.

Regression coverage includes all requested cases: three-week empty continuity; summary-independent carry; distinct similar IDs; terminal dismissal; AI-only expiry; completion evidence without auto-closure; zero-evidence safety; same-week idempotence; oversize prompt/full persistence; company/source withholding; stale history/source/human-review rejection; unchanged Contract v1/V0. Additional cases cover skipped weeks, 105 questions, terminal-summary leakage, and preserving unchanged-action suppression when history is withheld.

## Remaining limitations

- No automatic actor-authorized workspace document adapter was available. Document-backed questions are conservatively withheld with unavailableCount; no document read, verification or completion is pretended. Native Vantage evidence remains distinct from workspace document ACL.
- The deterministic oldest-first prompt subset can repeatedly omit later questions. All remain stored and displayed; there is no ranking/rotation algorithm in this MVP.
- Older rolling questions do not independently change the existing evidence selection ranking. They can guide the single model call over selected current evidence, not discover omitted sources. Existing immediate-history lexical Rules matching can still associate unrelated evidence, as found in the baseline; this task did not redesign it.
- Original question/decision text is an immutable historical record. Later origin edits invalidate in-flight snapshots but do not silently replace carried wording. Explicit original-topic dismissal is recognized.
- Human review applies to the displayed report's lineage. No new global action/status system, reopen workflow, automatic reminders or historic bulk backfill was added.
- Unavailable sources conservatively hide a whole question, even when part of its wording might be harmless. Old AI summaries are also withheld when unavailable carried provenance could have leaked into them.
- Full ledger storage and review display are uncapped; validation is batched but there is no pagination or archival policy. Large-scale load testing was not performed.
- The pending card always says current status is unverified. Current evidence can be explained in fresh model content, but no automatic per-card completion classifier is introduced.
- Live evidence is one synthetic three-week chain, not a statistical quality benchmark. Semantic support still requires review. Full authenticated browser acceptance, production deployment and whole-monorepo checks were not performed.

The first follow-up quality experiment should target claim strength: distinguish a requested schedule change from an agreed change, and retain known test definitions while expressing missing acceptance thresholds. It can be evaluated independently; no such improvement is implemented here.
