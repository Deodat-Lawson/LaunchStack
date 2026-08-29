---
"@launchstack/retrieval": minor
"@launchstack/engine": patch
"@launchstack/tools": patch
"@launchstack/pipelines": patch
---

Rename `@launchstack/search` to `@launchstack/retrieval` (directory
`packages/search` → `packages/retrieval`). Same exports, same `RagPort`
contract; consumers change the import specifier only. The old name is
lint-banned alongside the ADR-008 legacy names.
