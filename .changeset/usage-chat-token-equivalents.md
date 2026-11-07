---
"@launchstack/llm": minor
"@launchstack/tools": minor
"@launchstack/indexing": patch
---

Embeddings and paid web searches are counted alongside chat, so usage can be
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
