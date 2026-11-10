# Vantage Budget-Aware Internal Retrieval V1

Local implementation and offline acceptance, 2026-11-09 America/New_York.

## Result and exact baseline

Implemented the first retrieval milestone as an isolated, default-off experiment. It reduces avoidable capacity failures without changing the default source-selection algorithm or replacing the V2.1 Generator/Judge. It does not establish better semantic relevance or production readiness.

- Repository: Deodat-Lawson/LaunchStack.
- Branch: `experiment/vantage-budget-aware-internal-v1-20261109`.
- Baseline: `58f435d924d9010652800e18c6e93876ad96f4e8` on `integration/vantage-production-vertical-slice-20261109`.
- Implementation commit: **d2a9940057df9fb26dff519dd0b910720d5b6993**. The following documentation commit records this implementation; it changes no application source.
- Worktree: `C:/Users/junku/orca/LaunchStack/test-output/implementation-vantage-production-20261109/test-output/vantage-budget-internal-v1-20261109`.
- Exact completed audit read: [local final two-round report](../../../../docs/reviews/vantage-dynamic-retrieval-growth-reuse-audit-2026-11-09.md). Its preserved local location is outside this experiment; findings were not recreated from memory.

Managed worktree creation could not resolve the checkpoint in the older checkout. A Git worktree was created from the healthy integration clone instead. The production branch and its untracked audit report were preserved. No push, PR, merge or deployment occurred.

## Changed files

| Area              | Files and responsibility                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contract   | [weekly-review-v21.ts](../../pipelines/src/vantage/weekly-review-v21.ts): deterministic preflight and opt-in admission evidence.                                                                   |
| Collector         | [weekly-review-internal-selection.ts](../../apps/web/src/server/vantage/weekly-review-internal-selection.ts): bounded version acquisition, reserved sources, optional admission and diagnostics.   |
| Authority         | [weekly-review-authority.ts](../../apps/web/src/server/vantage/weekly-review-authority.ts): explicit experiment option, configuration checks, bounded new-candidate checks and actor deadline.     |
| Canonical service | [weekly-review-service.ts](../../apps/web/src/server/vantage/weekly-review-service.ts): default-off flag, stable input identity and same budget profile for both real and injected provider paths. |
| Persistence       | [weekly-review-repository.ts](../../apps/web/src/server/vantage/weekly-review-repository.ts): preselected candidate ID, v2 evidence admission and omission-identity redaction on read.             |
| Types             | [weekly-review-types.ts](../../apps/web/src/server/vantage/weekly-review-types.ts): optional identity/private diagnostics.                                                                         |
| Pipeline tests    | [budget tests](../../pipelines/src/vantage/weekly-review-budget.test.ts), [V2.1 tests](../../pipelines/src/vantage/weekly-review-v21.test.ts).                                                     |
| Selection tests   | [offline tests](../../apps/web/__tests__/server/vantage-budget-retrieval.test.ts), [frozen synthetic fixture](../../apps/web/__tests__/server/fixtures/vantage-budget-orbit-v1.json).              |
| PostgreSQL        | [actual-schema integration test](../../apps/web/__tests__/server/vantage-budget-retrieval-postgres.test.ts).                                                                                       |

Eleven implementation/test files changed. No application schema migration, provider configuration, dependency lockfile, historical Joseph benchmark or existing trial artifact was changed. This report is the twelfth changed file.

## Shared preflight and invariants

`calculateWeeklyReviewBudget(input, profile)` is pure and deterministic. The collector, configuration validation and runtime call the same function. The canonical service mints a candidate UUID and request `asOf` before experimental collection; the reservation uses that UUID, so the measured input and dispatched input use the same identity and serialization.

The calculation records:

