# @launchstack/store

## 0.2.0

### Minor Changes

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.

### Patch Changes

- 2c09443: `db:verify` is read-only again. Since the feature reorganization it ran the
  migration runner with `--verify`, a flag the runner never recognized, so it fell
  through to apply mode: "verifying" an outdated database applied every pending
  engine migration and exited 0. CI's "Assert no migrations pending" steps could
  therefore never fail on the engine set. It now passes `--check`, which lists
  pending migrations and exits non-zero without applying them.
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
- Updated dependencies [ba11446]
  - @launchstack/runtime@0.2.0
