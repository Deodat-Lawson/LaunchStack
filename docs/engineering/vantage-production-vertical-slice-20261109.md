# Vantage Weekly Review production integration

Branch: integration/vantage-production-vertical-slice-20261109.
Starting main/integration SHA: eb91aa7bd198b6e119e778ce1f91890eecdfdf2a.
Reference M3 SHA: 1a3bec58b6abcaa76151bb2aca67727d48e358dc.
Fresh standalone clone; no objects borrowed from the damaged desktop checkout.
No production deployment, merge, or live Vantage Generation/Judge call. An inherited CI job ran an unrelated real embedding evaluation; the spending-boundary incident is disclosed below.

## Canonical application path

The existing Vantage workspace tool's home and agenda entries mount WeeklyReviewEntry.
When VANTAGE_WEEKLY_REVIEW_ENABLED is true, this is the canonical V2.1 flow:
Better Auth -> active company membership/capabilities -> server-owned policy and
personal preferences -> authorized versioned document context -> bounded optional
document retrieval -> frozen dependency metadata/hash -> one V2.1 Generation ->
deterministic contracts -> separate Sophia full-output Judge -> authority-checked
encrypted immutable run -> active pointer CAS -> authorized readback -> append-only
human decision and version/idempotency receipt.

POST /api/vantage/reviews generates; GET lists actor-private metadata and selected
week activeId. /:id reads; /:id/decisions records human review; /:id/restore performs
authorized pointer rollback; /:id/recover expires uncertain reservations after
120 seconds. /context manages admin company policy and actor-specific stars.
This is a versioned report boundary, not another demonstration host.
No fixed company, scenario week, source body, actor allowlist, or demo schema
is part of the production resolver. The only fixed test database identity belongs
to the explicitly disabled-in-production deterministic provider seam.

## Authority and product decisions

- Architecture is an admin-selected actual company-readable document, not an
  unreviewed AI metadata profile promoted into policy. Other mandatory documents
  must independently have company audience. Stars remain actor preferences.
- Current authenticated membership role is server-owned. A richer Joseph business
  responsibility/profile integration is not claimed by this initial adapter.
- Source selection is bounded, authorized document retrieval; no paid embeddings,
  benchmark, graph or retrieval-stack migration was added.
- Explicit ISO reporting weeks use an explicit UTC version-availability cutoff,
  min(generation time, week start + seven days). Main's old week helpers depend
  on process-local calendars; a product timezone change needs a versioned policy.
- A provider dispatch is admitted when its durable reservation and fresh authority
  check commit under the company epoch lock. Revocations committed before that
  admission prevent it. An already admitted/in-flight request cannot be recalled.
- AFTER mutation triggers acquire only affected company epoch rows and publish authority before the writing transaction commits. Historical
  read/decision rechecks frozen source versions and hashes without requiring
  current role/star/head equality. New dispatch/activation also require unchanged
  preparation epoch.
- Accepted report text and semantic admission evidence are encrypted with a
  company/owner/run AAD domain. Dependency JSON contains identifiers, version,
  hash and purpose, never plaintext source bodies.
- Human review records a choice. It does not autonomously create/execute actions
  or certify execution. Existing action creation still requires human tests,
  owner/date inputs and idempotency; resolution requires a human outcome.

## Checkpoints

1. Security/context authority: FWR source reads/history deletion, native CAS and
   action contracts, company epoch guards, frozen source authority, encryption
   rotation, immutable report/review storage and recovery.
2. Canonical V2.1: one model output, adapted Sophia semantic evaluation, configured
   provider path, dispatch gates, production APIs and existing-tool UI.
3. Acceptance/operations: actual synthetic PostgreSQL/authenticated HTTP/Chromium,
   failure/rollback coverage, tooling corrections, release gate and canary.

Each checkpoint is committed separately. Exact commit SHAs are reported in the PR
and final delivery; no self-referential commit hash is embedded in its own file.

## Requirement-to-test evidence

