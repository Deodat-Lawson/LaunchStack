---
"@launchstack/retrieval": minor
---

Company-scoped retrieval accepts an optional `DocumentScope` (ADR-010):
`CompanySearchOptions.scope` limits the chunk candidates to the folders and
documents the caller may read, and `ChunkRow` / result metadata carry the
document's `category` so callers can re-check scope after retrieval. The brick
receives folder names and document ids only — never a user, group, or grant.
Omitting `scope` keeps the previous behaviour.
