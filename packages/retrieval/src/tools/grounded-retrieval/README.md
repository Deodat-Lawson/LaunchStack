# grounded-retrieval — company-scoped retrieval with named policies

**What it is.** One implementation of the retrieve → clean → cap pipeline
that marketing's stage modules each hand-rolled (weights `[0.4, 0.6]` was
previously repeated verbatim at six call sites with three different failure
behaviors). Pipelines and tools call this instead of the RagPort directly —
an architecture test enforces it.

**How it works.** `retrieveCompanySnippets` runs the port's company ensemble
search under a named `SnippetPolicy` (topK, weights, snippet length), cleans
and caps each hit, and returns snippets ready for `formatSnippetBlock`.

**Failure policy is declared per call, never implicit:**

- `"throw"` — retrieval errors (including an unregistered RAG port)
  propagate to the caller, which owns what a failure means.
- `"empty"` — errors degrade to zero snippets; the swallowed error is
  logged so operators can still see it. Use only where the caller has
  decided thin context beats no result.

**When to use it.** Any brick or pipeline pulling company knowledge into a
prompt. Direct `getRag()` calls outside this folder are a boundary
violation, not a shortcut.
