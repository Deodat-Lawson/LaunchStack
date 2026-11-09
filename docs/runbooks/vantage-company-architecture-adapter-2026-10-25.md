# Vantage Company Profile → Company Architecture adapter — 2026-10-25

Implemented after the factual-grounding task was tested and committed as **98c8eaeca1606e86e638a815c408410e735fe141**. This adapter is a separate local commit, recorded in the final delivery and ignored final-commit-task2.json artifact. It reads the existing canonical Company Profile, produces actor-authorized V0 source records, and demonstrates real PostgreSQL → registry → manifest integration. It is not imported by default Vantage generation.

No profile ingestion, extraction, synthesis or persistence was duplicated. No new table, review workflow, model call, production route, Contract v1 change, Joseph/Sophia interface change, push or merge.

## Exact files

| File                                                                       | Change                                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| pipelines/src/vantage/context-v0/company-architecture.ts                   | Pure deterministic projection, provenance/permission/version checks, explicit missing fields, fingerprints and V0 source records. |
| pipelines/src/vantage/context-v0/company-architecture.test.ts              | 51 focused tests.                                                                                                                 |
| pipelines/src/vantage/context-v0/index.ts                                  | Additive export of the opt-in adapter.                                                                                            |
| apps/web/src/server/vantage/company-architecture.ts                        | Trusted server capture, native bounded SQL, fresh document ACLs, sealed snapshots, stale checks and guarded transaction.          |
| apps/web/**tests**/server/vantage-company-architecture.test.ts             | 24 host security/budget/lifecycle tests with database and session doubles.                                                        |
| apps/web/**tests**/server/vantage-company-architecture.integration.test.ts | 16 real PostgreSQL profile/source/document/ACL/guard cases.                                                                       |
| scripts/dev/vantage-integration-tl-test.mjs                                | Add the new PostgreSQL suite to its existing fixed allowlist. No credential, Docker or production behavior changes.               |
| docs/design/vantage-company-architecture-adapter-v0.md                     | Preserve the original audit and add a follow-up clarifying implemented availability versus review policy.                         |
| docs/runbooks/vantage-company-architecture-adapter-2026-10-25.md           | This implementation report.                                                                                                       |

## Existing data reused

company_metadata is the existing per-company canonical JSON. company_profile_sources retains per-document extracted facts, reader/model identity, source role/override, exact version, read time and cache state. Existing build.ts runs triage/extraction, assemble.ts merges counted sources and preserves manual edits, and synthesize.ts creates summary/applicant/focus fields from cited facts.

The adapter reuses flattenFacts, labelFor, confidence/schema/reader constants and the existing metadata shapes. It does not call build, extract, synthesize, retrieval, public research or an LLM. It reads canonical tables directly for row identity, bounded JSON and native transaction support; it does not consume the display DTO, which strips provenance and has weaker ordinary merged-fact filtering.

Supported fields include company identity/description/industry, markets, services, projects/subprojects, documented personnel/roles/responsibilities, profile facts and relevant policies/legal constraints. Names gate grouped fields, and their provenance is unioned with field provenance. Contacts and arbitrary derived_views are excluded by the declared ontology. A role title creates no decision authority, hierarchy or responsibility assignment.

Absent optional fields become explicit unknown codes. Identity plus useful substantive authorized content is the minimum; additional requiredFactPaths are additive and cannot remove it. Missing, empty, unsupported-schema, post-cutoff, not-built, building and failed profiles block explicitly. No new facts are generated to satisfy requirements.

## Mapping to V0

projectCompanyArchitectureV0(snapshot, options) returns an available/partial/blocked result. An available projection supplies:

- CompanyArchitectureRefV0: kind company; stable ID company-metadata/<companyId>; canonical true; actor-bound deterministic version company-profile-v0:<sha256>; reviewState unreviewed.
- RequiredCompanyArchitectureSourceV0: existing required/canonical/company-audience fields, authenticated company, checked access, ACL digest, source/check times and bounded excerpt.
- TrustedContextSourceV0: identical authorized content/excerpt, exact SHA-256 contentHash, company-metadata provenance and internal locator. Accepted by createSourceRegistryV0.

This does not construct Joseph's RequiredContextBundle or declare all mandatory documents/stars complete. A partial projection can expose only safe authorized content for inspection/registry use; it has no requiredEntry or top-level required flag and cannot pass the host's required-context commit gate. An available source describes useful, safe coverage, not human approval.

There is no trustworthy whole-profile approval receipt in the current schema. The adapter always uses unreviewed. Manual overrides are human-entered accounts, not profile approval; source override about_us is an inclusion choice. Unknown fields do not automatically produce unknowns-marked. reviewed/unknowns-marked remain reserved for a future explicit trusted policy/record; this task invents neither.

