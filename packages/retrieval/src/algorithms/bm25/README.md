# bm25 — lexical ranking

**What it is.** Keyword relevance over document chunks. Two layers share this
folder: SQL-side candidate fetch (current-version chunks scoped to a
document, a company, or a document set) and in-memory BM25 ranking over
those candidates via LangChain's `BM25Retriever`.

**How it works.** BM25 scores a chunk by how often the query terms appear in
it (term frequency, saturating), how rare those terms are across the corpus
(inverse document frequency), and how long the chunk is (length
normalization). It needs no embeddings, no model call, and no index beyond
the chunk rows themselves — the fetch joins through `document` so only the
current version's chunks are ever ranked.

**When it wins.** Exact identifiers, names, codes, and rare terms — the
queries where semantic similarity is too fuzzy. It is also the ensemble's
fallback when vector search fails, because it cannot lose the query's own
words. It loses on paraphrase and synonymy; that is what the vector leg is
for.

**Knobs.** `topK` per creator. The ensemble hands each leg
`topK × RERANK_CANDIDATE_MULTIPLIER` candidates and fuses ranks downstream.

**Surface.** `create{Document,Company,MultiDoc}BM25Retriever`, plus the raw
chunk fetchers (`get*Chunks`, `chunksToDocuments`) the fallback path reuses.
