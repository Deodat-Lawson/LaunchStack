---
"@launchstack/runtime": minor
"@launchstack/store": minor
"@launchstack/orchestration": minor
"@launchstack/conversion": minor
"@launchstack/indexing": minor
"@launchstack/llm": patch
---

Idempotent index stage and cascade deletion for sources.

- `resetVersionIndex` (conversion) clears a version's structure, context-chunk
  and retrieval-chunk rows before the indexing stage rewrites them, so an
  outbox retry or operator replay converges on one copy of every chunk
  instead of appending another. Per-dimension embeddings now commit inside
  the chunk transaction (`storeDimensionTableEmbeddings` accepts the caller's
  executor).
- `deleteSourceCascade` (orchestration) removes a document in one
  transaction: its pending and processing outbox events become `cancelled`
  (new `event_outbox` status), its `ocr_jobs` rows are deleted, and the
  document row goes so FK cascades take versions, chunks, embeddings,
  metadata, previews, graph mentions, grants, links, chat history and views.
  It returns the stored-file URLs for the caller to delete after commit.
- `SourceGoneError` and `isNonRetryableError` (runtime): a source deleted
  mid-pipeline dead-letters on the first attempt; `runOutboxTick` honours any
  `LaunchstackError` with `retryable === false`.
- `deleteDocumentFromNeo4j` (indexing) removes a document's Section nodes.
