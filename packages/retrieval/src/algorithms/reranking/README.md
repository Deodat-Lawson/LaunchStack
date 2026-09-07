# reranking — second-pass reordering

**What it is.** An optional precision pass over the fused candidate pool:
`(query, candidates[]) → reordered candidates`, scored by a model that sees
the query and each candidate together — signal rank fusion cannot have,
since fusion only sees per-leg ranks.

**How it works.** `getRerankProvider()` resolves the configured provider:
the dedicated `/v1/rerank` client when `RERANK_API_BASE_URL` names one
(resolved by the composition root, not here), otherwise a chat-model scorer
on the deployment's endpoint (`gemini.ts`). The ensemble retrieves
`topK × 4` candidates, reranks the pool, and keeps the top `topK`.

**Failure.** Unconfigured or failing reranking is not an error: candidates
pass through in RRF order. `isRerankConfigured()` is the cheap gate the
ensemble checks before spending a call.

**When it wins.** Question-shaped queries over large candidate pools, where
near-duplicates crowd out the one chunk that actually answers. Skip it for
latency-critical paths — it adds a model call per search.
