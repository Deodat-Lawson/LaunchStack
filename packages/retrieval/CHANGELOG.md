# @launchstack/retrieval

## 0.2.0

### Minor Changes

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.
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
- f2ac582: Company-scoped retrieval accepts an optional `DocumentScope` (ADR-010):
  `CompanySearchOptions.scope` limits the chunk candidates to the folders and
  documents the caller may read, and `ChunkRow` / result metadata carry the
  document's `category` so callers can re-check scope after retrieval. The brick
  receives folder names and document ids only — never a user, group, or grant.
  Omitting `scope` keeps the previous behaviour.

### Patch Changes

- Updated dependencies [bb64f34]
- Updated dependencies [ba11446]
  - @launchstack/store@0.2.0
  - @launchstack/runtime@0.2.0
  - @launchstack/evidence@0.1.0
  - @launchstack/llm@0.2.0
  - @launchstack/indexing@0.2.0
