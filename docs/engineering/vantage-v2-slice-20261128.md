# Vantage V2 slice

Started from the verified `origin/vantage/port-to-main-20261123` head `1ed145010ab1c1792fa7399fb027240b8ddb1492`. The new V2 workflow is off by default. Enable `VANTAGE_V2_ENABLED=true` in the web and worker processes. The workspace Beta switch and the current member's document capabilities still apply.

## Workflow

- Each member can save up to ten goals of 600 characters and select up to twelve active company personas. Settings are owner-scoped. Goals rank eligible topic seeds and lexical backfill windows. The independent exploration lane retains its capacity and ordering.
- The workspace identity row contains name, URL handle, description, industry, team size and color. Active members can read these fields in Workspace General. Positioning and stage have no fields in that projection. The separate company profile can contain document-derived summaries, facts, people, services and projects with source restrictions. V2 freezes only Workspace General's description and industry, with a 2,000-byte UTF-8 JSON cap. The projection is encrypted with the accepted evidence envelope, stays outside the source registry and is passed to the brief models as uncitable background. Empty fields yield a documents-only run. [Workspace reader](../../apps/web/src/app/api/workspace/details/route.ts) · [Snapshot](../../apps/web/src/server/vantage/v2/company-background.ts)
- Provider failure, timeout or absence of successful excerpt reads can fall back to lexical windows from the original eligible seeds. The brief marks the run degraded and displays a localized reason. Revocation still refuses the run, and the existing 80 KB evidence limit applies. [Freeze](../../apps/web/src/server/vantage/weekly-review-topic-freeze.ts)
- The owner requests a plan from the accepted brief. The brief is the root, its decision topics are sections, and each topic can have up to four task leaves. The full tree has at most 15 nodes and two edges from root to task. Decomposition checks exact frozen refs, selected active assignees and the task limits. Uncited tasks carry a proposal label. Validation can trigger one repair. Invalid tasks remaining after repair are discarded with reason codes. No Judge runs for decomposition.
- Plan edits or deletion change the version and hash and invalidate approval. The owner approves the exact new version and hash. Approval and manual Run queue eligible persona work through the worker entry point. Each task stores the latest attempt identity, ordinal, lease, safe status and encrypted result. The atomic claim holds a three-minute lease. Stale, cancelled or superseded work cannot submit. [Repository](../../apps/web/src/server/vantage/v2/repository.ts) · [Worker](../../apps/web/src/server/vantage/v2/worker.ts)
- The worker uses the accepted brief's current owner and V1 frozen-source guard. It renews authority at claim, before tools and every physical model send, and before recording a result. Its tool set reads the brief or exact frozen excerpts and submits a typed result. Limits are six turns, ten tool calls, three minutes, and up to two transient pre-generation retries per call. Model calls use the existing attempt journal and workspace usage meter. The owner can accept, rework or cancel agent tasks and complete their own tasks with a note.
- The API is under `/api/vantage/planning`. The digit-free path preserves the repository's route bucketing convention. All new controls and status labels have English and Simplified Chinese copy.

## Migration and scope

`apps/web/drizzle/20261128051438_vantage_v2.sql` creates settings, plans and tasks and extends the existing provider-attempt journal with decomposition and task execution stages. The task row holds the latest lease and result. The product migration has one snapshot and one journal entry. The migration was applied to disposable PostgreSQL for both end-to-end runs.

Deferred work includes other human assignees, scheduled and approval-resolution wakes, weekly carryover, Meetings, per-task grants, detailed profile provenance and new spend controls. If event delivery fails, the owner can use manual Run to send the wake again. Plan creation coalesces requests within one web process. Across processes, the database admits only one plan, but two simultaneous requests can both call the decomposition model. The port's authority-trigger contention item remains separate.

## Verification

