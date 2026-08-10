# ADR-005: Evidence Model — Sources, Versions, Citations, and Projection Over Existing Tables

**Status:** Accepted
**Date:** 2026-08-09
**Deciders:** Repository maintainers

## Context

The target architecture requires immutable, citable evidence with
source/version identity, page or time spans, extraction confidence where
available, permission scope, and stable citation anchors. The database already
models most of this, under different names:

| Concept | Existing table |
|---|---|
| Source | `pdr_ai_v2_document` |
| Source version (immutable) | `pdr_ai_v2_document_versions` |
| Evidence chunks | `pdr_ai_v2_document_context_chunks` / `_retrieval_chunks` (version-scoped) |
| Evidence metadata | `pdr_ai_v2_document_metadata` (per document+version) |
| Workspace / permission scope | `pdr_ai_v2_company` (+ product-side memberships) |
| Extraction jobs | `pdr_ai_v2_ocr_jobs` |

Migrations are immutable and forward-only; CI enforces schema parity by
`pg_dump` diff, making renames and column reordering expensive and pointless.

## Decision

**Do not rename tables. Formalize the evidence model as code over the existing
schema, and add only what is missing.**

1. `packages/evidence` defines the domain vocabulary as pure types and
   functions: `SourceRef` (documentId), `SourceVersionRef` (versionId,
   versionNumber), `EvidenceChunk`, `CitationAnchor` (page span, time span, or
   character range plus a quoted snippet), `anchorKey()` (stable, orderable
   string form used in answers and stored references), version diffing by
   content hash, supersession (`currentVersion` resolution and superseded
   ranges), conflict detection between assertions from different current
   sources, and freshness tiers computed from version timestamps against a
   caller-supplied policy and clock.
2. **Immutability rule:** rows in `document_versions` and version-scoped chunk
   tables are never updated in place by the pipeline; a change to a source
   produces a new version (existing `createDocumentVersionLifecycle`
   semantics). The one violation in the current code —
   `modifyDocument` overwriting `document.url` without a version row — is
   fixed to create a proper new version.
3. **Confidence is only ever provider-reported.** The `EvidenceDocument`
   schema and `ocr_jobs.confidence_score` carry confidence when the provider
   supplied one and `null` otherwise. Fabricated constants are removed from
   the processor, the router, and the Q&A reference builder (which now reports
   retrieval scores as `relevance`, a distinct field that is never called
   confidence).
4. **Citations are permission-scoped.** The query path resolves the actor's
   workspace membership at the application boundary; retrieval and citation
   building accept only the resolved company scope, and the file-serving route
   authorizes by company ownership before returning bytes. Tests cover the
   cross-company denial.
5. **Projection:** after indexing, the worker emits
   `company.state.projected`; the handler runs the existing company-metadata
   extraction (per-fact provenance, visibility, confidence) — this is the
   company-state projection, now traceable to the evidence version that
   triggered it.
6. New engine tables are limited to the transactional outbox (ADR-003).
   Everything else reuses the tables above; the additive columns from the
   `document_creation_lifecycle` migration (creation keys, `version_id`,
   `dispatch_options`) are the idempotency backbone.

## Consequences

- No data migration or rename churn; existing customer data is untouched.
- External vocabulary (docs, protocol, new code) speaks
  source/version/evidence/citation; the physical names stay `pdr_ai_v2_*`
  (documented mapping table in `docs/architecture/target-architecture.md`).
- Freshness/supersession/conflict logic is unit-testable without a database
  and is exercised by the worker and the query path, not decorative.
