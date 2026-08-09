# @launchstack/protocol

Cross-language contracts for the Launchstack engine — and nothing else.

- Versioned zod schemas for the ingestion pipeline events
  (`source.version.created` → `evidence.version.extracted` →
  `evidence.version.indexed` → `company.state.projection.requested` →
  `company.state.projected`, plus `note.embedding.requested`).
- The `EvidenceDocument` produced by the document-converter service.
- Request/response schemas for the compute services (converter,
  transcription, document editor).
- `schemas/v1/*.schema.json` — generated JSON Schemas consumed by the
  Python services' contract tests. Regenerate with `pnpm schemas:generate`;
  CI fails on drift (`pnpm schemas:check`).

Depends on `zod` only. No IO, no environment access, no other packages.
See `docs/architecture/ADR-002-layered-engine-packages.md`.
