# Feature Workflows and Architecture

This document explains how major Launchstack features connect end to end.

## End-to-end workflow

Launchstack follows this loop:

1. Authenticate user and resolve their workspace membership (role, permissions, document scope)
2. Upload document — the web app writes the source version **and** a
   `source.version.created` row into the transactional outbox
   (`pdr_ai_v2_event_outbox`) in one transaction ([ADR-003](./architecture/ADR-003-transactional-outbox-and-worker.md))
3. **Worker** (`apps/worker`) claims the outbox event and drives every
   subsequent stage
4. **Convert / OCR** — `services/document-converter` routes and parses PDFs,
   Office docs, and scans (docling-backed; Azure Document Intelligence,
   Datalab, or Landing.AI as configured); audio/video goes through
   `services/transcription`
5. **Chunk** — split content into sections
6. **Embed** — generate embeddings via the configured embedding provider
   (OpenAI-compatible endpoint, Ollama, or HuggingFace)
7. **Store** — evidence persistence, then vectors in PostgreSQL (pgvector),
   chunks for BM25, optional knowledge graph; finally the company-state
   projection
8. **Retrieve** — ensemble search (vector + BM25, optional graph retriever +
   reranking via the configured `RERANK_*` provider)
9. Use retrieval for AI chat and predictive analysis
10. Persist chat/session context for continuity

## Knowledge base architecture

```text
Upload -> source version + outbox row (one transaction)
       -> worker (outbox consumer) -> convert/transcribe (compute services)
       -> chunk -> embed -> evidence persistence -> index (pgvector + BM25 + optional graph)
       -> company-state projection
Retrieve -> ensemble (vector + BM25, optional graph + rerank) -> cited answers
```

Operational details for the outbox (monitoring, replay) live in
[`docs/runbooks/outbox.md`](./runbooks/outbox.md).

### Core areas in codebase

| Area | Path | Purpose |
|------|------|---------|
| Upload API | `src/app/api/uploadDocument/route.ts` | Ingestion entrypoint (cloud or DB storage) |
| Local upload | `src/app/api/upload-local/route.ts` | Direct upload to database |
| Unified ingestion | `src/lib/ingestion/` | Adapters for PDF, DOCX, XLSX, PPTX, images, etc. |
| OCR pipeline | `src/lib/ocr/` | Azure, Datalab, Landing.AI adapters; processor and trigger |
| Job dispatcher | `src/lib/jobs/` | Inngest (default) or Trigger.dev for background processing |
| RAG retrieval | `src/server/rag/` | Vector, BM25, graph retrievers; ensemble search |
| Document Q&A | `src/app/api/agents/documentQ&A/` | RAG-backed chat and query |
| Predictive analysis | `src/app/api/agents/predictive-document-analysis/` | Gap detection and recommendations |
| Database | `src/server/db/` | Schema, migrations, knowledge graph tables |

## Unified ingestion layer

The ingestion layer (`src/lib/ingestion/`) provides a single API to convert documents into a standardized format:

- **Supported types:** PDF, DOCX, XLSX, PPTX, images, CSV, text, HTML, Markdown
- **Providers:** Native text/PDF, Mammoth (DOCX), SheetJS (XLSX/CSV), Cheerio (HTML), Azure OCR, Tesseract, `services/document-converter`
- **Output:** `StandardizedDocument` with pages, text blocks, tables, and metadata

## Knowledge graph (Graph RAG)

Opt-in since [ADR-011](./architecture/ADR-011-knowledge-graph-scope.md). The
chat panel no longer carries a Graph tab, stage F entity extraction runs only
when `ENABLE_ENTITY_EXTRACTION=true`, and the graph retrieval leg stays behind
`ENABLE_GRAPH_RETRIEVER`. What chat gets instead is the **company-facts leg**:
cited facts from the company-metadata projection (people, services, projects,
legal, policies) join the ensemble (`ENABLE_COMPANY_FACTS_RETRIEVER`, on by
default).

When entity extraction is enabled:

1. **Entity extraction** — the configured LLM-based extractor runs NER on
   chunks ([ADR-004](./architecture/ADR-004-compute-service-consolidation.md))
2. **Graph storage** — Entities and relationships stored in `kg_entities`, `kg_entity_mentions`, `kg_relationships`
3. **Graph retrieval** — `GraphRetriever` finds entities matching the query, traverses 1–2 hops, returns related sections
4. **Ensemble use** — Graph retriever can be combined with vector and BM25 in ensemble search

Relevant code:

- `packages/indexing/src/entity-extraction.ts` — runs extraction and writes to graph tables
- `packages/indexing/src/entity-extraction-config.ts` — the opt-in gate
- `packages/retrieval/src/algorithms/graph/` — graph traversal legs (Postgres + Neo4j)
- `packages/store/src/db/schema/knowledge-graph.ts` — graph schema
- `apps/web/src/server/rag/company-facts-retriever.ts` — the company-facts leg
- `apps/web/src/app/employer/tools/knowledge-graph/` — parked entity-graph view (index health, unlinked)

## Compute services

> **Historical note:** older revisions of this document described a single
> "sidecar" exposing `/embed`, `/rerank`, and `/extract-entities`. **No service
> in this repository ever implemented those routes**; the dangling providers
> were removed per [ADR-004](./architecture/ADR-004-compute-service-consolidation.md).
> Embeddings, reranking, and NER use the configured cloud/LLM providers
> (`EMBEDDING_*`, `RERANK_*`, `NER_MODEL`).

The Python/Node compute services ([ADR-004](./architecture/ADR-004-compute-service-consolidation.md)) are:

| Service | Purpose | URL variable |
|---------|---------|--------------|
| `services/transcription` | Whisper transcription + yt-dlp download | `TRANSCRIPTION_SERVICE_URL` |
| `services/adeu-ai-docs-editing` | Adeu DOCX redlining | `ADEU_SERVICE_URL` |
| `services/document-converter` | OCR routing, vision classification, PDF rendering, docling-backed parsing | `DOCUMENT_CONVERTER_URL` |

All three authenticate with per-service API keys (fail-closed), expose
`/health`, never access the product database, and never call one another.

## Document viewers

- **PDF** — PDF.js via iframe or native viewer
- **Images** — Direct image display
- **DOCX** — Mammoth-based `DocxViewer`
- **XLSX** — SheetJS-based `XlsxViewer`
- **PPTX** — Custom `PptxViewer`

Viewers live in `src/app/employer/documents/components/`.

## Predictive document analysis

Flow:

1. Parse available document set and metadata
2. Identify expected-but-missing documents
3. Score urgency/confidence
4. Return prioritized recommendations

Benefits: reduced manual review, better compliance readiness, faster audit preparation.

## Study workflows

Study flows reuse the same retrieval foundation:

- StudyBuddy mode — conversational coaching
- AI Teacher mode — structured instruction

Both rely on persisted session state and document-grounded retrieval.

## Search scopes

- Document-scoped retrieval
- Category-scoped retrieval
- Company-scoped retrieval
- Multi-document retrieval
- Optional web-enriched retrieval (Exa) when configured