- Exact `JSON.stringify(input)` UTF-8 size and selected source count.
- Raw source text bytes, serialized text bytes and source-array bytes. Metadata/citation overhead is the exact difference between the serialized source array and serialized text values, including punctuation and text keys.
- Exact source/evaluation context projection, required-source expectation overhead, and schema validity, using Sophia's existing evaluator parser.
- Remaining serialized Generation input capacity and remaining evaluator-overhead capacity for the declared report reserve. These are envelope headrooms, not promises that an arbitrary number of raw source bytes will fit: escaping and required quotations also consume space.
- Maximum report bytes, useful reserve, feasibility and failure reasons.

| Rule                          |                    Legacy/default |                      Internal V1 |
| ----------------------------- | --------------------------------: | -------------------------------: |
| Generation input              |                      12,000 bytes |                             Same |
| Selected sources              |                        16 maximum |                             Same |
| Judge input                   |                      14,000 bytes | Same existing evaluator constant |
| Per-source Judge text         |                  6,000 characters |    Same, checked before dispatch |
| Minimum reserved report bytes |                             1,500 |                        **2,800** |
| Source completeness           | Complete; no automatic truncation |                             Same |

The existing report allowance is retained: `floor((14000 - evaluationOverhead - 512) / 2)`. Internal V1 admits only sets whose allowance is at least 2,800. That reserve is an explicit conservative experiment setting, not an empirically optimal output size. The actual returned report and full actual evaluation still pass deterministic schema/size/citation checks before Judge dispatch; the preflight cannot guarantee that a model will obey its output limit or produce valid advice.

Required company evidence and Stars are reserved first. Aggregate infeasibility fails with `mandatory_context_budget_exceeded` before run reservation or provider dispatch. No required source or Star is silently dropped. Configuration-time checks combine proposed company/Star changes with the configuring actor's other reserved sources. Runtime repeats the check for other actors, changed versions and historical cutoffs.

Optional documents are considered in eligible-version order. Each candidate is fully authorized, read within bounds and tested against the shared profile before appending. A candidate that cannot fit is omitted and the scan continues. Source text is never shortened to obtain admission.

## Actual application path and default isolation

The existing authenticated `POST /api/vantage/reviews` remains canonical:

```mermaid
flowchart LR
  Actor[Authenticated actor] --> Flag{Internal V1 flag}
  Flag -->|absent or false| Legacy[Existing collector]
  Flag -->|true| Internal[Bounded version selection and preflight]
  Legacy --> Generate[Canonical V2.1 Generator]
  Internal --> Generate
  Generate --> Validate[Deterministic validation]
  Validate --> Judge[Independent full-output Judge]
  Judge --> Save[Fresh authority and encrypted activation]
  Save --> Read[Authorized report/history read]
```

Enable only in a separately configured experimental process with `VANTAGE_INTERNAL_RETRIEVAL_V1_ENABLED=true`; the existing `VANTAGE_WEEKLY_REVIEW_ENABLED` gate is still required. No environment was changed to enable either flag in the existing trial or another running service. Enabling this flag is not spending authorization: a normal configured service can call its real providers, so no trial Generate request was issued.

Flag absence/false retains the original latest-20/current-`updated_at` collector and legacy 1,500-byte admission behavior. Tests compare absent versus explicit false and exercise the legacy path against real PostgreSQL. New evidence is produced only by the opt-in profile. The v2 reader remains available when the experiment is disabled, preserving history and privacy.

## Historical versions, acquisition and authorization

Experimental candidate acquisition selects each document's newest version with `created_at <= min(requestAsOf, weekStart + 7 UTC days)`, then orders by eligible version time/ID. Reserved IDs are excluded before the bounded optional scan. Future-only documents sort after eligible documents. An inclusive-cutoff test fixes the exact equality behavior.

This changes historical **content eligibility**; authorization, policy, preferences, titles and folder/category semantics remain current. It does not reconstruct historical titles, company policy or role state. A current authorized reader may use an old frozen source even when its current head changes.

