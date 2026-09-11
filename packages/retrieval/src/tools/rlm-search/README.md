# rlm-search — cost-aware retrieval as a service

**What it is.** The consumable face of the RLM algorithm
(`algorithms/rlm/`): one call that plans, retrieves under a token budget,
and returns LLM-ready combined content — for routes and agents that want
cost-aware retrieval without driving the retriever's access patterns
themselves.

**How it works.** `performRLMSearch(documentId, query, options)` resolves
the document's company embedding config, then either runs semantic search
(`prioritize: "relevance"`, the default) or budget-ordered section retrieval
(`"start"` / `"end"`, with semantic-type and page-range filters). The result
carries the sections with cumulative token costs, the overview, optional
previews, and a `combinedContent` string formatted for direct prompt
injection. Companion helpers expose the cheap planning calls: overviews
(single and batch), the structure tree, and drill-down by structure path.

**When to use it.** Large documents where "retrieve the right 5% under a
budget" beats top-k chunks. For one-shot questions the ensemble is simpler
and cheaper.

**Knobs.** `maxTokens` (default 4000), `prioritize`, `semanticTypes`,
`pageRange`, `includeOverview` / `includePreviews`, `embeddingIndexKey`.
