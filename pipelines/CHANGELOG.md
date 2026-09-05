# @launchstack/pipelines

## 0.2.0

### Minor Changes

- bb64f34: Add the distribution pipeline: a vertical that finds importers,
  distributors, wholesalers and retail accounts for a company's offering,
  researches each candidate with a bounded agent whose every fact must cite a
  page it fetched, scores fit with a deterministic rubric, and runs the
  relationship through enforced stages to a signed agreement. New tools:
  `place-search` (extracted from client-prospector, targeting perspective is
  caller data), `org-resolver` (deterministic organisation identity),
  `web-research`'s `fetchReadable` (SSRF-guarded readable-page fetch), and the
  `trade-data` and `compliance-screen` ports (null defaults; OpenSanctions
  yente adapter included). `PlannedQuery.category` widens to a string label.
  `TokenService` gains `distribution_research`.
- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.
- 967e3ea: Add the Google Drive connector to the connectors vertical: a thin Drive v3
  fetch client, Picker-scoped discovery/collect/sync under the `KnowledgeSink`
  contract, and export rules for Google-native files, exported at
  `@launchstack/pipelines/connectors/google-drive`. The shared connector
  contract widens `KnowledgeItem.content` to `string | Uint8Array` (with
  `contentByteLength`/`contentToBuffer` helpers) so remote connectors can carry
  binary formats; text-only sinks must narrow and reject bytes.

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
  - @launchstack/tools@0.2.0
  - @launchstack/store@0.2.0
  - @launchstack/runtime@0.2.0
  - @launchstack/llm@0.2.0
  - @launchstack/conversion@0.2.0
  - @launchstack/indexing@0.2.0
  - @launchstack/retrieval@0.2.0
  - @launchstack/orchestration@0.2.0
  - @launchstack/editing@0.2.0
  - @launchstack/engine@0.2.0
