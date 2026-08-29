# citation-builder — retrieval hits to anchored citations

**What it is.** The query-path half of citations (ADR-005 §3–4): it turns
already-permission-scoped retrieval rows into stable, anchored `Citation`s a
UI can render and a reader can trust.

**How it works.** Each hit carries its source, version, and anchor; the
builder keys anchors (`anchorKey`), computes freshness against the source's
current version (`computeFreshness`, `DEFAULT_FRESHNESS_POLICY` from
`@launchstack/evidence`), and emits citations whose `relevance` is the
retrieval score. `relevance` is deliberately not called confidence —
extraction confidence belongs to evidence, retrieval relevance to the query.

**When to use it.** Any consumer that surfaces retrieval results to a person.
If the answer shows text from a document, it should have gone through here.
