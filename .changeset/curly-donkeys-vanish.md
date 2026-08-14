---
"@launchstack/core": minor
---

Remove the phantom sidecar inference surface (ADR-004 §5).

The sidecar embed/rerank/NER providers called `${SIDECAR_URL}/embed`,
`/rerank` and `/extract-entities` — routes no service in this repository ever
implemented — and the default compose stack auto-selected them, 404ing at
runtime. They are removed, not stubbed:

- `providers/ner/sidecar` and `providers/reranking/sidecar` are deleted;
  `getNERProvider()` always returns the LLM-based extractor and
  `getRerankProvider()` always returns a cloud provider (the dedicated
  `/v1/rerank` client when `RERANK_API_BASE_URL` is set, otherwise the
  chat-model scorer).
- `providers/registry`: `resolveRerankProvider` / `resolveNERProvider` are
  deleted, and `ProvidersRegistryConfig` loses `sidecarUrl` and the
  rerank/NER mode and base-URL fields — a service URL can never select a
  provider mode again. `resolveTranscriptionProvider` remains: "sidecar"
  there names the real services/transcription deployment and is only chosen
  by the explicit `TRANSCRIPTION_PROVIDER` override. `isCloudMode()` now
  always returns true.
- Embeddings: `SidecarEmbeddings`, `configureEmbeddingFactory`,
  `EmbeddingFactoryConfig`, the `"sidecar"` member of `EmbeddingProvider`,
  the `sidecar-default` index, and `EmbeddingsConfig.sidecar` /
  `SidecarEmbeddingConfig` are deleted.
- `ocr/trigger`: `triggerDocumentProcessing` and `DOCUMENT_PROCESS_EVENT`
  are `@deprecated` (replaced by the transactional outbox, ADR-003) but kept
  for external consumers who wire their own `JobDispatcherPort`.
- RAG retrievers now include `versionId` (the document's current version) in
  chunk metadata so citations can be anchored to an immutable source version
  (ADR-005); `BaseSearchMetadata`/`ChunkRow` gained the optional field and
  the unused `"experimental_vector"` retrieval method was dropped.
- The `document_embeddings_exp` table remains in the schema (additive-only
  migrations) but is documented as unused.
