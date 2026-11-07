# @launchstack/indexing

## 0.2.0

### Minor Changes

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.

### Patch Changes

- 52bab9f: Embeddings and paid web searches are counted alongside chat, so usage can be
  weighed in one unit.
  - `ChatUsageEvent` gains `kind` (`chat`, `embedding`, `web_search`,
    `web_contents`) and `calls` (searches made or pages read; 1 when absent).
  - New `reportUsage(event)` counts work that never passes the chat transport
    against the current chat scope's recorder. Outside a scope it does nothing;
    it never throws.
  - The embedding client reports every successful request with the provider's
    token count, or an estimate of four characters a token when the provider
    sends none (Gemini, Ollama, Hugging Face). `EmbeddingConfig.owner` and the
    effective config's `openAIOwner`, `huggingFaceOwner` and `ollamaOwner` say
    whether the deployment's endpoint or a workspace's own served it.
  - Web search reports each answered request: one search for Exa and Serper
    (general, news and company search), and the pages asked for when Exa reads
    company homepages. Failed requests report nothing.
  - Ingestion's embedding debit carries the embedding model in its metadata, so
    the host can price it.

- Updated dependencies [fafd939]
- Updated dependencies [c8750e4]
- Updated dependencies [1237451]
- Updated dependencies [3a4d012]
- Updated dependencies [2c09443]
- Updated dependencies [bb64f34]
- Updated dependencies [ee41d64]
- Updated dependencies [ba11446]
- Updated dependencies [fc83cb5]
- Updated dependencies [290483e]
- Updated dependencies [52bab9f]
  - @launchstack/conversion@0.2.0
  - @launchstack/llm@0.2.0
  - @launchstack/store@0.2.0
  - @launchstack/orchestration@0.2.0
  - @launchstack/runtime@0.2.0
