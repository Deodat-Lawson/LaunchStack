# Dynamic Retrieval V3 — internal-only integration

Date: 2026-11-14, America/New_York.

## Baseline and local commits

Worktree `C:/Users/junku/.codex/worktrees/vantage-retrieval-roadmap/implementation-vantage-production-20261109`, branch `codex/vantage-dynamic-internal-v3-20261114`, starts at verified `bb10fa25838160b2d95f880ce618c65cab1f2837`. Four existing November13 review reports remain untracked and preserved. This checkout has no project `.agents` directory. Relevant installed engineering instructions and the November9 retrieval audit, November13 unified audit and November14 remediation report were read.

- `5790f52fdf3ae797c568fd8a769835661d4d6506` contains trusted business-role confirmation, the additive migration and UI/permission tests.
- `0b5dd61943f9c5c4d250033d2c86b65d4bf60dc9` contains ranking, internal decisions, versioned context and pipeline tests.
- Integration commit `4e3fd81e5efdcc604884f921642f0921fc95bf6d` contains collector/search/admission integration and the browser spec. Exact implementation/final SHAs are recorded in `test-output/vantage-dynamic-v3-20261114/final-checkpoint.json` and Git history.

Application-source work, verification and commits are local. The prior 80-call grant was excluded from this milestone. New application model, embedding and public-search requests total zero. The earlier live-call ledger remains unchanged at four historical attempts.

## Integrated flow

Authenticated actor and current company/source ACL → Required Context and personal Stars → exact versions available at the cutoff → optional confirmed-role ranking → initial budget admission → deterministic internal gap decision → at most one bounded internal search → exact-version reread, deduplication and final budget admission → immutable snapshot and trace binding → tool-free canonical V2.1 Generator → deterministic validation → independent Judge adapter → encrypted activation → source-authorized readback, human decision and history.

Sophia PR602 scoring is adapted into a standalone canonical module. The source manifest at `d53cefc7c048dbaecc5d1eee387686211570f082` was verified. Exact tokenizer and term-overlap ratio are retained. Unavailable ownership/trust/open-state metadata is omitted from scoring. Production runtime has no dependency on the ignored historical source export.

Existing `createAppRagPort` creates embeddings per search. This milestone therefore uses parameterized PostgreSQL lexical search over existing document/version/chunk rows. It invokes no embedding provider. The final source reader and all source/freeze/citation contracts remain shared with the canonical collector.

## Modes and configuration

| Mode                | Role ranking | Internal follow-up |
| ------------------- | ------------ | ------------------ |
| `baseline`          | OFF          | OFF                |
| `role`              | ON           | OFF                |
| `internal-research` | OFF          | ON                 |
| `combined`          | ON           | ON                 |

`VANTAGE_DYNAMIC_RETRIEVAL_MODE` defaults to `baseline`. Unknown modes, including the superseded `research` spelling, reject. Non-baseline modes require the existing Internal V1 opt-in. `VANTAGE_INTERNAL_FOLLOW_UP_ROUNDS` accepts only 0 or 1 and defaults to 1. Required Context and Stars remain reserved before optional ranking. Scoped Evidence retains its independent default-off gate.

For an isolated synthetic, injected-provider run, set these variables before starting the existing application or task launcher.

```powershell
$env:VANTAGE_WEEKLY_REVIEW_ENABLED = 'true'
$env:VANTAGE_INTERNAL_RETRIEVAL_V1_ENABLED = 'true'
$env:VANTAGE_SCOPED_EVIDENCE_V2_ENABLED = 'true'
$env:VANTAGE_DYNAMIC_RETRIEVAL_MODE = 'combined'
$env:VANTAGE_INTERNAL_FOLLOW_UP_ROUNDS = '1'
$env:VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER = 'true'
```

Mode selection is server-controlled. Request bodies cannot activate a mode. The actor confirms business role, responsibilities and priorities in the Weekly Review form. The `context/role` GET/PATCH API derives actor/company/revision server-side and uses the shared preference-version CAS. Role mutation is disabled without the existing Internal V1 opt-in. Membership permission roles never supply a missing business role. Missing confirmation produces observable recency fallback.

## Decision and resource contracts

