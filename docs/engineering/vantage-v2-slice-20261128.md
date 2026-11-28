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

The original end-to-end runs invoked the registered worker service directly on disposable PostgreSQL. The follow-up below verifies local event delivery separately.

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

## Follow-up from `1dd8e41c832d`

### Real local event delivery

The local web app sent `vantage/task.requested` to Inngest CLI `1.53.0-d7720d230`, which invoked the registered handler on `apps/worker/src/main.ts`. The SDK app is `pdr-ai`, the function ID is `vantage-task`, the full slug is `pdr-ai-vantage-task` and the scheduler UUID is `a7f2e7ac-0fd2-5bcb-ba0f-b63247935b64`. The web and worker used disposable PostgreSQL and an injected provider.

| Action       | Inngest event ID             | Function run ID              | Observed outcome                                                                                    |
| ------------ | ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Approve plan | `01M8GCFXWC14EB3N9QZX6RAN17` | `01M8GCFY3DK8R4MNFE5HQFWPAP` | Worker claimed the task and its `execute` step submitted attempt 1. The result appeared in the app. |
| Manual Run   | `01M8GCH8NC3TWBPCYYFYW6SZ1M` | `01M8GCH8WD0RKY7W1BNHW2F68J` | Run completed, worker submitted attempt 2, and the owner accepted it.                               |

The first local configuration used four Inngest executor workers and events stayed scheduled. Fresh events ran with the default worker count. The harness deliberately stopped the worker after observing submission on approval. The scheduler's final continuation then failed to connect. After the restart, manual Run used the same registered function and reached a completed scheduler run. The local browser also needed one canonical web hostname for both the session cookie and Next redirects.

The Chromium approvals also completed the entire function. English event `01M8GCQWTNMA4TKZYQ8RBS9B6G` ran as `01M8GCQWV0WTSZ869VAGHQ3XHV`. Simplified Chinese event `01M8GD4V2102BP1HM9X912YHVQ` ran as `01M8GD4V3EGKXT6QFZR426EJVD`. Both runs submitted attempt 1, and the browser owners accepted the results.

### Capability and live decomposition breadth

Decomposition receives the selected active personas' names and roles. It can assign them to analyze or compare the brief and frozen excerpts or draft a typed result. Contacting people, taking external action, approving and deciding belong to the owner. The validator requires persona proposals to declare a read-only work type and routes declared human actions to the owner. Role suitability and free-text classification use the model's judgment. The worker enforces its closed tool set independently. The prompt sets the existing tree limits and leaves task count to the model.

The original four-document live brief had two decision topics, the expansion gate and pilot metrics. The first decomposition proposed one rollback-ownership task, and the stored plan shows zero discarded tasks. The model left the metrics topic empty. The four-task per-topic cap did not limit that output.

The fixture databases available for this follow-up contained no larger admitted live brief. The one 12-document Harborlight attempt `0b1d7fa2-d5d0-43b4-9cb5-bba2aaacd229` froze 12 evidence units and reached Judge after successful Generation. `callnotes-summary` returned `rate_limit_exceeded` on all three HTTP 429 sends with a 30-second Retry-After. The run recorded `judge_admission_failed`, `provider-error`, `judge_status_unavailable` and `judge_verdict_needs_review`. I used the largest admitted brief for decomposition alone. The original plan and brief stayed intact.

| Brief                                         |   Decision topics | Proposed | Dropped and codes | Persona / owner |
| --------------------------------------------- | ----------------: | -------: | ----------------- | --------------: |
| Original 4 documents, original plan           |                 2 |        1 | 0                 |           0 / 1 |
| Original 4 documents, follow-up decomposition |                 2 |        2 | 0, no repair      |           1 / 1 |
| 12 documents, Judge rate-limited              | No admitted brief |  Not run | —                 |               — |

