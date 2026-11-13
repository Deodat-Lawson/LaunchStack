# Vantage research policy prototype

## Status and scope

This unintegrated offline prototype implements the Phase 6 preparation boundary described in sections 7 and 8 of `test-output/implementation-vantage-production-20261109/docs/reviews/vantage-dynamic-retrieval-growth-reuse-audit-2026-11-09.md`. Its inputs are injected fixtures and its outputs are preparation records. The canonical weekly review has no import or call site for this module. The prototype contains pure functions with local SHA-256 hashing and Zod validation.

The owned implementation consists of `pipelines/src/vantage/research-decision-policy.ts` and `pipelines/src/vantage/research-decision-policy.test.ts`. This document records the scope and integration gates. Verification uses the verification-before-completion skill. An initial pnpm execution encountered a worktree temporary-file permission error. The same focused check ran successfully with the authorized worktree write escalation.

## Policy and preparation contract

`futureResearchDecision` validates a strict versioned decision with at most three gaps, bounded private rationales, exact authorized source references, bounded internal queries, approved public projection/entity/question identifiers and the four requested modes. Material internal definitions or state require internal evidence. Minor-only questions stop. Finance and Sales conflicting definitions produce an internal follow-up preparation.

The host-owned public catalog supplies public entity names, official domains and question kinds. The model selects identifiers. The host constructs the fixed `site:domain public-name question-kind` query. Private rationale, source titles, excerpts, internal queries and unrecognized model fields have no public-query interpolation path. Host catalog construction remains an authorization responsibility.

Public preparation requires an explicit provider identity, HTTPS endpoint, configuration version, recipient and approved processing purpose. A strict typed fixture grant must match the company, actor, input fingerprint, reporting cutoff, source authority epoch and policy revision. The deterministic request fingerprint covers these bindings, the provider pin, public projection, query, synthetic worst-case cost and operation limits. The grant must remain unexpired at the injected current time.

A matching hard-reservation fixture must be in the reserved state, cover the full synthetic worst-case cost and reserve exactly one attempt. Missing, malformed, unknown-usage, settled and exhausted reservations fail closed. Default authorized external spend is zero. Changed provider configuration, recipient or purpose requires fresh authorization. The cost units and fixture values provide synthetic budget checks. Actual tariff validation, currency accounting and durable ledger atomicity require production integration.

The selected preparation limits are one search call, five hits, two fetched pages and zero retries. The audit permits up to two search calls. This prototype uses the smaller fixture envelope. It returns no dispatch function, loop, credentials or provider implementation. Repeated pure evaluation can produce the same preparation. A production ledger must enforce one-time reservation consumption and prevent concurrent dispatch/replay.

## Public evidence provenance

`inspectPublicEvidence` keeps search snippets as leads. A fetched fixture needs a snapshot ID, requested and final URLs, every redirect, success status, HTML content type, capture time, exact retained body, matching SHA-256 body hash, provider/request identity, query hash and truncation flag. Every destination must match an exact host-approved HTTPS URL on the selected official domain. Credentials, custom ports, query strings and fragments are rejected.

The function parses a declared capture schema, strips unknown adapter fields, clones and freezes the snapshot and redirect list, and matches provider/request/query identity against host-supplied expected values. Admission attributes the capture as a publisher statement with `companyPolicyAuthority` set to false. Body content is untrusted data and has no mechanism to expand tool authority or spending. This function checks the captured record's integrity and temporal eligibility. Production claim validation must separately establish what a body supports, publication/event/update dates and confidence, extraction anchors, independent corroboration and conflicts between official sources.

Grant expiry, current time, request cutoff, capture/publication times and evidence windows require calendar-valid ISO timestamps with explicit offsets. The host supplies an earliest eligible capture time and reporting cutoff. Captures before that window remain stale. Captures after the reporting cutoff remain later supplements even when their publication label is earlier. Admitted historical captures require capture at or before the cutoff. A production snapshot service must mint immutable citations, persist exact retained bytes and provenance, and authenticate capture history. A caller-provided body hash and snapshot ID alone establish only fixture consistency.

## Executed verification

On 2026-11-13, the focused synthetic suite ran from `pipelines` using `pnpm.cmd exec vitest run src/vantage/research-decision-policy.test.ts`. The result was one passing file and 56 passing tests, with zero failures. The suite exercises the catalog-derived public competitor query, confidential injection rejection and payload exclusion, Finance/Sales internal follow-up, all provider and authority pin fields, missing and malformed grants, default zero spend, insufficient reservation, uncertain usage, immutable snapshots, snippet leads, exact official URL approval, unsafe redirects, altered bodies, stale captures, later-fetch historical withholding, strict calendar/offset validation, valid leap boundaries, exclusion of unknown nested adapter metadata and exact expected capture provider/request/query identities.

The focused compiler check ran with `pnpm.cmd exec tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck src/vantage/research-decision-policy.ts src/vantage/research-decision-policy.test.ts` and exited 0. These commands establish the bounded fixture behavior and the two files' isolated TypeScript compatibility. Full workspace integration, real providers, real metering and research usefulness remain unverified. Existing package-manager output warned that its legacy `pnpm.patchedDependencies` manifest field was ignored.

## Integration gates

- Keep the prototype outside the synchronous weekly-review flow until utility is demonstrated through an authorized controlled evaluation with frozen corpus, cutoff and outbound payload assertions.
- Load grants, public catalogs, current actor/source/policy authority and reservation records through trusted host services. Refresh authority before each future dispatch and every evidence admission, Generation, Judge, activation and readback.
- Implement one durable cross-stage ledger with verified tariffs, worst-case reservation, atomic one-time consumption, all-attempt accounting and explicit uncertain-usage reconciliation. Add cancellation and a separate bounded wall-clock research artifact.
- Pin the real provider and serving configuration immediately before dispatch. Apply recipient and disclosure policy to fetches, redirects, cache, telemetry, logs and errors.
- Establish an immutable snapshot store and validate claim-level support, dates, extraction, source conflicts and required-context admission. Preserve explicit uncertainty, previous accepted reports and internal-only fallback semantics.
- At dispatch, enforce the user-authorized run scope, existing grants, provider pins and operation/spend limits. All evidence reported here comes from offline synthetic fixtures.
