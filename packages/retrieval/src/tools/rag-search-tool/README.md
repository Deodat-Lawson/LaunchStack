# rag-search-tool — retrieval as a LangChain tool

**What it is.** The agent-facing wrapper: a `rag_search` tool an agent can
call to search a user's documents, plus `formatResultsForPrompt` to render
hits as prompt context grouped by document with page markers.

**How it works.** `createRagSearchTool(validateAccess)` builds the tool
around an app-supplied `AccessValidator` — which documents a user may search
is product-schema knowledge this package cannot hold, so the check is
injected and enforced before any retrieval runs. Validated IDs go through
the multi-document ensemble (`[0.4, 0.6]` bm25/vector), results come back
as JSON the agent can cite from, capped for context size. The userId rides
in the LangChain run's `configurable` bag.

**When to use it.** Agent loops that decide for themselves when to consult
the corpus. Routes that always retrieve should call the ensemble directly —
the tool wrapper only adds value when a model chooses to invoke it.
