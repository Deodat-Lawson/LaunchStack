---
"@launchstack/tools": minor
"@launchstack/pipelines": minor
---

Web search is provider-agnostic. One setting, `SEARCH_PROVIDER`, picks the
engine for every search from a provider registry (`SEARCH_PROVIDERS`): `exa`
(`EXA_API_KEY`), `serper` (`SERPER_API_KEY`), `brave`
(`BRAVE_SEARCH_API_KEY`), `tavily` (`TAVILY_API_KEY`) or `searxng`
(`SEARXNG_URL`, a self-hosted SearXNG instance with JSON output enabled).
Unset or empty, the first provider with a credential wins, in that order, so
Exa-first setups behave as before. A named provider without its credential
turns web search off, logged once and reported by `describeSearchSetup()`,
instead of switching to another engine. The trend-search strategies
`fallback` and `parallel` are removed; configurations that still set them are
treated as unset.

`searchWeb` (general) and `executeSearch` (news, for trend search) run on the
active provider. `searchCompanies` / `describeCompanies` use Exa's company
index and run only while Exa is the active provider; `companySearchAvailable()`
says so. With any other provider, Prospects discovers companies through
ordinary web search on that provider, and lookalikes are off.
