# Founder Weekly Review staging smoke test

Status: **pending execution**. This runbook requires an accessible staging
workspace, configured Inngest, and a configured generation provider. Never use
production evidence or commit generated review contents.

1. Create an isolated staging workspace and grant the tester an owner, admin,
   or editor membership. Add a `Customer Feedback` category document with
   processed sections; use synthetic data only.
2. Verify the Inngest endpoint and configured `founderWeeklyReview` provider.
   Submit `POST /api/founder-weekly-reviews` with a fresh `requestKey`, local
   reporting-period dates, IANA `workspaceTimezone`, and optional founder
   context. Save the returned run ID.
3. Poll `GET /api/founder-weekly-reviews/{runId}` and verify
   `queued -> generating -> draft`. Read the returned draft only after it is
   `draft` and compare every cited ID with the persisted run EvidenceSnapshot;
   customer statements may cite `customer_feedback` only.
4. Repeat with partial evidence (no Customer Feedback) and empty evidence.
   Verify explicit no-evidence customer sections, no invented facts, and that
   empty evidence performs no provider generation.
5. Force a safe provider failure in staging, then `POST
   /api/founder-weekly-reviews/{runId}/retry` with a new retry request key.
   Confirm the same run ID returns to queued, retry count increments once, and
   the stored snapshot is byte-for-byte unchanged.
6. Inspect only allowlisted structured stage logs and bounded metrics
   (`runs_created`, completed/failed, retries, citation failures, dispatch
   failures, evidence/generation durations). Do not copy source contents from
   logs or database tooling into the record.

## Result record

| Field | Value |
| --- | --- |
| Date / environment | |
| Synthetic workspace | |
| Run ID | |
| Status transitions | |
| Citation validation result | |
| Retry result | |
| Provider/model identifier | |
| Observer | |
