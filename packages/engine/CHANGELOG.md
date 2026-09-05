# @launchstack/engine

## 0.2.0

### Minor Changes

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.

### Patch Changes

- 64bb234: Rename `@launchstack/search` to `@launchstack/retrieval` and consolidate
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
- Updated dependencies [bb64f34]
- Updated dependencies [ba11446]
- Updated dependencies [64bb234]
- Updated dependencies [f2ac582]
  - @launchstack/store@0.2.0
  - @launchstack/runtime@0.2.0
  - @launchstack/llm@0.2.0
  - @launchstack/conversion@0.2.0
  - @launchstack/indexing@0.2.0
  - @launchstack/retrieval@0.2.0
  - @launchstack/orchestration@0.2.0
