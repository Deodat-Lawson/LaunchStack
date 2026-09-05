# @launchstack/indexing

## 0.2.0

### Minor Changes

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.

### Patch Changes

- Updated dependencies [bb64f34]
- Updated dependencies [ba11446]
  - @launchstack/store@0.2.0
  - @launchstack/runtime@0.2.0
  - @launchstack/llm@0.2.0
  - @launchstack/conversion@0.2.0
  - @launchstack/orchestration@0.2.0