The planner is explicitly deterministic and lexical. Outcomes are `STOP`, `INTERNAL_FOLLOW_UP`, and `INSUFFICIENT_EVIDENCE`. STOP records that the rules found no useful gap, rather than asserting semantic completeness. Follow-up questions are grounded in selected source refs. Their supporting sources stay frozen dependencies. After the single round, unresolved questions remain visible to Generator/Judge. Retrieval hits cannot verify execution or resolve a decision by themselves.

Limits are three gaps, two literal queries of at most 160 characters, questions of at most 300 characters and one extra round. Role-only acquisition considers 64 optional metadata candidates. Internal modes use 48 initial candidates and reserve up to 16 returned follow-up candidates. Search scans a separate bounded pool of 64 eligible metadata rows with up to 129 chunks per exact version, screening chunks over24,000 bytes without body transfer. Body loading uses the existing cumulative 128,000-byte allowance, 768 counted SQL operations and 3,000ms transaction envelope. Thus an internal mode may inspect up to 112 metadata rows while acquiring at most 64 optional bodies. Required/Star acquisition remains separately reserved within the same byte/time/query envelope.

Search only considers company-scoped versions available at the reporting cutoff. Current ACL filtering precedes exposure to ranking/planning. Unauthorized candidates contribute aggregate counts. Search errors and SQL timeouts propagate, preserving the distinction from a successful empty result. Mandatory overflow fails before provider dispatch. Optional oversized/budget-infeasible sources are skipped without body truncation.

The model-facing `vantage-dynamic-retrieval/v3` context includes mode, confirmed business-role projection, unresolved questions and a trace hash. Collection, runtime and activation use the same exact JSON/Generator/Judge budget calculator. The same context reaches the independent Judge scenario. Baseline without this optional context retains legacy payload and prompt behavior.

Mode/configuration/context bind to reservation input identity. Activation validates trace hash, mode and selected refs. Private unfrozen ranking details are kept inside the existing omitted-source container, which older readers already remove. Public trace identities concern frozen selected sources, with discovery hashes and aggregate counts for other candidates. New readers also minimize old trace records. Historical reads preserve stored evaluation identity and recheck current frozen-source authority.

## Validation and fixes

| Check                                                | Result                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Focused pipeline suites                              | 164 passed,0 failed/pending across7 files, `pipeline-final.json`     |
| Focused web/integration/history/authorization suites | 238 passed,0 failed/pending across19 suites, `web-final.json`        |
| Real PostgreSQL cases within the 238                 | 11 passed, including 4 new search cases with actual EXPLAIN ANALYZE  |
| Final changed-host collector/admission checks        | 46 passed, `host-final.json`                                         |
| Current-source web TypeScript                        | 0 diagnostics                                                        |
| Pipeline TypeScript                                  | Passed                                                               |
| Changed-source lint                                  | 51 files,0 errors/warnings, existing root Pages configuration notice |
| Browser actual application                           | 1 passed in 3.7 minutes against final frozen source                  |
| Official migration                                   | Product migration53 applied to isolated ports 55569 and 55570        |

The official migration adds one nullable JSONB business-role column. Snapshot inspection verified the single-column delta and prior snapshot chain. No source body, historical benchmark or public-research prototype was changed.

Real PostgreSQL testing exposed JSONB driver doubleencoding for serialized token arrays. Explicit text-to-jsonb casts fixed search and role writes. A numeric conflict test exposed decimal sentence splitting. An independent bounded review found a future-week ranking-window failure and overlong generated questions. Those issues received focused regressions and corrections.

The first browser launches encountered browser-cache redirection and local-socket permissions before app actions. Existing installed Chromium and normal scoped execution permissions resolved them. A complete injected browser flow then passed. A later repeat after trace hardening encountered database53300 at citation readback after repeated development hot reloads. Stopping only the task server released its connections. The server was restarted without increasing database limits. Final frozen-source browser verification passed after that restart. This development hot-reload connection accumulation remains an operational limitation.

Raw development error logs can include synthetic session parameters. Retained logs/traces are private and must not be published as unrestricted diagnostics.

## Controlled four-mode comparison

The original Orbit fixture remains 28 documents, 29 versions and 27 readable eligible sources. The raw fixture SHA-256 is `a63a8093a6eba736600696044beab29d28395d501eaf7720f9f0a823f382a96c`. Each mode used the same corpus, cutoff `2026-10-26T00:00:00.000Z`, actor ACL, explicitly synthetic confirmed Engineering role, Required Context/Stars, outer budget limits and injected conditions. Actual collectors ran against the controlled relational adapter. Real SQL and full HTTP/browser behavior are separately verified.

