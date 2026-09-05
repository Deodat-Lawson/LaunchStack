# ensemble — leg orchestration and fusion

**What it is.** The composition layer: it assembles the retrieval legs
(BM25 + vector always; knowledge-graph, user-notes and company-facts when
configured), fuses their rankings, and hands the fused list to the reranker.

**How it works.** Each leg returns `topK × 4` candidates; LangChain's
`EnsembleRetriever` fuses them with weighted Reciprocal Rank Fusion — a
chunk's score is the weighted sum of `1/(rank + c)` across the legs that
returned it, so agreement between legs beats a high rank in any single leg.
Defaults: `[0.4, 0.6]` (bm25, vector), `[0.3, 0.5, 0.2]` with the graph leg,
`+0.15` for the notes leg, `+0.2` for the company-facts leg. After fusion, the optional second-pass reranker
reorders the pool and the top `topK` survive. Every search logs a per-leg
breakdown (`Leg breakdown: chunk=…, note=…`) so a silently dead leg is
visible in the logs, not just a smaller total.

**Configuration.** Nothing here reads `process.env`. The composition root
calls `configureEnsemble({ graphRetrieval, notesLegs, factsLegs })` (see
`config.ts`): the graph flag turns that leg on (backend picked per call —
Neo4j when configured, Postgres fallback otherwise); `notesLegs` and
`factsLegs` inject the app-owned notes and company-facts retrievers, which
live in product schema this package cannot see. The facts leg is where
entity questions ("who owns X", "which contract names Y") are meant to land:
the company-metadata projection is already a typed, cited graph of the
company, so the leg reads it instead of a co-occurrence graph (ADR-010).

**Failure.** A failing ensemble degrades to BM25-only over the same scope —
retrieval never throws to the caller; it narrows.

**When to touch it.** Weight changes shift relevance for every consumer at
once. Change them against pinned golden queries, not by eye.
