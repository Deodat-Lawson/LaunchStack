# @launchstack/runtime

## 0.2.0

### Minor Changes

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.
- 20b85c7: `StoragePort` no longer has `delete(urlOrKey)`. Nothing in the engine called
  it, and the host implementation behind it could not delete database-backed or
  Vercel Blob objects and sent S3 deletes to the wrong key. Hosts delete stored
  objects through their own reference-based lifecycle instead.
