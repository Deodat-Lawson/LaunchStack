# Target Architecture — Cited Company Memory

**Status:** Implemented; layering reorganized by feature (ADR-008, recorded in the [feature-reorganization changeset](../../.changeset/feature-reorganization.md))
**Updated:** 2026-10-12

Launchstack is a cited company-memory system: sources go in, immutable
evidence comes out, answers cite that evidence with stable anchors. This
document is the reference for the feature-based architecture that implements it.

## Layers

```
packages/runtime       host ports, actor context, errors, injected slots
   ↑
packages/store         Postgres/Drizzle, credentials, credits, engine migrations
   ↑
packages/llm           model calls, behavior, structured output, embeddings
packages/orchestration source lifecycle, outbox commands, worker tick
   ↑
packages/conversion    sources → EvidenceDocument, OCR, transcription, archives
   ↑
packages/indexing      chunking, embedding, entity extraction, graph sync
   ↑
packages/retrieval     scoped hybrid retrieval, reranking, citations
                       → packages/evidence (pure company-state logic, no IO/env)
   ↑
packages/tools         shared capabilities composed by verticals
packages/engine        createEngine(CoreConfig), engine-subsystem assembly
   ↑
pipelines              13 vertical compositions; imports bricks
   ↑
apps/web  apps/worker   composition root, UI/API, durable execution

Beside the engine spine:
packages/editing                    Adeu wire contracts + client (→ runtime)
packages/collab                     channels, meetings, signed HTTP protocol
packages/document-conversion-engine Gotenberg PDF client
packages/google-drive              Drive + OAuth client; injected credentials
packages/schema-generator          feature wire contracts → JSON Schema
packages/design-tokens             private CSS tokens for web + landing
apps/landing                       public site; no engine, auth, or database
services/*                         compute runtimes with independent dependencies
```

The arrows show dependency tiers, not every individual import. Bricks live
in `packages/*`; compositions live in `pipelines/`. Pipelines may import
bricks, never the reverse. `eslint.config.js` defines the tier, framework,
and per-package import restrictions. Pipelines stay independent of Next.js,
Clerk, React, and the web app's `~/*` aliases.

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
| Evidence chunks | `pdr_ai_v2_document_context_chunks`, `pdr_ai_v2_document_retrieval_chunks` (version-scoped) |
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
| `services/adeu-ai-docs-editing` | 8003 (host) | Adeu DOCX redlining (authoritative) | product-DB access |
| Gotenberg (off-the-shelf container) | 8004 (host) | Office → PDF via LibreOffice; HTML/Markdown → PDF via Chromium | product-DB access |

The three repository-owned services authenticate compute requests with
fail-closed `X-API-Key` checks and expose `/health`. They load typed config
at startup and propagate trace ids through structured logs. The converter
and editing service restrict fetched object references to allowed origins.
Gotenberg uses Basic auth, bounded API calls, and a Chromium fetch deny-list.
Confidence values are provider-reported or absent — never invented.

## Deployment topology

Local (Docker Compose): `db`, `migrate`, `seaweedfs`, `transcription`,
`adeu-docs-editing`, `document-converter`, `gotenberg`, `worker`, `app`,
`inngest-dev`; profiles `ocr` (Docling serve), `backfill`, and `seed`.
The worker hosts the Inngest serve endpoint (`:8020/api/inngest`) for the
non-ingestion background verticals; the web app only sends events.

Production uses container images and Compose, not a Vercel pipeline.
`.github/workflows/docker.yml` publishes web and worker images to GHCR;
`docker-compose.prod.yml` adds the public landing site and Caddy, and makes
local Whisper and Inngest dev opt-in. **A deployment without a worker accepts
uploads but never processes them** — inspect the outbox depth and the
worker's `/readyz` (see `docs/runbooks/outbox.md`).

## What lives where after the refactor

- `apps/web` — UI, auth, API/BFF, command acceptance, synchronous reads,
  and the shared `src/server/engine.ts` composition root.
  No durable ingestion orchestration; no Inngest serve endpoint.
- `apps/worker` — outbox consumer + Inngest functions for background
  verticals; dynamically imports the web host's `getEngine`.
- `apps/landing` — public site; depends on design tokens, not the engine.
- `pipelines/` (`@launchstack/pipelines`) — 13 vertical compositions:
  client prospector, company metadata, connectors, distribution, email,
  founder weekly review, legal templates, marketing, proposals, repository
  explainer, repository workspace, trend search, and Vantage.
- `packages/runtime` — clock/logger, actor context, errors, storage/job
  ports, and singleton slots.
- `packages/evidence` — immutable evidence records, citation anchors,
  version diffing, supersession, conflicts, reconciliation, and freshness.
- `packages/store` — engine schema, PostgreSQL client, credentials,
  file-access tokens, credits, backfills, and engine migrations.
- `packages/llm` — chat routes and behavior, model/provider wiring,
  structured output, guardrails, embeddings, and NER.
- `packages/orchestration` — transactional source acceptance, pipeline
  events, outbox storage, worker processing, and stage ports.
- `packages/conversion` — source converters and their wire contracts,
  `EvidenceDocument`, OCR, transcription, and archive expansion.
- `packages/indexing` — chunking, embedding, entity extraction, graph
  synchronization, and the extraction/indexing pipeline driven by the worker.
- `packages/retrieval` — scoped hybrid retrieval, reranking, and stable
  anchored citations.
- `packages/tools` — shared capabilities, including company context,
  grounded retrieval, web research, social publishing, and the stage runner.
- `packages/engine` — `createEngine(CoreConfig)` assembles the engine
  subsystems and exposes the aggregate API; it is not a facade-only package.
- `packages/editing` — typed tracked-changes Word client and Adeu wire
  contracts (ADR-007).
- `packages/collab` — channels, multi-agent meetings, and the signed HTTP
  protocol; hosts supply storage and the model registry.
- `packages/document-conversion-engine` — typed Gotenberg PDF client
  (ADR-009).
- `packages/google-drive` — typed Drive v3 and OAuth token client with
  injected credentials.
- `packages/schema-generator` — emits versioned JSON Schema from
  conversion, orchestration, and editing wire contracts.
- `packages/design-tokens` — private CSS design tokens for the two UI apps.