| Requirement / audit IDs                 | Implementation and executed evidence                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: source-authorized FWR reads         | read-authority module, current DocumentScope for frozen dependencies; six focused authority tests. Missing lineage fails closed; unscoped historical founder/manual text creator-private.                                                      |
| N8: history mutation capability         | generic history DELETE 403 for read-only callers, 409 retaining generated history even for authorized editors; three tests and authenticated HTTP denial.                                                                                      |
| N1/N3: required company context         | actual source audience check, separate policy/stars, full mandatory coverage and purpose in model input. Four authority tests plus actual SQL/private-star/required tests and authenticated private-required denial.                           |
| N2: dispatch/activation/read revocation | fresh actor/source epoch at each durable dispatch admission and activation; frozen-version read authority. V2.1 auth-barrier tests, PostgreSQL epoch tests and authenticated revocation denial.                                                |
| N9: tenant locking                      | real PG holds company-one epoch while company-two writes complete; same-company mutation blocks then succeeds. No global SHARE locks.                                                                                                          |
| F2/F3/F4/F5/F9/N4                       | configured V2.1 model transport, native durable receipts, explicit test/outcome, observed versions and safe status Undo. Three schema/client tests plus actual native PostgreSQL concurrency/idempotency/CAS suite.                            |
| F6                                      | outbox exhaustion atomically fails queued FWR run; seven real PostgreSQL dispatch tests. FWR workers are outside the new synchronous Vantage flow.                                                                                             |
| F7                                      | historical native enhancement finding not applicable to the new canonical report; main UI retained. No claim of M3 enhancement UI port.                                                                                                        |
| F8                                      | new path uses normalized capabilities, not owner/admin/editor string disagreement. Legacy FWR mutations also require an explicit freshly resolved mutation capability; missing or false capability is denied even for a privileged role alias. |
| N6: human review audit                  | immutable decision entries with actor/time/version/key; actual PG replay/conflict/stale tests and UI decision/reload.                                                                                                                          |
| N7: V2.1 only                           | no Native companion or carrier requested/persisted; 23 V2.1 contract tests including Judge output coverage, bad refs/numeric support, same-model refusal, failed/invalid Judge and abort-ignoring timeout.                                     |
| N10: historical availability            | actual HTTP old-head replacement and harmless preference change keep frozen report readable; revoked source denies.                                                                                                                            |
| N11: key lifecycle/retention            | retained keyring parsing and crypto tests (18 combined), report AAD and key version PG checks; frozen dependencies retained for reauthorization. No automatic plaintext attempt capture.                                                       |
| Activation/admission                    | candidate ID/report hash/error-free passing Judge required; forged/missing/failed Judge PG tests; loser cannot replace active pointer.                                                                                                         |
| Recovery/rollback                       | two-request durable flags, crash-uncertain expiry, DB-only retry, authenticated recover/restore/replay, active-pointer DB assertion, SQL downgrade retains reports and requires explicit feature-off attestation.                              |
| Real boundaries                         | one extended Chromium test uses true signup/company, actual APIs/DB, visible human decision, reload, cross-company denial, 201/409 concurrent generation and restore/recovery. Provider is deterministic, clearly labeled.                     |

## Observed failures and verification limits

- Initial offline dependency installation lacked locked Better Auth tarballs.
  Locked online installation succeeded without changing runtime dependencies.
- Initial native migration used unprefixed table names; transaction rolled back,
  SQL was corrected before successful application. No failed ledger entry hidden.
- Early browser attempts reached missing routes, unapplied recovery schema, and
  an initial two-loser concurrency failure. Corrected code/migrations and bounded
  database-only retry passed the final race (one 201, one 409).
- Restarting the synthetic app with random new auth keys broke existing synthetic
  JWKS. The acceptance runner now retains task-owned random keys under ignored
  test-output. Production keyring behavior is independently tested.
- Repeated development HMR exhausted the isolated server's connection limit.
  Dedicated app restart and source-stable acceptance passed. No max_connections
  increase or production configuration bypass was used. Production load/pool
  soak remains a release gate.
- Initial Jest route/UI suites hit @formatjs ESM loading before assertions.
  The root cause was Jest Windows path normalization doubling \w inside character classes in the pnpm ESM allowlist. Explicit ASCII classes fix it. Both formerly blocked suites now pass (23 tests); the complete FWR run passes 31 suites / 180 tests, zero skips.
