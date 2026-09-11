---
"@launchstack/retrieval": minor
"@launchstack/engine": patch
"@launchstack/tools": patch
"@launchstack/pipelines": patch
---

Rename `@launchstack/search` to `@launchstack/retrieval` and consolidate
every retrieval algorithm and tool into it, organized as one documented
folder per algorithm: `algorithms/{bm25,vector,fusion,ensemble,rlm,graph,
reranking}` and `tools/{citation-builder,grounded-retrieval,rag-search-tool,
rlm-search}`. The RLM, graph, and ensemble retrievers move in from apps/web;
the predictive-analysis ANN strategies become named modules behind the
vector retriever; grounded-retrieval moves over from `@launchstack/tools`
(a re-export keeps the old path). The `RagPort` contract is unchanged; the
ensemble's env reads become `configureEnsemble()` injected by the
composition root; old subpaths (`./retrievers`, `./reranking`,
`./citation-builder`) survive one release as aliases. The old package name
is lint-banned alongside the ADR-008 legacy names.
