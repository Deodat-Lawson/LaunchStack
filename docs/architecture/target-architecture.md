# Target Architecture — Cited Company Memory

**Status:** Implemented (ADR-002 … ADR-006)
**Updated:** 2026-08-09

Launchstack is a cited company-memory system: sources go in, immutable
evidence comes out, answers cite that evidence with stable anchors. This
document is the reference for the layered architecture that implements it.

## Layers

```
packages/protocol      contracts only (zod + generated JSON Schema)
   ↑
packages/evidence      pure company-state logic (no IO, no env)
   ↑
packages/application   use cases + ports (commands, queries, outbox tick)
   ↑
packages/adapters      Postgres, storage, service clients, pipeline stages
   ↑
packages/core          published compatibility facade (re-exports)
   ↑
apps/web  apps/worker  services/*        composition roots + runtimes
```

Imports only point downward. ESLint enforces every edge (eslint.config.js);
`scripts/ci/check-core-facade.mjs` enforces that core stays re-exports only.

## The one ingestion path (ADR-003)

```
upload/import (apps/web — command acceptance only)
  └─ ONE transaction: document + document_versions + ocr_jobs
                      + event_outbox(source.version.created)
worker (apps/worker — sole durable coordinator)
  ├─ source.version.created  → extract (document-converter /
  │                            text fast path / archive expansion)
  ├─ evidence.version.extracted → chunk + embed + store + graph
  ├─ evidence.version.indexed   → note re-anchoring
  │                               + company.state.projection.requested
  ├─ company.state.projection.requested → company-metadata extraction
  │                               → company.state.projected (announcement)
  └─ note.embedding.requested   → note embedding
query (apps/web — synchronous reads)
  └─ ensemble retrieval → citations with stable anchors + freshness
```

Every consumer is idempotent; event ids are deterministic; retries are
bounded with exponential backoff; dead events are visible and replayable
(docs/runbooks/outbox.md).

## Vocabulary → physical schema (ADR-005)

The evidence vocabulary is code-level; physical tables keep their historical
names because migrations are forward-only and renames buy nothing:

| Evidence concept | Physical table |
|---|---|
| Source | `pdr_ai_v2_document` |
| Source version (immutable) | `pdr_ai_v2_document_versions` |
| Evidence chunks | `pdr_ai_v2_document_context_chunks`, `_retrieval_chunks` (version-scoped) |
| Evidence metadata | `pdr_ai_v2_document_metadata` |
| Extraction job | `pdr_ai_v2_ocr_jobs` |
| Event outbox | `pdr_ai_v2_event_outbox` |
| Workspace scope | `pdr_ai_v2_company` |
| Projected company state | `pdr_ai_v2_company_metadata` (+ history) |

Citation anchors (`@launchstack/evidence`) are stable strings —
`src:<documentId>/ver:<versionId>/page:<n>`, `…/time:<s>-<e>`,
`…/char:<a>-<b>` — round-trippable via `parseAnchorKey`.

## Compute services (ADR-004)

| Service | Port | Owns | Never does |
|---|---|---|---|
| `services/document-converter` | 8002 | routing, vision classification, page rendering, docling-backed parsing → typed `EvidenceDocument` | product-DB access, env mutation, fabricated confidence |
| `services/transcription` | 8000 | Whisper + yt-dlp → timestamped transcripts | product-DB access |
| `services/document-editor` | 8003 (host) | Adeu DOCX redlining (authoritative) | product-DB access |
| `api/adeu` | — | DEPRECATED compatibility path, tested, pending owner removal decision | new callers |

All services: fail-closed `X-API-Key` auth, `/health`, structured logs with
trace ids, request timeouts, and startup-validated typed config. The
converter additionally enforces an origin allow-list on every fetched URL.
Confidence values are provider-reported or absent — never invented.

## Deployment topology

Local (Docker Compose): `db`, `migrate`, `seaweedfs`, `transcription`,
`document-editor`, `document-converter`, `worker`, `app`, `inngest-dev`;
profiles `ocr` (docling-serve) and `backfill`. The worker hosts the Inngest
serve endpoint (`:8020/api/inngest`) for the non-ingestion background
verticals; the web app only sends events.

Cloud (e.g. Vercel + containers): the web app deploys serverless; the
worker and compute services deploy as containers. **A deployment without a
worker accepts uploads but never processes them** — the outbox depth makes
that visible immediately (`/readyz`, runbook).

## What lives where after the refactor

- `apps/web` — UI, auth, API/BFF, command acceptance, synchronous reads.
  No durable ingestion orchestration; no Inngest serve endpoint.
- `apps/worker` — outbox consumer + Inngest functions (trend search,
  prospector, founder review, predictive analysis, website crawl, document
  modify, reindex).
- `packages/core` — compatibility facade for the published API surface
  (`createEngine`, schema, ports). No new business logic (CI-enforced).
- Deleted: `services/ocr-router`, `services/ocr-worker`, `sidecar/`
  (split/absorbed per ADR-004), the phantom `/embed`, `/rerank`,
  `/extract-entities` provider surface, the web `document/process.requested`
  Inngest pipeline, the request-scoped env mutation in OCR routing, and the
  fire-and-forget note embedding.
