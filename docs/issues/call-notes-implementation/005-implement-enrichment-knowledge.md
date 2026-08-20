---
id: MN-IMP-005
title: Implement Enrichment and Knowledge Integration
parent: MN-IMP-000
status: open
assignee: Junkun
labels:
  - call-notes
  - ai
  - knowledge
tracker: local-markdown
blocked_by:
  - MN-IMP-001
---

# Implement Enrichment and Knowledge Integration

## Outcome

A completed Call can produce one reviewable, transcript-grounded Enriched Note proposal, preserve generation provenance and the owner's accepted revision, and synchronize only the deliberately included canonical Call Note through LaunchStack's existing note retrieval path.

## Contracts consumed and provided

Consumes finalized Transcript segments/gaps, Bookmarks, the current owner Call Note, `EnrichmentInput`, and existing LaunchStack model/note-embedding facilities. Provides `EnrichmentModel`, validated `EnrichmentResult`, immutable run provenance, and `KnowledgeNoteSink` behavior for include, reindex, and removal.

## Owned surface

Post-call enrichment orchestration, prompts/model routing, structured-output validation, proposal/provenance handling, canonical-note knowledge synchronization, deep links, and focused AI/knowledge tests. Domain state transitions and repositories, Zoom runtime, production UI, canonical schema/contracts, and root wiring remain outside this lane.

## Acceptance

- Enrichment is an explicit post-call action and creates a proposal separate from My notes; failure or invalid structured output never mutates the canonical note.
- Transcript order and substantive coverage are preserved while the owner's context controls emphasis. Unsupported owner text is retained and visibly labeled rather than silently discarded.
- The structured result contains chronological sections, a final summary, decisions/action items where present, and conflict records required by the frozen schema.
- Each run records transcript fingerprint, base note revision, model/provider/prompt metadata, original output, editable proposal, and final Accept/Reject resolution.
- Bookmark-derived passages expose segment/speaker/timestamp citations; ordinary generated sections do not create noisy paragraph-level citation decoration.
- Accept creates a new canonical Call Note revision only when the expected base still applies; Reject preserves both the owner note and immutable run history.
- Knowledge inclusion defaults off. Include/upsert indexes the current canonical `document_notes` revision with a Call deep link; later accepted or manual revisions reindex; removal/private/delete paths remove or update retrieval visibility without indexing Transcript segments.
- Deterministic model and knowledge fakes cover correctness; one configured model smoke validates the real structured-output path.

## Relevant decisions

MN-WF-004, MN-WF-005, MN-WF-008, MN-WF-011, and MN-WF-012.

## Non-goals

Call/Capture lifecycle implementation, Zoom capture, Calls UI, a second knowledge database, automatic Transcript RAG, automatic knowledge inclusion, autonomous acceptance, live meeting copilot behavior, or a general-purpose enrichment framework.
