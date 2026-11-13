# Vantage Retrieval Execution Ledger

## Ownership and authorization

Resumed existing lead session on 2026-11-13 America/New_York under the user's Autonomous Engineering Ownership specification. Local changes, isolated branches, offline tests and local commits are authorized. Paid APIs, external company disclosure, pushes, PRs, merges and deployment require separate approval.

Original audit is `test-output/implementation-vantage-production-20261109/docs/reviews/vantage-dynamic-retrieval-growth-reuse-audit-2026-11-09.md`. Historical V1 report is under that checkout's `test-output/vantage-budget-internal-v1-20261109/docs/engineering/`. The November 10 PDF is a historical handoff. Current source and executed checks determine completion.

## Phase 0 baseline verification

- Healthy integration checkout remains on `integration/vantage-production-vertical-slice-20261109` at `58f435d924d9010652800e18c6e93876ad96f4e8`. Initial status contains its existing untracked audit report.
- Original desktop checkout remains `c520ea1f0111884e554cacb35e0a4f1678dd98d8`, with pre-existing `audit/` and production-readiness report.
- Healthy repository refs retain completed V1 `4fbf006ca1ebb4ee5d4c5928c8349bd41b6ae4cb` and implementation `d2a9940057df9fb26dff519dd0b910720d5b6993`. Old V1 worktree Git access is blocked by ownership protection. It is preserved without edits or trust-setting changes.
- Fresh remote reference read confirms integration is still `58f435d924d9010652800e18c6e93876ad96f4e8`, while current main is `c2437d73da5370bc62eb05ec9f9abbf53aba3e69`. A safe fetch updated only remote refs. The shared fetch defect is still present in current main.
- App task inventory shows this execution lead active. Managed worktrees are attached to this existing session. No second lead session was created.
- Normal sandbox Git operations in managed paths outside the original writable roots can fail with `must be run in a work tree`. Normal escalated execution succeeds while retaining Git ownership checks. No safe.directory, ownership, bypass mode or sandbox configuration was changed.

## Execution backlog

| Phase                    | State                                                      | Evidence and next action                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 baseline               | Verified with stated limits                                | Fresh V1 pipeline and web suites passed 45 and 23 tests. The original single V1 PostgreSQL test was not rerun against its old guarded database. PR603 remains draft/open at58f435d9 and currently mergeable=false. PR602 remains open atd53cefc7.                                                                                                                                                                                                          |
| 1 shared fetch P1        | Verified local commit                                      | `57ae0e8c29662ebf8ab7053b463acc1330925dcd`. Fetch81 and full web-research137 passed. Independent review passed 70,756 address checks and four resource probes, with no introduced P1/P2 found in its bounded scope.                                                                                                                                                                                                                                        |
| 2 scoped evidence        | Verified and committed                                     | Core `c5a74e513282e84fc239899a01438bfc8976ba60`, normal-route integration `475b725e6b4d3e4c008a25ffae12565c991fca1e`. User-approved finite scope policy, default-off flags, additive official migration, scoped V2 evaluation and V3 activation/readback are connected. Parent-run pipeline and web suites passed 105 and76 tests, including two real PostgreSQL tests. Final independent review found no remaining material blocker in its bounded scope. |
| 3 independent evaluation | Local harness and controlled replay verified and committed | `de07a68fbb3d0ca3bccb61855b89b45e521b188a`. Actual A/B/C/D controlled replay preserves Orbit28. All four candidates pass integrity checks. A/B/D select16, C selects15 with an explicitly hypothetical Operations role. Original Orbit has no approved scopes, so D matches B. A separate approved long-source case establishes whole-fail/scoped-pass capacity only. Semantic gold remains absent.                                                        |
| 4 Sophia compatibility   | Verified and committed                                     | `13daad56f404480afa438072f37e8800a367ed65`. Mapper forwards exact backend versionId. Portable10 tests and actual pinned PR602 bridge12 checks passed. No fabricated head fallback or default ranking adoption.                                                                                                                                                                                                                                             |
| 5 continuity             | Verified prototype committed                               | `2ccde56f544c0da538d93b0c74fa80c2799457cb`. Current observation capture and migration proposal implemented. Review found invalid-calendar-date acceptance and missing retention bounds, corrected22 tests passed. Durable observation adapters and transition migration remain future work.                                                                                                                                                                |
| 6 research gates         | Verified offline prototype committed                       | `1d46f21e0b99b12885f86161aa9e6b71d4ff6497`. Catalog-only query preparation, pinned grants, fixture reservations and immutable provenance. Invalid dates and retained mutable extension metadata corrected,56 tests passed. No dispatch/client/production integration.                                                                                                                                                                                      |