## Actor authorization and provenance

The server factory resolves requireWorkspaceContext, copies and pins primitive auth identity/company/user PK and permissions, and freshly calls resolveDocumentScope. It deliberately bypasses the request-memoized ctx.documentScope promise.

Backing documents are read with scopedDocumentWhere and checked again with scopeAllows. Exact company, current version and version.documentId must match. All raw backing IDs are collected before ontology or quote limits; unsafe legacy numeric IDs and dependency overflow fail closed.

Every positive document dependency of a fact must be authorized, current and backed by a ready, current-reader source row. This applies to ordinary merged facts, synthesized fields, quote-less dependencies, grouped subject names, and manual_override facts that retain document refs. One visible citation cannot authorize a fused value. Denied/missing/foreign/stale dependencies withhold the whole fact; diagnostics reveal generic codes/counts rather than hidden values, titles or IDs.

Original document/version IDs, quotes, snippet refs, pages and extraction times are preserved when available. A reserved manual doc_id 0 remains a labeled human assertion with null document version/snippet/page. Citations grant no access and are not independent proof of truth. Missing historical versions are never replaced with today's version.

## Fingerprints and lifecycle

Canonical identity is the existing company singleton. The source version binds:

1. Full profile and observed native dependency state, including semantic JSON, provenance, source cache state, exact versions and native metadata fingerprints.
2. Exact authorized projected content.
3. Actor identity and current authorization/access state.

ContentHash hashes the exact excerpt; volatile checkedAt does not change content identity. Actor-bound versioning prevents reusing one user's projection as another user's source. The canonical/dependency fingerprint describes the observed scoped snapshot; it is not a global cross-actor profile revision counter.

The host exposes createCompanyArchitectureAdapterV0 with injectable trusted workspace/database/scope/clock functions, and capture, assertFresh and guardedCommit methods. Capture accepts window/budgets, not client-selected actor authority. Captures are deeply frozen, owned by a private WeakMap and usable only by their factory. Serialized clones, forged captures and foreign transaction objects are rejected.

Both capture and final commit run short native transactions with SHARE locks on profile/source/document/version/category and relevant membership/role/group/grant tables. This prevents inserts, deletions, folder moves and ACL changes from racing the scoped read. Authorization is refreshed inside the lock window. Timers reject inside the transaction; post-await checks prevent late authorization results from issuing further native reads. Lock/statement/deadlock errors fail closed.

guardedCommit re-reads the snapshot in its owned transaction, rejects any fingerprint/identity drift, then invokes the trusted persistence callback with that same transaction. Callback failure rolls back. No model runs under these locks. The callback must be short transaction-aware report persistence; it must not invoke a nested independent save transaction or perform model/network work.

Observed limits: 1 MiB canonical profile, 128 backing documents, 64 KiB per source-cache row, 512 raw facts, at most three adapter-native data queries, 12,000 excerpt characters, and the explicitly passed V0 token/source budgets. Host wall/statement timeout is at most five seconds; lock timeout at most one second. Authorization resolution uses the existing platform reads separately. UTF-8 bytes provide a conservative token upper bound for the projected source; no tokenizer usage is claimed. Oversized or ambiguous required content blocks rather than silently becoming complete.

## Actual PostgreSQL → V0 example

The final saved demonstration is [actual-pg-profile-assembly-20261025T183255083Z-67fc47ba-29dc-4dfc-8e9e-16d4f0cc7dcd.json](../../test-output/company-architecture-adapter/20261025T180618Z/actual-pg-profile-assembly-20261025T183255083Z-67fc47ba-29dc-4dfc-8e9e-16d4f0cc7dcd.json).

It reads real synthetic company_metadata/company_profile_sources/document/version/ACL rows and produces:

- Name: Synthetic authorized company.
- Description: Builds invoice verification software for pilot operators.
- Mission: Make invoice verification testable before pilot access.
- Unknown industry, responsibilities, priorities, markets/services/projects/personnel, hierarchy and decision authority where no fact supplies them.
- Projection status available; reviewState unreviewed; exact native source versions.
- Real createSourceRegistryV0 and assembleContextManifestV0 acceptance, one selected company source and matching companyArchitectureVersion.

The manifest is complete only for the fixture's declared coverage. Session/cookie identity, business-role mapping, required document/star coverage and empty retrieval decisions are explicitly labeled doubles. This does not prove those unfinished production modules or a full production V0 generation. No AI call was made for the adapter.

The same suite proves hidden/foreign manual-source values are withheld, revocation and mutations reject stale captures before callback, source/document deletion invalidates context, historical reports/actions remain unchanged, callback failure rolls back and a concurrent ACL writer waits until guarded persistence commits.

## Validation and reproduction

