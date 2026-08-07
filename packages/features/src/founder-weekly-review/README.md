# Founder Weekly Review Lifecycle

This module owns LAU-5 persistence and lifecycle foundations for company-scoped Founder Weekly Reviews.

## Tables

- `pdr_ai_v2_founder_weekly_review_runs`: one lifecycle row per review run.
- `pdr_ai_v2_founder_weekly_review_operations`: feature-scoped idempotency operations, currently `retry`.

## Statuses

- `queued` -> `generating` -> `draft` -> `published`
- `queued` -> `failed`
- `generating` -> `failed`
- `failed` -> `queued` via retry
- `draft` -> `draft` via manual edit
- `published` is terminal and immutable

## Immutable fields

- Always immutable after create: run ID, company ID, create request key, reporting period, evidence snapshot, evidence schema version, creator actor ID.
- Also immutable after publish: review payload, model metadata, lifecycle result fields.

## Idempotency

- Create idempotency: unique `(company_id, request_key)` on the run table.
- Retry idempotency: unique `(run_id, operation_type, request_key)` on the operations table, with the source failure sequence recorded to reject stale delayed retries from older failure cycles.

## Service APIs

- `FounderWeeklyReviewUserService`
  - `createOrGetRun`
  - `getRun`
  - `listRuns`
  - `retryFailedRun`
  - `updateDraft`
  - `publishDraft`
- `FounderWeeklyReviewWorkerService`
  - `claimQueuedRun`
  - `saveGeneratedDraft`
  - `markGenerationFailed`
  - `markQueuedRunFailed`

## LAU-7 confidence semantics

V2 generated items use numeric `confidence` from 0 through 1. It measures how
strongly the generated review claim is supported by its cited supplied evidence.
It is not a confidence score for the truthfulness or reliability of an
underlying database row or source record. Unsupported claims must be omitted or
represented as `no_evidence`; they must not be emitted with an arbitrarily low
confidence value.

## Company isolation

Every repository method accepts `companyId` explicitly and includes it in SQL predicates. Wrong-company access resolves as not found rather than leaking existence.

## Contract versions

- Evidence snapshots: existing `founder-weekly-review-evidence/v1` and current `founder-weekly-review-evidence/v2` with deterministic document-change audit provenance
- Review payload: `founder-weekly-review/v1`

## Evidence collection (LAU-6)

Evidence `sourceType` is a provenance and citation-safety classification, not a
generic document label. The production collector currently emits:

- `document_change` for every company-scoped document version created in the
  reporting period;
- `customer_feedback` for cited, exact-version sections of documents whose
  stored category is exactly `Customer Feedback`; and
- `founder_context` for non-empty request-time founder input, with the actor
  and stable request/context entry identity retained as provenance.

`manual_note` is intentionally not collected: notes are user-owned and the
current schema/API has no workspace-visible sharing policy. `github_activity`
is intentionally not collected: the repository has GitHub archive upload and
repo-explainer flows, but no company-scoped commit/PR event model.

Every snapshot has globally unique `sourceId` values because citations refer to
bare source IDs. Exact duplicate items collapse; conflicting duplicates fail
collection. Optional-source absence and result truncation become bounded source
warnings, while successful evidence remains in the snapshot. The evidence
collector acquires and normalizes evidence only; it does not own review
lifecycle, dispatch, persistence, or generation.

## Current V1 product decision

Multiple runs are allowed for the same company and reporting period. LAU-5 does not enforce period uniqueness or a single published review per period.

## Deferred scope

- LAU-6: evidence collection
- LAU-7: structured review generation is provider-agnostic and consumes the
  canonical evidence snapshot. It emits `founder-weekly-review/v2`; v1 payloads
  remain readable for backwards compatibility. Citation validity is checked
  against the supplied snapshot after structured-output parsing.
- LAU-8: workflow orchestration
- LAU-9: HTTP APIs
- LAU-10: dashboard/UI
- LAU-11: readiness and source management UX