- Baseline lint configuration could not resolve its React Hooks/Next plugins
  through pnpm. The existing locked Hooks plugin is declared directly; FlatCompat
  resolves Next's plugins beside its config. Final lint result recorded below.
- No live provider reliability, serving identity/independence, real dollar
  enforcement or production latency result is claimed. Configured routes fail
  closed if Generation/Judge resolve to the same model ID.

## Operations and rollback

Default kill switch is off. Enable only after reviewing the complete acceptance
record. Configure VANTAGE_WEEKLY_REVIEW_GENERATION_ROUTE (default route) and
VANTAGE_WEEKLY_REVIEW_JUDGE_ROUTE (reasoning route) to independently reviewed
different serving models. Current resolver supports default/fast/reasoning/vision.
Both transports have one attempt, zero SDK retries, bounded time/output, and
fresh dispatch authorization. Database-only serialization retries never repeat
a model request.

For an uncertain reservation, call /:id/recover after 120 seconds, then use a new
idempotency key; never reset or refund a dispatch flag. Accepted bodies cannot be
changed by recovery. Restore uses an accepted report ID, expected current active
ID and a new operation key, and checks current source authority.

Normal migrations are additive through the shared engine/product runner. Disable
the feature before code rollback; older code ignores retained new tables.
The explicit rollback SQL also requires the database session attestation
app.vantage_weekly_review_enabled='off'. It is not an automatic Node environment
check. If authority triggers are removed, do not re-enable the new path until
they are reinstalled and verified. Never drop accepted reports to roll back code.

Rotate with SECRET_BOX_CURRENT_VERSION and SECRET_BOX_PREVIOUS_KEYS while keeping
old key material securely available. Do not log these values. Restore procedures
must restore the keyring together with encrypted data. Source deletion/revocation
withholds reports; retained audit ciphertext is not automatically erased. A final
retention schedule and authorized purge policy remains an operator/product decision.

## Bounded live canary still required

Separate spending approval must name exact serving endpoints/model identities,
independence evidence, authorized source versions/cutoff and maximum billable
input/output/other tokens with applicable rates. Run one Generation and one Judge,
zero repairs/retries, no embeddings/research, against a synthetic authorized company.
Verify real wire usage/response IDs, deterministic and semantic admission, encrypted
save, authorized UI readback and a human decision. An invalid or unjudged result
must leave the last accepted report active. No launch readiness claim follows from
deterministic provider acceptance alone.

Legacy V1 compatibility: creator-private manual reports remain readable without reinterpretation. Native V1 document-derived reports lack a reliable immutable dependency registry; the compatibility reader withholds those rather than inventing source authority. Legacy report exports and overview bodies use the same guard. Legacy raw capture/sharing policies are not expanded by this work.

## Final verification and release gates

Checkpoint 1: 07131ea0db7277871fded2f77d2dcd41f4720e6a.
Checkpoint 2: fba7771e (full SHA in Git). Additional review corrections: 28541d03.
The final acceptance commit follows these; Git history is authoritative.

| Check                                        | Actual result                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web TypeScript                               | PASS; production build also performs type validation                                                                                                       |
| Pipeline TypeScript                          | PASS                                                                                                                                                       |
| Changed TS/JS lint                           | 88 files, zero errors, 16 warnings; narrow review corrections separately zero errors                                                                       |
| V2.1 contract/admission                      | 23 tests PASS, including zero-dispatch evaluator preflight, abort-ignoring timeout and failed Judge                                                        |
| Existing signals/week/update/CSV             | 22 tests PASS                                                                                                                                              |
| Focused crypto/history/action/legacy guards  | 6 suites / 39 tests PASS                                                                                                                                   |
| Full FWR regression with isolated PostgreSQL | 31 suites / 180 tests PASS, zero skipped                                                                                                                   |
| Formerly blocked FWR route/native one-click  | 2 suites / 23 tests PASS after Windows ESM correction                                                                                                      |
| Authority and real PostgreSQL                | 2 suites / 7 tests PASS; includes configuration-demotion barriers, per-company concurrency, forged admission, restore and recovery                         |
| Native action real PostgreSQL                | 1 integration test PASS with concurrent receipt/CAS/action assertions                                                                                      |
| Authenticated HTTP/Chromium/PG               | 1 extended test PASS; final post-CI-correction repeat 1.4 minutes against final AFTER guards, with exact encrypted snapshot and registry assertions        |
| Production build                             | PASS, including PDF worker prebuild, optimized compile, type validation, 202 static pages and traces; feature/test-provider flags false                    |
| Migration up and safe rollback               | 6 engine + 50 product migrations applied through official runner; isolated guarded downgrade preserves accepted rows, blocks absent/on feature attestation |
| Diff whitespace                              | Four trailing-blank-line notices in newly introduced SQL migrations remain; applied migration bytes were preserved rather than rewriting checksums         |

