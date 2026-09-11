# vector — semantic similarity search

**What it is.** Nearest-neighbour search over pgvector embeddings.
`retriever.ts` is the LangChain adapter, not the algorithm: it scopes the
query (document / company / multi-document), picks the embedding table for
the active index dimension, and delegates the actual ranking to a search
strategy.

**How it works.** The query is embedded with the same index configuration
the chunks were embedded under (`EmbeddingIndexConfig` from
`@launchstack/llm/embeddings` — dimension, table, legacy flags), then chunks
are ordered by cosine distance (`<=>`) with a short-vector prefilter where
the index supports it. Only current-version chunks are searched — every
query joins through `document.currentVersionId`.

**When it wins.** Paraphrase, synonymy, "what does this mean"-shaped
questions — anywhere the reader's words differ from the document's. It loses
on exact identifiers and rare literal terms, which is the BM25 leg's job.

**Strategies.** `strategies/` holds the named ANN variants (exact scan,
HNSW, IVF, prefiltered, matryoshka short-vector two-pass) — see its README
for when each applies. `similarity.ts` has the in-memory measures
(cosine, euclidean) for scoring embeddings after they've been fetched.

**Knobs.** `topK`, `SearchFilters` (semantic type, page range), and the
embedding index key per call.
