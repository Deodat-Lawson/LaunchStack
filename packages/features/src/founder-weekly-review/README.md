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

## Company isolation

Every repository method accepts `companyId` explicitly and includes it in SQL predicates. Wrong-company access resolves as not found rather than leaking existence.

## Contract versions

- Evidence snapshot: `founder-weekly-review-evidence/v1`
- Review payload: `founder-weekly-review/v1`

## Current V1 product decision

Multiple runs are allowed for the same company and reporting period. LAU-5 does not enforce period uniqueness or a single published review per period.

## Deferred scope

- LAU-6: evidence collection
- LAU-7: review generation payload population
- LAU-8: workflow orchestration
- LAU-9: HTTP APIs
- LAU-10: dashboard/UI
- LAU-11: readiness and source management UX
