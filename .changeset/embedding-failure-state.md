---
"@launchstack/orchestration": minor
"@launchstack/llm": patch
---

A missing embeddings configuration fails a document once instead of retrying it.

- The outbox treats an error whose own `retryable` property is `false` as
  terminal: the event goes dead on that attempt through the existing dead path
  (`onDead` runs once), instead of backing off through every retry.
- `@launchstack/llm` throws `EmbeddingConfigurationError` (non-retryable) when
  the embeddings API key or base URL is missing. The messages are unchanged.
- `OutboxStore.reclaimStale` accepts an optional `onDead` callback, so events it
  kills after their final attempt are stamped as failed too.
