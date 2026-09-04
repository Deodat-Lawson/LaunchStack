---
"@launchstack/tools": minor
"@launchstack/pipelines": minor
"@launchstack/store": patch
---

Add the distribution pipeline: a vertical that finds importers,
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