Counts overlap across focused/full runs and are not added into a fabricated total. Local verification did not run the entire monorepo suite or representative load. The first remote CI run additionally passed full-repository lint, all workspace type checks, generated wire schemas and existing feature/orchestration PostgreSQL suites; follow-up status is recorded below. Lint warnings include retained fixture unused symbols, legacy UI unused helpers, import-type style and an ignored config notice. No lint/security rule was disabled.

A bounded independent pre-PR review found two issues, both corrected: admin-to-member demotion before company policy update (fresh capability now required under lock, with a matching preference barrier), and evaluator-incompatible context that could consume Generation before failing (shared evaluator preflight and conservative dynamic report-byte bound now precede dispatch). Full frozen input and registry are retained only inside the encrypted accepted envelope; external dependency metadata omits source text.

This PR stays Draft and is not a production-ready/deployed claim. Before launch: obtain spending approval and run the bounded real-model canary; verify actual serving identities and independence, pricing and worst-case cost; agree company context and UTC reporting policy; review the richer business-role/profile gap (membership role is the current trusted input); set retention/purge policy and rehearse operator restore with the real keyring; run representative production pool/load checks and CI. The observed HMR pool exhaustion was isolated to repeated development reloads and is not a measured production SLO.

The new path is off by default. When enabled, legacy V1 Generation is rejected; protected V1 historical readers remain. When disabled, legacy main behavior remains subject to the added source/ownership guards. This flag/rollback behavior must be reviewed explicitly for rollout. There is no automatic action execution.

## CI follow-up after Checkpoint 3

Checkpoint 3 was committed as 7d8b4f90. Its first remote CI run exposed missing
snapshots and a bigint-default serialization error in schema reconstruction.
The follow-up adds the three snapshot states (49 journal entries / 49 snapshots),
uses an equivalent SQL bigint default, and matches TypeScript constraint names
and physical column order to the already-applied SQL. Applied migrations 46–48
were not rewritten. Official journal/check/generate gates now pass with no drift.

The sequential engine/product Drizzle pushes also exposed a serial-sequence
filtering failure. A CI-only, guarded combined schema config reconstructs both
sets in a newly created empty test database. Production migration runners remain
separate. A hash-pinned helper adds only the immutable authority function and
trigger definitions that Drizzle cannot model. The full schema comparison still
includes functions, triggers, sequences, constraints and indexes; no object class
is filtered out. Three helper tests verify selection and fail-closed rejection of
tampering. The forward DDL gate uses top-level migration paths matching the journal
runner; the separate guarded operator rollback is not a forward migration.

Fresh isolated PostgreSQL reconstruction passed: migration-built and TypeScript-
built schemas have identical 4,186-line normalized dumps, SHA256
D2243AED3540C1599A9B2B8E7BDE065A3E01B6D3F33A377DAF5A481FC696E6A8.
Only the existing CI exclusions for migration ledgers, comments, SET and dump
restriction tokens were applied. Full source and authority guards were retained.

GitGuardian flagged the browser fixture's password template at line 31, incident 39876019. It was already generated randomly per run, not a reusable credential.
The fixed template fragments were removed; cryptographic random generation is
preserved. No scanner finding was dismissed and no ignore rule was added.
The dedicated synthetic PostgreSQL prerequisite is now wired into CI so the new
authority suite runs rather than failing for a missing environment variable.

N5 remains an explicit launch gate: request/token limits do not establish an
enforceable monetary budget. No live Vantage canary was authorized or dispatched. The unrelated CI embedding dispatch is disclosed below; its monetary cost is unverified.