| Mode              | Selected | Generation input bytes | Counted acquisition operations | Extra rounds | Follow-up candidates admitted |
| ----------------- | -------- | ---------------------- | ------------------------------ | ------------ | ----------------------------- |
| baseline          | 16       | 8,078                  | 228                            | 0            | 0                             |
| role              | 15       | 7,819                  | 226                            | 0            | 0                             |
| internal-research | 14       | 7,549                  | 228                            | 1            | 3                             |
| combined          | 14       | 7,579                  | 228                            | 1            | 0                             |

All modes preserve 6/6 company-required sources and all four Stars, exact source hashes and authorized citations. Mode-specific metadata consumes part of the same budget. Selected-count differences therefore include metadata overhead and selection order.

Baseline optional selections include engineering, QA, operations, roadmap, newsletter and meeting-room updates. Role mode includes engineering, operations, infrastructure routine, unresolved follow-up and roadmap. Internal-research adds roadmap/demo/recruiting candidates during follow-up. Combined adds no new candidate in its extra round. Both research modes retain `INSUFFICIENT_EVIDENCE`.

The added recruiting routine candidate and dropped QA source are provisional review concerns. The literal search matches any sanitized query term, and lexical role matching can promote routine department metadata. These observations do not establish semantic benefit. Critical-source Recall@K, decision quality and semantic coverage remain unverified without independent Gold. A separate controlled fixture proves mechanical recovery of an older rollback record outside the initial48 candidates.

Local elapsed samples in the saved comparison are approximately 9–33ms. They use a controlled in-memory relational adapter with uncontrolled warm state. They do not establish P50/P95 SQL, provider or production latency. No external or model-token cost was incurred by these comparisons.

## Prior audit findings and rollback

R1/R2/R3 identity/CAS/request guards, R6 current-authority historical reads, R7 identity epoch classification, R8 purpose-aware personal Stars, R9 metadata privacy and R10 explicit pin recovery retain regression coverage. Role preference updates preserve existing Stars/scope maps and share epoch-first locking to prevent a lock-order inversion.

R5 is partially addressed for explicitly confirmed business responsibilities in the new modes. Whole-source historical date/title projection and independently evaluated semantic relevance remain open. The fallback workspace role is explicitly described as permission metadata in the context-only model prompt.

For feature rollback set mode to `baseline`, then disable scoped/internal creation gates if required. Retain compatible readers for accepted scoped reports. The additive role column can remain unused. Full migration down/restore, production soak and deployment evaluation were outside this milestone.

## Outcome and next gate

The default-off internal workflow is implemented and suitable for controlled broader evaluation with independent labels. The decision policy and search remain lexical. Mode comparisons reveal costs and trade-offs, including low-value candidate additions, so enabling combined as a production default is unsupported.

Next work should review independently labeled evidence gaps and tune specific internal matching/ranking failures under the four-mode harness. Public research, website ingestion, external orchestration and model-assisted planning remain deferred.

## Final browser and local service state

Final trial `e463a321-d73d-4022-aa81-0e37b25d871e` passed one Chromium test in 3.7 minutes with 54 synthetic documents. It recorded 204 allowed loopback HTTP/WebSocket requests and 0 blocked external requests. Actual form confirmation, stale role/Star CAS rejection, two UI generations, precise citations, encrypted acceptance, recorded decision, reload, replacement and reopening the earlier report all passed.

Replacement report `5c837b8c-1540-48e0-ae06-8c2d1c685170` records combined mode, confirmed role revision 2, 48 initial ranked candidates, one `release rollback owner` query, one acquired follow-up source and a final `INSUFFICIENT_EVIDENCE` outcome. Its independent Judge adapter assessed the injected candidate as pass. Provider origins remain explicitly injected deterministic fixtures.

Artifacts in that trial directory include `browser-evidence.json`, `latest-admitted-trace.json`, `exact-scoped-citation.png`, `decision-after-reload.png` and `historical-decision.png`. The task service was restored to baseline/injected mode at `http://127.0.0.1:3199/employer/tools/vantage/agenda`. Earlier accepted reports and trial data remain in the isolated database. The existing restart commands are in the November14 remediation report. The fixed local launcher preserves the canonical 127.0.0.1 authentication origin for both loopback entry points.
