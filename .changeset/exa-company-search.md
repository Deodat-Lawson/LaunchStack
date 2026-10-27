---
"@launchstack/tools": minor
---

Exa is the default web search engine. `searchCompanies` asks Exa's company
index (`category: "company"`) for organisations matching a description,
localised by country and never returning excluded hosts; `describeCompanies`
reads what each company sells and to whom from its homepage, the query a
lookalike search starts from; `companySearchAvailable()` says whether they can
run (they need `EXA_API_KEY`). `executeSearch` (news, for trend search) now
uses Serper when it is the only key.

`fetchReadable` connects only to the addresses that passed its private-address
check (adds `undici`), closing a DNS-rebinding gap, and exports `pinnedLookup`.
`normalizeDomain` keeps a hosting platform's tenants apart
(`freshfarm.myshopify.com`, `acme.github.io`), and grant search's web leg uses
general web search instead of news.
