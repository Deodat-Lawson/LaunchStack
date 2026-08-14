---
"@launchstack/core": minor
---

Move BM25 and vector retrieval into the engine, and make the built package
loadable by Node.

**New exports**

- `@launchstack/core/rag/retrievers` — `VectorRetriever`, plus the
  `create{Document,Company,MultiDoc}{Vector,BM25}Retriever` factories and the
  chunk helpers (`getDocumentChunks`, `getCompanyChunks`, `getMultiDocChunks`,
  `chunksToDocuments`). These reach the database through the existing
  `configureDatabase` / `getDb()` slot, so `createEngine(config)` is all a host
  needs to call first.
- `@launchstack/core/rag/search-types` — the retrieval types (`SearchResult`,
  `SearchScope`, `ChunkRow`, `EnsembleSearchOptions`, and the rest).

Retrievers are on their own subpath rather than being folded into
`@launchstack/core/rag` on purpose: BM25 needs `@langchain/community`, and a
consumer who only wants the `RagPort` types should not have to install it.

**New optional peer dependencies**

`@langchain/community` and `langchain`, both marked optional. Only required if
you import `@launchstack/core/rag/retrievers`.

**Fixed: the published package could not be imported**

The build compiled with `moduleResolution: Bundler`, which emits extensionless
relative specifiers (`from "./db"`). Since the package is `"type": "module"`,
Node rejected every one of them with `ERR_MODULE_NOT_FOUND`. The build now
rewrites specifiers to full paths, and `scripts/ci/check-package-exports.mjs`
loads all 39 subpaths under Node ESM as a release gate. `publint` did not catch
this and passed the broken tarball.
