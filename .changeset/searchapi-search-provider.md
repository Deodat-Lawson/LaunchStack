---
"@launchstack/tools": minor
---

SearchApi joins the web search providers: `SEARCH_PROVIDER=searchapi` with
`SEARCHAPI_API_KEY` sends web searches to Google (`engine=google`) and news
searches to Google News (`engine=google_news`, US English edition) through
https://www.searchapi.io. It is opt-in: in the automatic order it comes after
Tavily and before SearXNG, so a deployment that already has another engine's
credential keeps that engine.
