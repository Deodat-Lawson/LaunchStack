# rlm — hierarchical, token-budgeted navigation

**What it is.** Retrieval for Recursive-Language-Model-style inference:
instead of stuffing top-k chunks into context, the model navigates the
document's structure programmatically and pays for exactly the sections it
reads.

**How it works.** Access patterns, cheapest first:

1. `getDocumentOverview` — metadata and outline shape, for planning.
2. `getDocumentTree` — the hierarchical structure without bodies.
3. `probeSection` — a preview of a section before committing to it.
4. `getSectionsWithinBudget` — full sections selected under an explicit
   token budget, with per-section cost accounting.
5. Workspace operations — store and re-read intermediate results across
   steps of a multi-call analysis.

Semantic filtering rides on the section metadata (semantic type, page), and
vector search over retrieval chunks is available inside a scope when the
structure alone isn't enough.

**When it wins.** Large documents and multi-step analyses where context is
the scarce resource — course packs, contracts with schedules, anything where
"read the right 5%" beats "embed similarity over everything". For one-shot
questions, the plain ensemble is cheaper and simpler.

**Knobs.** `TokenBudgetOptions` (budget, per-section caps),
`WorkspaceStoreOptions` for intermediate results.
