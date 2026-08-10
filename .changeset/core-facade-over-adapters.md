---
"@launchstack/core": minor
"@launchstack/adapters": minor
---

Complete the final step of ADR-002: `@launchstack/core` is now a pure
compatibility facade over `@launchstack/adapters`. Every published core
subpath keeps working and re-exports its unchanged surface (values and
types) from the adapters package; `createEngine`/`Engine` re-export from
`@launchstack/adapters/engine`. `@launchstack/adapters` absorbed the engine
implementation (db schema, ingestion, OCR, RAG, LLM, embeddings, providers,
graph, collab, guardrails, storage/jobs/credits ports) and now exposes
wildcard subpath exports; configuration is injected by the composition
roots — the moved code no longer reads `process.env`.
