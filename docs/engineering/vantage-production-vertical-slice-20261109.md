# Vantage Weekly Review production integration

Branch: integration/vantage-production-vertical-slice-20261109.
Starting main/integration SHA: eb91aa7bd198b6e119e778ce1f91890eecdfdf2a.
Reference M3 SHA: 1a3bec58b6abcaa76151bb2aca67727d48e358dc.
Fresh standalone clone; no objects borrowed from the damaged desktop checkout.
No production deployment, merge, live Generation/Judge/embedding or research call.

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
- BEFORE mutation triggers acquire only affected company epoch rows. Historical
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

| Requirement / audit IDs | Implementation and executed evidence |
|---|---|
| F1: source-authorized FWR reads | read-authority module, current DocumentScope for frozen dependencies; six focused authority tests. Missing lineage fails closed; unscoped historical founder/manual text creator-private. |
| N8: history mutation capability | generic history DELETE 403 for read-only callers, 409 retaining generated history even for authorized editors; three tests and authenticated HTTP denial. |
| N1/N3: required company context | actual source audience check, separate policy/stars, full mandatory coverage and purpose in model input. Four authority tests plus actual SQL/private-star/required tests and authenticated private-required denial. |
| N2: dispatch/activation/read revocation | fresh actor/source epoch at each durable dispatch admission and activation; frozen-version read authority. V2.1 auth-barrier tests, PostgreSQL epoch tests and authenticated revocation denial. |
| N9: tenant locking | real PG holds company-one epoch while company-two writes complete; same-company mutation blocks then succeeds. No global SHARE locks. |
| F2/F3/F4/F5/F9/N4 | configured V2.1 model transport, native durable receipts, explicit test/outcome, observed versions and safe status Undo. Three schema/client tests plus actual native PostgreSQL concurrency/idempotency/CAS suite. |
| F6 | outbox exhaustion atomically fails queued FWR run; seven real PostgreSQL dispatch tests. FWR workers are outside the new synchronous Vantage flow. |
| F7 | historical native enhancement finding not applicable to the new canonical report; main UI retained. No claim of M3 enhancement UI port. |
| F8 | new path uses normalized capabilities, not owner/admin/editor string disagreement. Legacy FWR mutations also require an explicit freshly resolved mutation capability; missing or false capability is denied even for a privileged role alias. |
| N6: human review audit | immutable decision entries with actor/time/version/key; actual PG replay/conflict/stale tests and UI decision/reload. |
| N7: V2.1 only | no Native companion or carrier requested/persisted; 22 V2.1 contract tests including Judge output coverage, bad refs/numeric support, same-model refusal, failed/invalid Judge and abort-ignoring timeout. |
| N10: historical availability | actual HTTP old-head replacement and harmless preference change keep frozen report readable; revoked source denies. |
| N11: key lifecycle/retention | retained keyring parsing and crypto tests (18 combined), report AAD and key version PG checks; frozen dependencies retained for reauthorization. No automatic plaintext attempt capture. |
| Activation/admission | candidate ID/report hash/error-free passing Judge required; forged/missing/failed Judge PG tests; loser cannot replace active pointer. |
| Recovery/rollback | two-request durable flags, crash-uncertain expiry, DB-only retry, authenticated recover/restore/replay, active-pointer DB assertion, SQL downgrade retains reports and requires explicit feature-off attestation. |
| Real boundaries | one extended Chromium test uses true signup/company, actual APIs/DB, visible human decision, reload, cross-company denial, 201/409 concurrent generation and restore/recovery. Provider is deterministic, clearly labeled. |

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
  These are reported failures, not skips. Focused authority/action suites and
  real PostgreSQL/browser boundaries were executed separately.
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
