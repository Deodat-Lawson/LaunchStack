---
"@launchstack/runtime": minor
"@launchstack/evidence": minor
"@launchstack/store": minor
"@launchstack/llm": minor
"@launchstack/conversion": minor
"@launchstack/indexing": minor
"@launchstack/retrieval": minor
"@launchstack/orchestration": minor
"@launchstack/editing": minor
"@launchstack/collab": minor
"@launchstack/engine": minor
"@launchstack/schema-generator": minor
"@launchstack/pipelines": minor
---

Reorganize the engine by feature (ADR-008). The kind-based packages
(protocol/application/adapters/core) dissolve into feature packages that
each own their tools, wire contracts, and clients; the product verticals
move to the top-level pipelines/ tier. Nothing was ever published under
the old names, so they are deleted rather than deprecated.
