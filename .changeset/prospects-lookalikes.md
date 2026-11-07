---
"@launchstack/pipelines": minor
---

Live distribution runs find companies through Exa's company index instead of
news search (new `searchCompanies` / `describeCompanies` ports; general web
search when Serper is the only key), and a new `lookalike` source searches for
companies like the program's customers: the new `customerDomains` on
`ProgramInput` / `ProgramRecord` (column `customer_domains`) and its won deals,
up to five seeds a run. Customers join the exclusions. The research agent's
`search_web` and competitor analysis use general web search, and the discovery
playbook plans queries that describe the companies themselves.