- Workspace typecheck, monolithic lint at the 10,240 MB heap limit and `pnpm build` passed. Lint reported no errors and 26 warnings. Build generated all 212 static pages and reported the existing file-conversion dependency warning.
- The full package run passed 2,179 tests with one skip across 18 workspaces with test scripts. The final full rerun had 2,178 passes, one skip and one failure in the Scenario worker convergence test in `pipelines/src/scenarios/v2/store.integration.test.ts`. The isolated 12-test Scenario store suite passed with the same Scenario source.
- The final full web run passed 10,081 tests in 810 suites, with 18 skipped tests and six skipped suites. One skip is the environment-template assertion under the no-file-read rule. The opt-in PostgreSQL attempt suite passed 8/8 separately.
- Injected Harborlight run `afaf5cad-92b0-4522-8cc6-5cc91312ccf4` admitted a four-document brief. It saved owner settings, proposed one task, edited and approved it, invalidated consent on another edit, reapproved the new version and accepted the submitted result. Two concurrent worker entry calls returned one submission and one skipped claim against disposable PostgreSQL. The decomposition and execution stages recorded one settled synthetic provider attempt each.
- A separate PostgreSQL test raced plan approval with editing. The edit committed and the stale approval was rejected. Unit tests also exercise both orderings, unknown citations, bounded submission correction, task limits, one decomposition repair, mid-task revocation, the closed tool catalog and all three lexical fallback reasons.

Both end-to-end runs invoked the registered worker service directly on disposable PostgreSQL. Inngest event delivery and scheduling were not exercised.

## Live Harborlight run

Review `72c69cc1-2474-4e2b-ae4a-3ded3e3d3d7f` was admitted after two digest calls, three exploration turns, Generation, and the independent Judge. Exploration froze four evidence units with 4,774 excerpt bytes. The local Azure profile used `gpt-6-luna` for digest, exploration, Generation, decomposition and execution, and `callnotes-summary` for Judge at low reasoning effort.

Decomposition accepted one high-priority task, **Secure and document an accepted Atlas rollback decision owner**, with two supporting refs and an acceptance criterion requiring a named person's explicit acceptance. It assigned the task to the owner. The harness reassigned it to the selected persona, edited it through the API and approved exact version 3. Execution attempt 1 received an HTTP 400 with no reported usage. The Luna preset requires explicit `reasoning_effort: none` on Azure tool calls, which the transport test now checks. Attempt 2 reached tool execution and failed `task_result_refs_invalid`. Authorized read tools now return the exact ref IDs and the runner feeds invalid submissions back within its original turn and tool limits.

The owner then used manual Run on the same task and approval. Attempt 3 submitted a result with four findings citing two frozen refs and two open questions. The draft found that no named person had accepted rollback decision ownership, that the runbook operator entry did not establish acceptance, and that Atlas should remain at the current three-organization scope. The owner accepted the result and the task was completed. The brief and decomposition ran once.

| Stage          | HTTP sends | Provider seconds | Input tokens (cached) | Output tokens |  Estimated USD |
| -------------- | ---------: | ---------------: | --------------------: | ------------: | -------------: |
| Digest         |          2 |           15.134 |               774 (0) |         1,543 |     0.00084890 |
| Exploration    |          3 |            5.985 |         9,867 (4,777) |           375 |     0.00074427 |
| Generation     |          1 |           13.217 |             4,856 (0) |         1,832 |     0.00140160 |
| Judge          |          1 |           16.060 |             7,732 (0) |         2,399 |     0.00673100 |
| Decomposition  |          1 |            4.713 |             5,995 (0) |           414 |     0.00080650 |
| Task execution |          7 |           13.454 |        13,318 (5,260) |         1,157 |     0.00143690 |
| **Total**      |     **15** |       **68.563** |   **42,542 (10,037)** |     **7,720** | **0.01196917** |

Provider seconds sum request latency. The 15 sends all settled, with 14 HTTP 200 responses and one HTTP 400. The execution sends span three owner task attempts. The post-tracked estimate uses USD per million tokens for uncached input, cached input and output, respectively. Luna uses 0.10, 0.01 and 0.50. The gpt-5-mini Judge uses 0.25, 0.025 and 2.00. The conservative comparison was USD 0.02465530, below the USD 5 cap. Azure invoice charges were not verified.
