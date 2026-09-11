# fusion — rank merging

**What it is.** How independent ranked lists become one: Reciprocal Rank
Fusion (`rrf.ts`) and the page-granular lexical+dense hybrid search built on
it (`hybrid-search.ts`).

**How it works.** RRF scores each item `Σ 1/(k + rankᵢ)` across the lists
that contain it (k=60, Cormack et al.) — items several methods agree on
outrank items any single method loves. It needs only ranks, never raw
scores, so it fuses methods whose score scales are incomparable (ts_rank vs
cosine distance). `hybridSearchWithRRF` runs the FTS leg and a
cosine-distance scan, fuses at `document:page` granularity, and reports a
bounded pseudo-similarity (`score × 60`, capped at 0.95). The query embedder
is injected by the caller; an empty embedding degrades to lexical-only.

**Relation to ensemble/.** Same fusion idea, different altitude: `ensemble/`
composes LangChain retrievers for the Q&A pipeline (chunk-granular,
config-driven legs, reranking); this folder is the standalone primitive for
callers that want a ranked page list without the retriever machinery — the
document matcher was its first consumer.

**Knobs.** `k` (list-agreement bias) on RRF; `limit` and the vector distance
threshold (0.4) on the hybrid search.
