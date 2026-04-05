# Feature Workflows and Architecture

This document explains how major Launchstack features connect end to end.

## End-to-end workflow

Launchstack follows this loop:

1. Authenticate user with role context (Employer/Employee)
2. Upload document (cloud or database storage)
3. **Ingest** — unified ingestion layer extracts text from PDF, DOCX, XLSX, PPTX, images, etc.
4. **OCR** (optional) — for scanned PDFs via Azure Document Intelligence, Datalab, or Landing.AI
5. **Chunk** — split content into sections
6. **Embed** — generate embeddings (OpenAI or sidecar)
7. **Store** — vectors in PostgreSQL (pgvector), chunks for BM25, optional knowledge graph
8. **Retrieve** — ensemble search (vector + BM25, optional graph retriever + reranking)
9. Use retrieval for AI chat and predictive analysis
10. Persist chat/session context for continuity

## Knowledge base architecture

```text
Upload -> Ingest (unified adapters) -> Chunk -> Embed -> Store (pgvector + optional graph) -> Retrieve (ensemble + optional rerank)
```

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
- **Providers:** Native text/PDF, Mammoth (DOCX), SheetJS (XLSX/CSV), Cheerio (HTML), Azure OCR, Tesseract, sidecar
- **Output:** `StandardizedDocument` with pages, text blocks, tables, and metadata

## Knowledge graph (Graph RAG)

When `SIDECAR_URL` is set:

1. **Entity extraction** — Sidecar `/extract-entities` runs NER on chunks
2. **Graph storage** — Entities and relationships stored in `kg_entities`, `kg_entity_mentions`, `kg_relationships`
3. **Graph retrieval** — `GraphRetriever` finds entities matching the query, traverses 1–2 hops, returns related sections
4. **Ensemble use** — Graph retriever can be combined with vector and BM25 in ensemble search

Relevant code:

- `src/lib/ingestion/entity-extraction.ts` — calls sidecar and writes to graph tables
- `src/server/rag/retrievers/graph-retriever.ts` — LangChain retriever for graph traversal
- `src/server/db/schema/knowledge-graph.ts` — graph schema

## Sidecar (optional ML compute)

The sidecar is a FastAPI service that provides:

| Endpoint | Purpose |
|----------|---------|
| `/embed` | Local embeddings (sentence-transformers) |
| `/rerank` | Cross-encoder reranking of search results |
| `/extract-entities` | NER for knowledge graph entity extraction |
| `/health` | Health check |

Configure via `SIDECAR_URL`. When set:

- Ensemble search uses the sidecar for reranking (graceful fallback if unavailable)
- Document processing can use the sidecar for entity extraction and graph population

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
- Optional web-enriched retrieval (Tavily) when configured