## Isolated working areas

Shared security branch `fix/shared-web-fetch-ipv6-20261113` starts at current main `c2437d73da5370bc62eb05ec9f9abbf53aba3e69` in `C:/Users/junku/.codex/worktrees/vantage-shared-fetch-security/implementation-vantage-production-20261109`.

Scoped retrieval branch `experiment/vantage-scoped-evidence-v2-20261113` starts at completed V1 `4fbf006ca1ebb4ee5d4c5928c8349bd41b6ae4cb` in `C:/Users/junku/.codex/worktrees/vantage-retrieval-roadmap/implementation-vantage-production-20261109`.

Each milestone entry will record changed files, exact commit, executed tests, interpretation limits and next action. This ledger is the persistent session index. Branch-specific reports and commits retain implementation evidence.

## Final scoped integration evidence

The normal application context API, collector, canonical V2.1 runner, independent Judge adapter and encrypted repository share the scoped contract. ID-only requirements retain complete indexed-document semantics. Finite scope is bound to exact parent version/hash, required inventory, UTF-16 ranges, unit hashes and current authority. Coverage remains visibly qualified. New scoped creation requires both default-off experiment flags. Compatible historical V3 reads work with scoped creation disabled under current frozen-source authorization.

Final parent-run tests produced zero failures and zero pending tests. The 105 pipeline tests cover core, canonical Generation/Judge projection, budgets and scoped V2. The 76 web tests cover existing authority/budget behavior, scoped selection, context API, V3 repository, UI coverage, exact-version mapper and two real PostgreSQL tests. The 22 continuity and 56 research tests were rerun together with 78/78 passing. The final evaluation suite passed 18/18. Full pipeline TypeScript, current-source web TypeScript and the actual replay runner typecheck passed. Focused server/API lint reported zero errors and warnings. Changed-file formatting and whitespace checks passed.

Independent review reopened and reproduced descriptor ordering across JSONB/realms, mixed ordinary-source body hashes, assessment identity, reporting-week mismatch and timestamp microsecond eligibility. All were corrected before the application checkpoint. Fifteen tampered V3 packet variants reject in the final independent probes. Actual PostgreSQL proves microsecond rejection, inclusive equality, ACL denial precedence, >32KB/129-chunk parent handling, cross-chunk spans, encrypted acceptance/readback, source revocation, outside-span changes, previous-active preservation and cross-tenant lock independence.

Machine-readable final results and compiler/lint logs are private ignored artifacts in the roadmap worktree's `test-output/vantage-roadmap-20261113/`. The copied `verify-web-source.cjs` uses an in-memory path mapping because reused dependency junctions point at the older healthy checkout. Project configuration and dependency links were preserved. The generated migration snapshot was independently compared against its predecessor and retains all142 existing tables with exactly2 added JSONB columns.

The scoped report is `docs/engineering/vantage-scoped-evidence-v2-20261113.md`. Other checkpoint reports are `vantage-rag-version-binding-20261113.md`, `vantage-retrieval-evaluation-20261113.md`, `vantage-evidence-continuity-20261113.md` and `vantage-research-policy-prototype-20261113.md`. The independent shared-fetch branch contains `shared-web-fetch-security-20261113.md`.

## Approved scope-policy decision

On 2026-11-13 the user selected explicit administrator-approved finite spans as a valid experimental Required Context scope. The approval preserves whole-document meaning for ID-only configuration and requires visible relevant-span qualification. Configuration, current ACL, exact parent version/hash, all required units, independent Judge admission and accepted-history authorization remain necessary.

## Local test environment

The prior synthetic server at127.0.0.1:55569 returned ECONNREFUSED. Docker Desktop was already installed but stopped. It was started through its supported CLI. Its existing Docling container resumed with the engine. No existing container configuration was changed or stopped.

A new separately named container `launchstack-vantage-scoped-20261113` uses the already installed pgvector/pg17 image with pull=never, loopback-only port55570 and task-owned database `vantage_scoped_evidence_20261113`. Random synthetic credentials are retained only in ignored `test-output/vantage-scoped-postgres-20261113/connection.json`. Existing trial databases were not used. Official6 engine and51 product migrations and both checks passed against this new database.

The normal schema generator initially failed on duplicate table exports with the reused dependency environment. A temporary canonical product-schema barrel generated migration51. Snapshot comparison retained all142 tables and exactly two additive JSONB columns; journal and Drizzle checks passed. The temporary config was removed.