| Acquisition boundary                          | Internal V1                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Optional candidates returned                  | At most 64                                                                           |
| Chunk probe                                   | At most 129 ordered chunks; more than 128 rejects the source                         |
| One source body                               | At most 24,000 UTF-8 bytes and existing 6,000-character Judge constraint             |
| Title projection                              | Titles above 1,024 bytes are rejected, not shortened                                 |
| Text transferred across all inspected sources | At most 128,000 bytes                                                                |
| Query envelope                                | At most 768 counted statements, including timeout-setting statements                 |
| Acquisition deadline                          | 3,000 ms with decreasing transaction-local statement timeout and actor-load deadline |
| Lock wait                                     | Transaction-local maximum 1,000 ms, additionally subject to remaining statement time |

SQL obtains bounded count/size diagnostics before transferring source bodies. Oversized chunks/documents are rejected without loading their full bodies into the application. Loaded counts and bytes are checked again; changed or incomplete content fails rather than being treated as a complete excerpt.

The per-company epoch locking protocol is retained. New preparation/dispatch/activation use bounded exact-version reads. Historical `read` and `decision` phases retain the established reader so new acquisition limits cannot retroactively reject accepted history. Current authorization and frozen hash checks still apply.

The result cap does not mean PostgreSQL examines only 64 rows internally; lateral version lookup and ordering may scan more. Statement deadlines bound server execution. Connection-pool waits, operating-system scheduling and an underlying auth read are not fully cancellable by this adapter. The actor deadline rejects the transaction and releases its epoch lock without waiting for a stalled auth result; it does not cancel that separate pending read. Representative tenant-scale query/load testing remains necessary.

## Private diagnostics and accepted-report compatibility

Private selection schema: `vantage-internal-selection/v1`, inside encrypted `vantage-admission/v2` evidence. The report output schema remains `vantage-weekly-review/v2.1`.

Diagnostics include cutoff, selected IDs/versions/purposes/rationales, required coverage, final input/report budget, acquisition counters and readable omissions. Reasons distinguish:

- `source_version_unavailable`: the actor is authorized but no version exists at the cutoff.
- `source_context_unavailable`: body/chunk/title constraints or unavailable content.
- `budget_exceeded`: the complete candidate cannot fit the selected evidence profile.
- `ranked_lower`: eligible source loses after the source-count cap.
- `acquisition_budget`: further body transfer would exceed the bounded acquisition allowance.

Authorization is checked before temporal information is disclosed. ACL-denied candidates produce only `deniedCount`, without IDs or titles. Missing/cross-company IDs do not become diagnostic identities.

Full readable omission identities are retained only in the encrypted admission record. Normal report readback removes the entire omitted array and returns reason counts/total count, even if those sources were readable at generation time. Omitted sources are not report dependencies; their access can later be revoked without permitting identifier disclosure or needlessly invalidating the accepted report. Full omission inspection would require a separately authorized diagnostic reader; this milestone does not add such an endpoint.

V2 activation verifies the input fingerprint and recomputes the exact internal budget. A forged reserve is rejected without replacing the active report. Existing v1 admission evidence remains accepted/readable; immutable report/candidate identities, encrypted bodies, selected dependency checks and active-pointer guards remain in place.

Operational rollback for this experiment is to unset the flag while retaining the v2-compatible reader/redaction. Do not serve newly created v2 private admissions through an unqualified pre-v2 reader: old code treated evidence as unknown JSON. No schema downgrade is needed for disabling the flag.

## Unchanged 28-document trial: before and after

The committed fixture freezes the original 28 synthetic documents, 29 versions, ACL labels, source dates and original bodies; original Joseph benchmark files were not edited. It contains 27 actor-readable documents. No new relevance labels or benchmark answers were created.

| Measurement                 | Legacy replay | Internal V1 |
| --------------------------- | ------------: | ----------: |
| Selected sources            |            16 |          16 |
| Required sources            |           6/6 |         6/6 |
| Personal Stars reserved     |             4 |           4 |
| Complete serialized input   |   8,084 bytes | 8,084 bytes |
| Report allowance            |   2,800 bytes | 2,800 bytes |
| Selected identities changed |             — |        None |