The persona task was **Summarize the rollback ownership gap and acceptance evidence**, assigned to the selected read-only evidence analyst. The owner task was **Obtain and record rollback decision-owner acceptance**. Both used two frozen refs and belonged to the expansion-gate topic. No task was proposed for pilot metrics.

Follow-up Azure spend was USD 0.00873747 for the 12-document attempt and USD 0.00106540 for decomposition, totaling **USD 0.00980287** at the rates above. All 19 requests settled, including the three Judge responses with no reported usage. The conservative estimate was USD 0.02854830.

### Browser regression

Chromium exposed a mismatch between the stored plan and its editor. Decomposition saves each proposal as a task with no parent task. The panel treated those tasks as headings and only rendered editors for their nonexistent children. The panel now groups task editors by the accepted brief's decision topic. The component regression uses the API's actual task shape and failed before the fix. [Panel](../../apps/web/src/app/employer/tools/vantage/_components/V2PlanPanel.tsx) · [Regression test](../../apps/web/__tests__/components/vantage-v2-plan.test.tsx)

Both locales used the local app, real event delivery and an injected provider. Each owner saved settings, generated a brief, created a two-task plan, edited one task, removed the other, approved the plan, saw the worker result and accepted it. The controls are localized. The injected brief, tasks and result use the same English fixture content in both runs. Acceptance now leaves the result visible and clears the pending-review copy. The English acceptance initially hit SQLSTATE `53300` as local development connections approached the disposable database's 100-connection limit. Restarting the task-local processes released those connections. Acceptance then returned HTTP 200.

| Screen                  | English                                                        | Simplified Chinese                                             |
| ----------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| Saved goals and persona | [Screenshot](assets/vantage-v2-slice-20261128/en-settings.png) | [Screenshot](assets/vantage-v2-slice-20261128/zh-settings.png) |
| Accepted brief          | [Screenshot](assets/vantage-v2-slice-20261128/en-brief.png)    | [Screenshot](assets/vantage-v2-slice-20261128/zh-brief.png)    |
| Created plan            | [Screenshot](assets/vantage-v2-slice-20261128/en-plan.png)     | [Screenshot](assets/vantage-v2-slice-20261128/zh-plan.png)     |
| Edited task             | [Screenshot](assets/vantage-v2-slice-20261128/en-edit.png)     | [Screenshot](assets/vantage-v2-slice-20261128/zh-edit.png)     |
| Removed second task     | [Screenshot](assets/vantage-v2-slice-20261128/en-delete.png)   | [Screenshot](assets/vantage-v2-slice-20261128/zh-delete.png)   |
| Approved exact plan     | [Screenshot](assets/vantage-v2-slice-20261128/en-approved.png) | [Screenshot](assets/vantage-v2-slice-20261128/zh-approved.png) |
| Agent result detail     | [Screenshot](assets/vantage-v2-slice-20261128/en-result.png)   | [Screenshot](assets/vantage-v2-slice-20261128/zh-result.png)   |
| Owner accepted result   | [Screenshot](assets/vantage-v2-slice-20261128/en-accepted.png) | [Screenshot](assets/vantage-v2-slice-20261128/zh-accepted.png) |

The English plan screenshot uses a second injected review in the next fixture week to show both tasks at full height. The English result detail shows the retained result panel. The approval and completion shots show the states before and after acceptance.

A disposable session value surfaced in local error diagnostics during verification. All 12 sessions for this round's eight synthetic fixture users were revoked, and the task-owned diagnostic logs and auth artifacts were removed.

### Follow-up verification

- Workspace typecheck, monolithic lint at a 10,240 MB heap limit, and `pnpm build` passed. Lint reported no errors and 26 warnings. The build generated all 212 static pages. The final focused run passed all 96 tests across 12 Vantage suites.
- The full web run spanned the browser fix. It had 10,079 passes, 18 skips and seven failures, all in the task panel under its old rendering. After the fix all ten panel tests passed, including the plan-shape and accepted-result regressions. One full web skip was the environment-template assertion.
- The full package run had 2,178 passes, one skip and one failure in the unchanged Scenario worker convergence test. The isolated rerun had 11 passes and the same failure.