All new outputs/logs are synthetic-only and ignored under **test-output/company-architecture-adapter/20261025T180618Z/**. Exact commands, durations and exit codes are in logs/\*.json.

| Check                                                 | Actual result                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Pure adapter tests                                    | 51/51 passed.                                                                    |
| Host security/lifecycle tests                         | 24/24 passed.                                                                    |
| Full targeted generation/history/Contract v1/V0 suite | 325/325 passed, 17 files.                                                        |
| Fixed real PostgreSQL pipeline suite                  | 85/85 passed, including 54 repository cases.                                     |
| Fixed API/auth/adapter suite                          | 219/219 passed, including all 16 new actual PostgreSQL adapter cases.            |
| Pipeline/web TypeScript                               | Passed.                                                                          |
| Scoped pipeline/web ESLint                            | Passed; pipeline lint emits existing generic root React/Next discovery warnings. |
| Task 2 model calls                                    | Zero.                                                                            |

Counts overlap; do not sum them as unique tests. PostgreSQL is the existing isolated localhost:55437/vantage_week2_tl_contract_v1 database. Migrations were already current; no table or migration was added. Only newly created fixture rows are cleaned up; old reports, actions, source artifacts, worktrees and credentials are preserved.

```powershell
pnpm --filter @launchstack/pipelines test src/vantage/context-v0/company-architecture.test.ts src/vantage/context-v0 src/vantage/proposals/context-v0.test.ts
pnpm --filter @launchstack/web test --runInBand __tests__/server/vantage-company-architecture.test.ts
pnpm --filter @launchstack/pipelines typecheck
pnpm --filter @launchstack/web typecheck
pnpm exec node scripts/dev/vantage-integration-tl-test.mjs
```

The integration suite refuses a non-test database and saves each authorized synthetic projection artifact with a unique filename. It never treats a citation as permission and never starts the app or calls an AI.

## Exact remaining integration dependencies

1. **Joseph:** production resolveBusinessRoles/resolveRequiredContext, required workspace documents and personal Vantage stars, their versions and coverage. Company Profile role text must not become business-role authorization.
2. **Sophia:** production dynamic retrieval over the same trusted source catalog and requesting actor. The adapter adds no second retriever.
3. **TL:** compose this source with those ports, enforce partial/blocked required-source outcomes, freeze/revalidate context before and after generation, and supply a genuine context-aware generation adapter. Current v1 generation still consumes its existing native evidence; it does not yet read this company source.
4. **TL/persistence:** bind the existing V0 guarded-commit port to a transaction-aware Vantage save using the provided native transaction. The current v1 save opens its own transaction; nesting it as an independent callback would not provide atomic rollback with this guard.
5. **Profile producer:** synthesize.ts unionSources retains extra quote-less document dependencies beyond twelve quotes but drops their version_id/snippet metadata. The adapter conservatively withholds affected fields. Preserve exact original overflow-dependency versions upstream before those fields can satisfy mandatory architecture; do not backfill current IDs.
6. **Review policy:** if product policy requires reviewed or unknowns-marked architecture, an existing-schema-compatible trusted review capability is still needed. This adapter deliberately remains unreviewed and introduces no approval workflow.
7. **Platform/TL:** validate database locking privileges and concurrency/load impact before activation. Fourteen table-level SHARE locks briefly block writers across tenants. Future finer-grained guards require a coordinated writer/version strategy, not an unlocked fallback.
8. **Snapshot/version policy:** native OCR JSON is hashed in SQL to catch in-flight same-version changes without transferring its body. documentVersions lacks immutable OCR payload history/update timing, so exact historical payload reconstruction is unavailable. The adapter does not fetch blobs or re-verify quotes. Out-of-band blob changes without a DB/version change cannot be detected here.
9. **Worker integration:** host captures are process/factory-local. Durable jobs need a trusted worker actor resolver and fresh capture/revalidation strategy; a serialized client capture is not accepted authority.

Existing Company Profile display filtering remains unchanged; this adapter independently enforces the stricter all-source rule.

## Overall pipeline status and next step

The existing v1 weekly generator, Rolling Carry-Forward and factual-state patch pass regression tests. Company Architecture projection, server authorization and guarded persistence are implemented as an opt-in seam and exercised with real persisted profile data. Production V0 required-context/retrieval/generation/persistence composition remains pending and is not activated.

The next integration step is a TL-owned synthetic V0 path combining this company source with Joseph's verified required-context resolver and Sophia's registered retrieval results, then a context-aware generation envelope and same-transaction guarded save. Exercise ACL/profile drift through that whole path before enabling it for production actors.

Part A details and live outputs are in [the factual-grounding report](vantage-factual-grounding-2026-10-25.md). Both commits remain local.
