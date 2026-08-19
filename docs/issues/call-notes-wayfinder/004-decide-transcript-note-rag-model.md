---
id: MN-WF-004
title: Decide the Transcript, Note, and RAG Knowledge Model
parent: MN-WF-000
status: closed
assignee: Main
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-002
  - MN-WF-003
---

# Decide the Transcript, Note, and RAG Knowledge Model

## Question

How should LaunchStack preserve a call transcript and its Call Note as equally significant but distinct knowledge: dedicated Call records, transcript segments, an ingested transcript Document, an editable `document_notes` record, embeddings, citations, and links—while reusing the existing document and notes retrieval paths instead of creating a third knowledge system?

## Resolution

The Transcript and Call Note remain distinct, but only the Call Note participates in
LaunchStack knowledge retrieval for the first release.

- Immutable, speaker-attributed Transcript segments are the Call's evidence source.
  They support exact in-Call search, Bookmarks, enrichment input, and stable links by
  segment, speaker, and timestamp. They are not embedded, ingested as a Document, or
  exposed to company-wide RAG.
- The one canonical Call Note reuses `document_notes` and
  `document_note_embeddings`; no Call-specific retrieval index is introduced.
- The owner may enable a post-call **Use in company knowledge** setting only for a
  company-visible Call Note. It defaults off. Enabling it indexes the current canonical
  revision; disabling it removes the retrieval entry without deleting the note or
  Transcript.
- Capture completion never indexes a note. The owner can first edit it, request AI
  enrichment, and accept or reject the proposal. Unaccepted AI output is never indexed.
- Once knowledge inclusion is enabled, later manual edits or an accepted Enriched Note
  replace the indexed canonical revision after save.
- A private Call Note is excluded from company knowledge. Making an included note
  private removes its retrieval entry.
- Retrieval results link back to the Call Note. Evidence references stored in the note
  or its accepted revision resolve directly to immutable Transcript segment IDs; this
  does not make Transcript content retrievable.

Transcript retrieval remains a future, evidence-driven extension if note-only retrieval
produces demonstrated recall failures. It is not a release-one adapter seam or dormant
index.
