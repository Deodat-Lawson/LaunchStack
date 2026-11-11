---
"@launchstack/orchestration": minor
---

Add the `storage.deletion.requested` event, its deterministic request-scoped id,
and the required `StorageDeletionPort` processor dependency. Storage deletion
plans run through the transactional outbox and its existing retry/dead-letter
lifecycle without coupling provider cleanup to relational deletion.