### Run locally

1. Use a disposable local PostgreSQL with the vector extension, for example `docker compose up -d db`. From the repository root, run `pnpm install --frozen-lockfile` and `pnpm db:migrate` against it. If you will import documents, start the normal local storage and indexing services for your setup.
2. Give the web and worker processes the same local `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `EMBEDDING_SECRETS_KEY`, chat provider settings and Inngest configuration. Set the following non-secret local switches in both terminals. Supply `BETTER_AUTH_SECRET` and provider credentials through your usual environment setup.

   ```powershell
   $env:VANTAGE_WEEKLY_REVIEW_ENABLED = 'true'
   $env:VANTAGE_V2_ENABLED = 'true'
   $env:INNGEST_DEV = 'http://127.0.0.1:8293'
   $env:INNGEST_BASE_URL = 'http://127.0.0.1:8293'
   $env:BETTER_AUTH_URL = 'http://localhost:3393'
   ```

3. Start each process in a separate terminal. Use the local Inngest SDK endpoint served by the worker. The verification used Inngest CLI 1.53.0.

   ```powershell
   # Worker terminal
   $env:WORKER_PORT = '8033'
   pnpm --filter @launchstack/worker start

   # Inngest terminal
   inngest dev --host 127.0.0.1 --port 8293 --no-discovery --sdk-url http://127.0.0.1:8033/api/inngest

   # Web terminal
   pnpm --filter @launchstack/web dev --hostname localhost --port 3393
   ```

4. For Azure, set `CHAT_BASE_URL` and `CHAT_API_KEY` through the environment and `CHAT_MODELS_CONFIG` to the absolute path of your Azure profile, based on `apps/web/config/chat-models.azure.yaml`. For the profile used here, map `default`, `reasoning` and `vision` to `gpt-6-luna`, and `fast` to `callnotes-summary` at low reasoning effort. Set the route switches before starting the processes. Keep Generation and Judge on distinct deployments.

   ```powershell
   $env:VANTAGE_TOPIC_FIRST_DIGEST_ROUTE = 'default'
   $env:VANTAGE_TOPIC_FIRST_EXPLORATION_ROUTE = 'reasoning'
   $env:VANTAGE_WEEKLY_REVIEW_GENERATION_ROUTE = 'vision'
   $env:VANTAGE_WEEKLY_REVIEW_JUDGE_ROUTE = 'fast'
   ```

5. Open the web app at `http://localhost:3393`, using the same hostname as `BETTER_AUTH_URL` for redirects and cookies. Sign in as a local member with document read and edit capability, turn on Beta apps for that workspace and add eligible documents and an active persona. In Vantage, save goals and the persona, generate a brief, create a plan and approve it with a persona task. Follow `vantage/task.requested` in the local Inngest dashboard at `http://127.0.0.1:8293`, then review the task result in Vantage.

## Follow-up from `2f50ff235fe8`

The starting worktree and `origin/vantage/port-to-main-20261123` both resolved to `2f50ff235fe87cd8df9cce5c42227a1563979097`.

### Scenario comparison

Ran the isolated Scenario store suite three times at each revision, alternating baseline and HEAD. Both frozen source snapshots used Node 24.19.0, the same installed dependencies and PostgreSQL 17.11 on loopback. Each run used a new disposable database and applied the engine and product migrations for its own revision.

| Revision       |   Round 1 |   Round 2 |             Round 3 |
| -------------- | --------: | --------: | ------------------: |
| `1ed145010ab1` | 12 passed | 12 passed | 11 passed, 1 failed |
| `2f50ff235fe8` | 12 passed | 12 passed | 11 passed, 1 failed |