After the final PostgreSQL checks, the verified task-owned container was stopped with its data retained. It can be restarted with `docker start launchstack-vantage-scoped-20261113`. Docker Desktop remains running. Existing containers and services were preserved after the engine startup. This run did not start a new Next.js trial server.

## Requirement-to-evidence index

| Requirement                               | Implementation and acceptance evidence                                                                                                                               | Remaining boundary                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Independent shared-fetch correction       | Security branch57ae0e8c, mapped/translated embedded IPv4 policy, pinned redirect hops, cancellation/resource guards,137 shared research tests                        | Existing unrelated special-address policy and native DNS cancellation limits are documented in its report |
| Explicit approved finite Required Context | Existing context API capability/version guards, company-readable authority, version/hash/ranges, scope precedence, normal collector integration, route and SQL tests | Administrator selection can exclude consequential evidence outside its finite scope                       |
| Exact evidence and coverage               | Parent canonical hash, chunk anchors, unit refs, full/spans/insufficient states, original extraction completeness unknown, UI qualification                          | No original PDF/OCR completeness claim or automatic scope proposal                                        |
| Shared budget and default isolation       | Common scoped-v2 budget in collector/runner/activation, useful reserve, exact data-payload checks, flags off tests                                                   | Provider token and monetary accounting and model quality require separate evaluation                      |
| Revocation, history and activation        | Real PostgreSQL authority/encryption, parent/ACL races, historical version, previous active preserved,15 packet tamper probes, microsecond cutoff                    | Authenticated browser walkthrough and representative load were not rerun                                  |
| Reproducible retrieval comparison         | Frozen original Orbit corpus, exact Sophia export, four valid replay candidates, six configured requirements preserved, label-blind18-test evaluator                 | Joseph's authoritative corpus/gold and Sophia's independent review are outstanding                        |
| Sophia exact-version bridge               | App metadata forwarding plus portable10 and actual pinned bridge12 probes                                                                                            | Ranking remains an offline condition, registered embedding/provider search quality unmeasured             |
| Recorded continuity                       | Authorized immutable process-local observations, current and captured source lineage,22 tests, append-only migration proposal                                        | Durable encrypted adapters and transactional event writer are not implemented                             |
| Future public research policy             | Offline catalog projection, matching grants/reservations, strict immutable provenance,56 tests                                                                       | No dispatcher, authenticated capture store, durable spend ledger or public search integration             |

## Final selection comparison

The unchanged Orbit corpus has 28 documents and 29 versions. Its historical authorized manifest contains 27 exact versions. A loads 16 bodies and selects 16. B loads 27 and selects 16. C loads 27 and selects 15 under a disclosed hypothetical Operations role. D loads 27 and selects 16 using the original whole-document configuration. A/B/D select the same reference set, while ordering varies. All candidates preserve six configured company requirements and four Stars. C omits QA defects and the announcement while selecting a prior decision. The complete selected and omitted identities remain in private replay artifacts.

Generation data sizes are 8,084, 8,084, 7,542 and 8,084 UTF-8 bytes respectively. These are exact serialized application data measurements. Each replay has one uncontrolled local elapsed sample. Semantic relevance, citation entailment, decision quality, P50/P95 and provider spending remain unmeasured.

The separate provisional long-source fixture has 33,023 bytes and 129 chunks. Whole-parent preflight fails. A finite approved first 2,000-character scope passes at 4,904 Generation-data bytes with relevant-span coverage. Its changed scope is explicit and independent of the Orbit case.

## Next action and delivery state

All authorized local engineering checkpoints have been committed. The independent security fix remains on its separate branch. The roadmap branch retains the completed V1 ancestry, scoped integration, exact-version compatibility and unintegrated continuity/research prototypes. The original integration checkout remains58f435d9 with its pre-existing untracked audit report. No push, PR, merge, deployment, paid provider request or production database operation was performed.

The next empirical milestone requires Joseph's versioned representative corpus and authoritative evidence/decision labels, followed by Sophia's independent label review. Keep those judgments outside selector inputs. Run a frozen database-backed comparison before selecting any ranking default. Retain the live-provider and authenticated browser/load gates explicitly. There is no measured basis to promote the experimental retrieval by default from this run.

## Open evidence and release dependencies

- Joseph's current authoritative enterprise corpus and gold labels, plus Sophia's independent label review, have not been provided by accessible project fixtures. Existing provisional cases support harness verification and regression only.
- PR603 remains against an older main checkpoint and currently reports mergeable=false. This local roadmap branch does not resolve or publish that remote integration state.
- Real provider identity/quality, representative load, durable continuity adapters, authenticated public capture and spending approval remain outside the executed offline evidence.