Selected identities: mandatory `88@95,89@96,90@97,91@98,92@99,93@100`; Stars `94@101,95@102,96@103,97@104`; optional `100@107,101@109,102@110,103@111,115@123,113@121`. Titles and exact bodies are available in the frozen fixture. The post-cutoff roadmap replacement is excluded.

The remaining readable sources are now represented as private omissions. The restricted source contributes only an aggregate denial. Recovery of older candidates in the catalog does not imply they were selected or semantically preferable.

[Machine-readable comparison](../../test-output/budget-internal-v1/comparison.json) retains the full before/after selected/omitted tables, fixture provenance/hash and explicit absence of semantic, latency and cost claims. This is offline mocked-query evidence, separate from the actual PostgreSQL test.

## Capacity failures: exact boundary evidence

The captured deterministic report is 2,439 serialized bytes. The exact same captured input is extended only in memory by appending ASCII to optional `doc:100@107` and recomputing its hash.

| Added bytes | Legacy input | Legacy allowance | Actual injected legacy execution               | Internal selected input / allowance / count |
| ----------: | -----------: | ---------------: | ---------------------------------------------- | ------------------------------------------- |
|         722 |        8,806 |            2,439 | 1 Generation, 1 Judge; accepted                | 7,632 / 2,865 / 14                          |
|         723 |        8,807 |            2,438 | 1 Generation, 0 Judge; report budget rejection | 7,633 / 2,864 / 14                          |
|       2,600 |       10,684 |            1,500 | 1 Generation, 0 Judge; report budget rejection | 8,096 / 2,802 / 16                          |
|       2,601 |       10,685 |            1,499 | 0 Generation, 0 Judge; context rejection       | 8,096 / 2,802 / 16                          |

Forcing any of those unchanged overfull sets into the internal profile is rejected with zero dispatches. The collector instead changes optional admission to produce the feasible sets in the final column, preserving all ten reserved sources. It may retain a larger higher-ranked source and omit later ones; it does not promise a particular optional document is always discarded. All provider executions in these tests are injected, with no network requests.

Controlled tests additionally verify an oversized optional document followed by a smaller eligible one; mandatory/Star aggregate overflow; a full 64-candidate scan; and failure of configuration changes whose combined reserved sources cannot fit. These establish improved capacity reliability. They do not establish that the changed evidence produces better decisions.

## Executed verification and limitations

| Check                                                     | Result                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pipeline budget/runtime suites                            | 45 passed, 0 failed/skipped                                               |
| Web selection + existing authority unit suites            | 23 passed, 0 failed/skipped                                               |
| Actual PostgreSQL integration suite                       | 1 passed, 0 failed/skipped; multiple real-boundary assertions in one test |
| Pipeline TypeScript                                       | Passed                                                                    |
| Web TypeScript with explicit experiment source resolution | Passed                                                                    |
| Focused ESLint                                            | 10 TypeScript files, 0 reported errors/warnings                           |
| Prettier and Git whitespace check                         | Passed for changed implementation/test files                              |

PostgreSQL evidence uses a new database, `vantage_budget_internal_v1_20261109`, on the verified synthetic localhost server at port 55569. It shares the existing trial server/process and connection capacity, but not its database. Official migration runners applied 6 engine and 50 product migrations, and both migration checks passed. No new app migration was written. The existing trial database was not queried or changed. Tests use at most two connections and leave their task-owned synthetic database available.

The real-schema test exercises: future-head crowding, eligible historical versions, tenant/current-ACL exclusion, more than 128 chunks without body transfer, same-company writer blocking and unrelated-company writes, stale authority rejection after a source mutation, prior active-report preservation, injected Generation and full-output Judge, v2 encrypted activation/readback, forged-budget rejection, omitted-identity redaction after revocation, and an existing v1-admission report remaining readable.

