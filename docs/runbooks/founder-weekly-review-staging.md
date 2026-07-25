# Founder Weekly Review staging smoke test

Status: **pending execution**. This runbook requires an accessible staging
workspace, configured Inngest, and a configured generation provider. Never use
production evidence or commit generated review contents.

1. Create an isolated staging workspace with synthetic complete, partial, and
   empty evidence only.
2. Verify the Inngest endpoint and the configured `founderWeeklyReview` model.
3. Start a review with a fresh idempotency key and poll its run ID.
4. Verify `queued -> generating -> draft` and that every factual item cites a
   supplied source ID; customer statements must cite customer feedback only.
5. Force a safe synthetic failure, retry with a new retry key, and verify the
   same run ID/evidence snapshot is used.
6. Inspect only allowlisted logs and bounded metric labels.

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

