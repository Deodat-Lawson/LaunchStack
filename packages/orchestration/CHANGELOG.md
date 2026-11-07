# @launchstack/orchestration

## 0.2.0

### Minor Changes

- ee41d64: A missing embeddings configuration fails a document once instead of retrying it.
  - The outbox treats an error whose own `retryable` property is `false` as
    terminal: the event goes dead on that attempt through the existing dead path
    (`onDead` runs once), instead of backing off through every retry.
  - `@launchstack/llm` throws `EmbeddingConfigurationError` (non-retryable) when
    the embeddings API key or base URL is missing. The messages are unchanged.
  - `OutboxStore.reclaimStale` accepts an optional `onDead` callback, so events it
    kills after their final attempt are stamped as failed too.

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.

### Patch Changes

- Updated dependencies [2c09443]
- Updated dependencies [bb64f34]
- Updated dependencies [ba11446]
  - @launchstack/store@0.2.0
  - @launchstack/runtime@0.2.0