Local dependency junctions reuse installed dependencies; no installation occurred. Their workspace package links point to the healthy checkout. Jest explicitly maps workspace imports to experiment source. For TypeScript/ESLint, an ignored source-mapping configuration points pipeline imports to this experiment and preserves the web ambient type roots. This prevents accidentally validating the old implementation. Ordinary unadjusted web TypeScript initially failed on stale package exports; an initial temporary configuration also missed Jest type roots. Both harness issues were corrected without changing application configuration or suppressing diagnostics. Initial focused lint findings in new code/tests were corrected. Next's ESLint plugin still emits a repository-root Pages-directory notice outside its result counts; it was not suppressed by disabling rules.

Initial red checks reproduced absent diagnostics, aggregate overflow admission and optional budget failures before integration. Final machine-readable results are [pipeline](../../test-output/budget-internal-v1/pipeline-tests.json), [web](../../test-output/budget-internal-v1/web-unit-tests.json), [PostgreSQL](../../test-output/budget-internal-v1/postgres-tests.json) and [lint](../../test-output/budget-internal-v1/lint-results.json). No browser, full build, live model, embedding or public-search test was run. There is no production rollout claim.

### Reproduction in this worktree

Run from the worktree root with the already installed local dependencies:

```powershell
node packages/tools/node_modules/vitest/vitest.mjs run pipelines/src/vantage/weekly-review-budget.test.ts pipelines/src/vantage/weekly-review-v21.test.ts --maxWorkers=1
node node_modules/typescript/bin/tsc -p pipelines/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p test-output/budget-internal-v1/web-typecheck.tsconfig.json --noEmit
node test-output/budget-internal-v1/lint-budget.mjs
```

From `apps/web`:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath __tests__/server/vantage-weekly-review-authority.test.ts __tests__/server/vantage-budget-retrieval.test.ts
$env:VANTAGE_BUDGET_TEST_DATABASE_URL = 'postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_budget_internal_v1_20261109'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath __tests__/server/vantage-budget-retrieval-postgres.test.ts
```

The database test refuses a different host, port or database name and fails on a missing prerequisite rather than reporting a skipped PASS. Its URL above is the checked-in synthetic test credential, not a production credential. It creates additional synthetic fixtures per run. The ignored comparison and source-mapping artifacts remain local; committed fixtures/tests do not depend on the old trial directory.

## Remaining limitations and next milestone

1. **Long mandatory documents still fail closed.** Whole-source text, 6,000 characters per Judge source, aggregate input limits and the 2,800-byte output reserve remain strict. A required source cannot be silently replaced with an excerpt or dropped.
2. Version recency is a simple deterministic ordering, not semantic relevance. The unchanged trial shows no relevance gain. The provisional author labels remain provisional.
3. Current policy, titles and authorization are not historical state reconstruction. The reporting cutoff equality is now tested but remains UTC/inclusive under the existing contract.
4. A bounded optional pool can still miss useful sources outside 64 candidates. The scan/deadline may fail closed under load; query planning, indexes and lock duration need representative measurements.
5. The report reserve reduces avoidable input admission failures; invalid/oversized model output can still fail after Generation. Actual full-output validation and Judge admission remain necessary.
6. Full omission inspection is an encrypted diagnostic artifact, not a new product UI/API. Readback intentionally exposes only its aggregate omission summary.
7. No live-model reliability, browser acceptance, deployment compatibility or public-research benefit is established by this milestone. The shared public-fetch finding from the audit is outside this internal retrieval change and remains separate work.

Recommend the next milestone be a versioned scoped-evidence and coverage contract for long required documents: immutable parent version/hash, exact anchors and excerpt hash, explicit extraction/coverage diagnostics, and Sophia validation regressions before any excerpt admission. Continue evaluating relevance separately with reviewed labels. Keep public research, agent loops, GraphRAG and production-default changes deferred.
