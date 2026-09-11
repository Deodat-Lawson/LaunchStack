# ADR-004: Compute Service Consolidation and Contracts

**Status:** Accepted
**Date:** 2026-08-09
**Deciders:** Repository maintainers

## Context

Four service runtimes exist today with unclear ownership:

- `services/ocr-router` (Node/Express): complexity routing, vision
  classification, PDF page rendering.
- `services/ocr-worker` (Python): a thin proxy in front of `docling-serve`.
- `sidecar/` (Python/FastAPI): Whisper transcription, yt-dlp download, and the
  Adeu DOCX-redlining routes — two unrelated lifecycles in one container.
- `api/adeu` (Python): a 503-line quarantined duplicate of the sidecar Adeu
  routes, imported via `sys.path` manipulation, authored and tested by
  contributors other than the repository owner (REPOSITORY.md open question).

Dangling contracts: `packages/core` contains providers that call
`${SIDECAR_URL}/embed`, `/rerank`, and `/extract-entities`; **no service in
this repository implements any of those routes**, and the default Docker
Compose stack auto-selects them (404s at runtime). The OCR layer contains a
fake provider: `createMarkerAdapter` silently returns the Docling adapter, and
several sites fabricate confidence values (`1.0`, `0.99`, `0.5`) that were
never produced by any model.

## Decision

1. **`services/document-converter`** — consolidate `ocr-router` and
   `ocr-worker` into one Node service that owns routing, vision
   classification, PDF page rendering, and parse proxying to `docling-serve`.
   It returns a typed `EvidenceDocument` (defined in `packages/protocol`)
   carrying per-page text, layout blocks and citation metadata where the
   provider supplies them, and **only** provider-reported confidence — absent
   otherwise. Fabricated confidence constants are removed; heuristic routing
   scores are renamed so they can never be mistaken for extraction confidence.
2. **`services/transcription`** — the sidecar's Whisper + yt-dlp routes as a
   standalone FastAPI service returning timestamped transcripts
   (`TranscriptSegment[]` in the protocol package).
3. **`services/document-editor`** — the sidecar's Adeu routes as the single
   authoritative DOCX-editing service.
4. **`api/adeu` is retained, deprecated, and kept tested.** Its authors have
   not signed off on removal, so it stays with its preservation tests wired
   into CI and a deprecation notice pointing at `services/document-editor`.
   Its `sys.path` import is updated to the new service location.
5. **Inference endpoints are removed, not stubbed.** The sidecar
   embed/rerank/NER providers in core, the `SidecarEmbeddingConfig` surface,
   the experimental `/embed` client, and every env var/doc claim that
   references them are deleted. Reranking uses the supported cloud provider
   configuration (`RERANK_*`); graph entity extraction uses the supported
   LLM-based extractor or is explicitly disabled with an actionable log. A
   future `services/inference` may reintroduce these only as a complete,
   tested implementation behind an explicit compose profile.
6. **Service invariants.** Compute services never access the product database,
   never mutate company state, and never call one another. They receive typed
   jobs plus validated object references (`/api/files/...` on the app origin,
   the configured S3 endpoint, or explicit allow-listed origins — arbitrary
   URLs are rejected), and return typed results validated against the protocol
   schemas on both sides. All services authenticate with per-service API keys
   (fail-closed), expose `/health`, use structured logs with trace IDs, and
   enforce request timeouts.

## Consequences

- `sidecar/` and the split services: the FastAPI code moves to
  `services/transcription` and `services/document-editor`; compose gains the
  two services and drops `sidecar`. `SIDECAR_URL`/`ADEU_SERVICE_URL` are
  replaced by `TRANSCRIPTION_SERVICE_URL` and `DOCUMENT_EDITOR_URL` (the old
  names are still read as deprecated fallbacks by the TypeScript config layer
  so existing deployments keep working; documented in the migration guide).
- `OCR_ROUTER_URL`/`OCR_WORKER_URL` are replaced by `DOCUMENT_CONVERTER_URL`
  (same fallback treatment).
- The `MARKER` provider name is no longer accepted in configuration (startup
  fails with an actionable message naming `DOCLING`); persisted historical
  `dispatchOptions` containing `MARKER` are mapped to `DOCLING` with a logged
  warning so replays of old jobs still work.
- Python services get pytest suites run in CI, plus contract tests validating
  their request/response models against the JSON Schemas generated from
  `packages/protocol`.