Final post-correction verification: extended authenticated Chromium acceptance
passed in 1.7 minutes; the production build passed again (optimized compile,
type validation, 202 static pages and traces). The task-owned app server was
stopped. Matching CI commands also passed locally: one authority PostgreSQL suite
and 24 pipeline tests (23 V2.1 plus one real PostgreSQL native action test).
Targeted lint of the changed TypeScript passed; the two helper .mjs files are
ignored by the existing lint configuration and instead pass their Node tests.
The updated branch requires a fresh remote CI run; GitHub checks remain the
authoritative current status and are not implied green by local results.

## Full-suite reconciliation and final authority protocol

The first remote complete web run reported 676 passed suites, eight failed and
one skipped (7,841 passed tests, 25 failed and one skipped). Those failures were
not hidden. Four old native route/component suites still expected unsafe direct
commitment creation, invented dates, or destructive Undo. They now exercise real
decision/outcome dialogs, observed versions, in-flight duplicate prevention and
archive-required refusal: 38 tests pass, zero skipped. Locale fixtures now carry
the current version/idempotency contract, and the workspace-model scope registry
records the real service scope: those two suites pass all 18 tests. The missing
dedicated PostgreSQL prerequisite was fixed in CI separately.

The remaining failure was a real document-version creation deadlock caused by
the new BEFORE authority trigger on INSERT ON CONFLICT DO NOTHING. A retry held
the epoch while waiting for the document; a version writer held the document and
waited for the epoch. It was reproduced red on the isolated database. Additive
migration 20261109230000_vantage_authority_after_write.sql changes all 15 guards
to AFTER row triggers. Only actual mutations acquire the epoch, still inside the
same writing transaction before commit. Dispatch admission remains ordered against
committed revocations. No global locks were added; no general impossibility of
multi-row deadlocks is claimed.

The exact failed race is green, all 19 document-lifecycle PostgreSQL tests pass,
and the seven authority tests pass on the final AFTER protocol. The latter also
asserts that a no-op conflict insert does not bump the epoch. Journal/snapshot
count is now 50, official generation reports no drift, and the complete physical
schema comparison remains identical (4,186 lines, final SHA256 above). The strict
helper includes the immutable additive upgrade; all six helper tests pass.
Final authenticated Chromium acceptance passes again in 1.4 minutes on these
guards. The task-owned app server is stopped. Application TypeScript passes;
application source is unchanged from the last successful production build.

All eight formerly failing CI suites were then rerun together against the final
protocol: 76 tests passed, zero failures or skips, in 14.364 seconds. The current
full web TypeScript check also passed. Four SQL EOF blank-line notices remain
across the immutable applied migrations; these are recorded rather than changing
their already-applied bytes and pinned checksums.

## Spending-boundary incident and unresolved scanner finding

The inherited generic CI job supplied OPENAI_API_KEY from repository secrets.
Its unrelated mindmap-embedding-quality evaluation ran three tests configured for
text-embedding-3-large in workflow 42697415603, around 2026-11-09 21:04 UTC.
This was not authorized by the implementation task. Provider billing, request
count and token usage were not captured or verified; no zero-spend claim is made.
Vantage Generation/Judge acceptance continued to use deterministic responses.

On discovery, follow-up workflow 42700311524 was cancelled; its logs contain no
mindmap evaluation. Generic PR checks now receive only a placeholder OpenAI key,
and the existing paid embedding evaluation requires RUN_LIVE_EMBEDDING_EVAL=1
plus configured credentials after separate spending approval. CI explicitly sets
both that flag and RUN_LLM_BENCHMARK to zero. The embedding suite's three tests
are deliberately deferred, not reported as passing; the existing campaign-model
benchmark also remains deferred. No security check was disabled or dismissed.

GitGuardian still reports the historical synthetic-password occurrence 311459900,
incident 39876019, from ancestor 7d8b4f90. Latest code uses a random-only value,
but the scanner examines commit history. The incident remains Triggered and
unresolved; no history rewrite, scanner exception or false-positive dismissal
was performed. This PR remains Draft and must not be treated as green CI.
