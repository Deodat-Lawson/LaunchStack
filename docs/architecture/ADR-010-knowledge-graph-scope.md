# ADR-010: Knowledge-graph scope — facts, not co-occurrence

**Status:** Accepted
**Date:** 2026-09-02
**Deciders:** Repository maintainers

## Context

Three things in the product were called "the graph", and none of them helped
a user get an answer.

- **A Graph tab in the chat panel.** It drew the top entities by mention
  count, clustered by NER label, joined by "appeared in the same chunk"
  edges. Clicking a node only highlighted it: no path to a document, a
  citation, or a question. Node types were person, org, place, date, money —
  a cloud of dates and dollar amounts with lines, not a knowledge graph.
  Entity resolution was lowercase string equality, so "Acme", "Acme Inc" and
  "ACME Corp" were three nodes.
- **Entity extraction at upload (stage F).** Ran on every chunk of every
  document by default: one LLM call per five chunks, then a co-occurrence
  edge for every entity pair in a chunk, written one query at a time. It was
  fail-soft, so it cost tokens and ingestion time silently, and its only
  consumer was the tab.
- **The graph retrieval leg.** Off by default and never in the golden
  retrieval test. Its query-term extraction matched every word of three or
  more letters as a substring of entity names, with no stopword list and no
  ranking of the sections it returned; switched on, it would have fused
  near-random sections into every answer at a fixed weight. The Neo4j mirror
  existed in code and in no compose file.

Meanwhile the company-metadata projection (`company_metadata`) already is a
typed graph with provenance: company → people with roles → services →
projects → legal entries with parties and dates → policies, every fact
carrying confidence, status, visibility and cited source versions. The
questions where a graph beats vector search — "who owns X", "which contract
names Y", "what is Z working on" — are questions about that projection, not
about the corpus.

## Decision

1. **The Graph tab leaves the chat panel.** The view is parked, unlinked, at
   `/employer/tools/knowledge-graph` as an index-health surface.
2. **Stage F entity extraction is opt-in.** `ENABLE_ENTITY_EXTRACTION`
   (default off) reaches the indexing package through
   `configureEntityExtraction` from the shared composition root; the step
   logs once and skips when off. The `kg_*` tables and the graph leg stay,
   unchanged, behind their existing flags.
3. **Chat gets a company-facts retrieval leg.** The projection's active,
   confident facts are flattened into cited rows, scored lexically against
   the question, and fused into the ensemble like notes are
   (`ENABLE_COMPANY_FACTS_RETRIEVER`, default on). Document and
   multi-document scopes narrow to facts whose sources cite those
   documents. A matching fact carries its source document, version and page,
   so it renders as a normal citation.
4. **No corpus-wide GraphRAG.** The published GraphRAG gains come from
   community detection plus community summaries answering global questions;
   this codebase has neither, and a co-occurrence graph over Drive, Slack,
   GitHub, Gmail and transcripts degrades as it grows. If a visual returns,
   it is a company map drawn from the projection where every node opens its
   source — not the entity cloud.

## Consequences

- Uploads no longer pay for NER by default. Deployments that want the
  entity graph set `ENABLE_ENTITY_EXTRACTION=true` and re-upload.
- Entity questions in chat are answered from curated facts with citations
  rather than from whichever chunks BM25 happened to favor; the gain over
  BM25 is modest on proper nouns and larger on dated, statused facts.
- The graph leg remains untested by the golden suite. Enabling it is an
  explicit operator decision, documented as such in `.env.example`.
- The landing page's "knowledge graph" promise is delivered by connected,
  cited answers over one index, which is what chat already does; no marketing
  copy changes.