Both failures came from `lets competing workers converge` at [the assertion that every worker reached `done`](../../pipelines/src/scenarios/v2/store.integration.test.ts#L330). The test, Scenario implementation and shared package sources are identical across the two pins. The baseline reproduced the failure, so Scenario code was left unchanged.

### Session artifact check

Scanned both commits in `1ed145010ab1..2f50ff235fe8`, covering 80 changed paths and 87 unique blobs, including the report and every version of the pushed screenshots. The checks covered the installed Better Auth session format, cookie assignments, serialized tokens, credential headers, browser-state and log paths, and PNG metadata. The 15 strings that matched the bare 32-character shape were TypeScript identifiers. There were no other hits. All 16 screenshots matched their Git blob hashes. Visual inspection and local OCR of each screenshot showed synthetic UI data and plan hashes, with no visible cookies or session tokens. The check used token structure and syntax classification, with the revoked value kept out of the scan.

### Shared Judge testing

`VANTAGE_ALLOW_SHARED_JUDGE_DEPLOYMENT=true` enables the testing exception. With the switch unset or false, identical deployment IDs still produce `independent_judge_required`. The admission checks and Judge evaluation still run with the testing exception.

The run stores the selected deployment IDs, independence flag and override state in its manifest. Owner status exposes the record under `judgeDeployment` and retains it after terminal failure cleanup. Accepted evidence includes `judgeIndependent`. A shared-deployment run carries `qualityEvidence: shared-judge-test` and a localized notice in the brief.

### Live 12-document Harborlight result

Run `37a38d54-52c7-43d9-9dcd-6138590056d6` was admitted in 81.352 seconds with 12 evidence units and 13,406 excerpt bytes. The local Azure profile used `gpt-6-luna` for Generation and Judge, with low reasoning effort on Judge. The saved manifest and owner status both reported `independent: false` and `sharedDeploymentAllowed: true`. Accepted evidence reported `judgeIndependent: false` and `qualityEvidence: shared-judge-test`.

| Admitted decision topic                                              | Proposed tasks | Persona | Owner |
| -------------------------------------------------------------------- | -------------: | ------: | ----: |
| Pilot continuation and open expansion gates                          |              0 |       0 |     0 |
| Rollback decision accountability and unverified production readiness |              3 |       2 |     1 |
| Usage across different populations and separate reporting            |              0 |       0 |     0 |
| **Total**                                                            |          **3** |   **2** | **1** |

The first decomposition pass proposed three tasks and kept all three. There were zero drops, no drop reason codes and no repair call. The read-only evidence analyst received **Analyze rollback decision-accountability evidence** and **Draft a rollback decision-owner acceptance record**. The owner received **Obtain and record accepted rollback decision ownership**. Each task used two frozen refs.

| Stage         | Azure requests |  Estimated USD |
| ------------- | -------------: | -------------: |
| Digest        |             10 |     0.00445490 |
| Exploration   |              4 |     0.00219427 |
| Generation    |              1 |     0.00267970 |
| Judge         |              1 |     0.00247630 |
| Decomposition |              1 |     0.00276750 |
| **Total**     |         **17** | **0.01457267** |

All 17 requests returned HTTP 200 and settled in both the relay and the application journal. The estimate applies Luna's configured rates of USD 0.10 per million uncached input tokens, USD 0.01 per million cached input tokens, and USD 0.50 per million output tokens. The conservative comparison was USD 0.04073700, below the USD 5 cap. The session created for this live fixture was revoked after verification.

### Follow-up checks

- Workspace typecheck, monolithic lint with a 10,240 MB heap, and `pnpm build` passed. Lint reported 26 warnings and no errors. Build generated all 212 static pages.
- The full package run passed 2,182 tests across 18 workspaces, with one skip. The Scenario suite passed in that run and remained unchanged after the isolated comparison above.
- The full web run passed 10,098 tests across 812 suites, with 18 skipped tests and six skipped suites. The environment-template assertion was among the skips because it requires opening the template.

## Four P3 fixes from the review of `902e396657e8`

The worktree and remote branch both started at `902e396657e8f9baa15861848a0ef97b1dce8eb1`. Verification used synthetic inputs and disposable loopback PostgreSQL. The live Harborlight runs above are historical.

| Finding | Change | Regression evidence |
| --- | --- | --- |
| Stale claim refusal | The worker captures the queued task version and plan approval before checking authority. After a refusal it locks the matching plan and blocks the task only if both observations still match. | The old code blocked all four superseded tasks. The [PostgreSQL replay](../../apps/web/__tests__/server/vantage/v2/claim-refusal.postgres.test.ts) now preserves the queued state and attempt count after edit/reapproval, replacement of approval alone, requeue alone or withdrawal of approval. An unchanged refusal records one blocked attempt. |
| Work type lost on edit | The encrypted task and plan hash retain `analysis`, `comparison`, `draft` or `human_action`. To assign a human action to a persona, the owner must explicitly change its work type. Changing a persona recipient or its acceptance criterion requires reconfirming a read-only work type in the same edit. This invalidates the prior approval. | [Decomposition](../../apps/web/__tests__/server/vantage/v2/decompose.test.ts), [repository](../../apps/web/__tests__/server/vantage/v2/repository.test.ts) and [editor](../../apps/web/__tests__/components/vantage-v2-plan.test.tsx) tests cover persistence, classification, conversion, approval and editing. Legacy tasks keep their recorded hash. An unclassified persona task needs owner classification before a new approval or manual retry. |
| Partial plan approval | Product migration 60 permits either two null approval fields or two non-null fields matching the current version and hash. Journal entry 59, its SQL and its snapshot remain intact. | [PostgreSQL matrix](../../apps/web/__tests__/db/vantage-v2-approval.postgres.test.ts) checks all nine combinations of null, matching and stale values. An upgrade containing a partial approval rolls back with SQLSTATE `23514`, preserving the old guard and data. |
| Shared Judge mislabelled | Topic-first admission compares the evidence's Generation ID, Judge ID and explicit boolean to the pre-dispatch deployment record and checks independence against the two IDs. Equal IDs require the recorded shared-deployment opt-in. | [Admission tests](../../apps/web/__tests__/server/vantage-topic-admission.test.ts) reject eight invalid receipts before report storage or activation and preserve the classification on authorized readback for both shared and independent Judges. |

**Migration preflight.** Check for rows in `pdr_ai_v2_vantage_v2_plans` where `(approved_version IS NULL) <> (approved_hash IS NULL)`. If any exist, an authorized operator should clear both approval fields on those rows, retry the migration and request fresh owner approval. The migration does not infer consent. On an empty disposable database the official runner applied the engine and product migrations, and its product checksum check reported all 61 entries current.

### Offline verification

- Nine focused suites passed 79/79, including the PostgreSQL claim-refusal and approval-constraint cases. The initial full web run exposed two stale test fixtures. The provider-attempt concurrency fixture now records the Judge deployments before dispatch, and the schema parity test resolves the latest snapshot from the product migration journal. The corrected concurrency suite passed 8/8.
- Workspace typecheck passed after correcting a strict-null diagnostic in the migration test. Monolithic lint with a 10,240 MB heap passed with zero errors and 26 warnings. The production build generated 212/212 static pages and emitted the previously recorded file-conversion dependency warning.
- The final package run across all 18 workspaces passed 2,182 tests with one skip. The first full run passed 2,181, skipped one and failed the [Scenario worker convergence assertion](../../pipelines/src/scenarios/v2/store.integration.test.ts#L330). The isolated rerun reproduced that failure (11/12 passed). The final full run passed all 12 Scenario cases. Its implementation and test are unchanged from the starting SHA.
- The final unfiltered web run matched the complete Jest discovery list of 820 suites. It passed 10,136 tests across 815 suites, with nine tests and five suites skipped and zero failures. It included the opt-in PostgreSQL tests and the committed environment-template assertion.
