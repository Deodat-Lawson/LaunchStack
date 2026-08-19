---
id: MN-WF-011
title: Decide Post-Call Outputs and Downstream Integrations
parent: MN-WF-000
status: closed
assignee: Main
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-002
  - MN-WF-003
  - MN-WF-004
  - MN-WF-005
---

# Decide Post-Call Outputs and Downstream Integrations

## Question

Which durable outputs should a completed Call expose to LaunchStack—enriched note, full transcript, summary, decisions, action items, participants, citations, embeddings, RAG retrieval, wiki links, Founder Weekly Review, or document workflows—and which system owns each output so Call Notes plugs into existing capabilities without coupling every downstream consumer to RTMS internals?

## Resolution

Release one exposes one downstream knowledge output: the canonical Call Note, and only
when its owner explicitly enables **Use in company knowledge**.

- Call Notes owns Calls, Captures, Capture Attempts, Participants, immutable Transcript
  segments, Bookmarks, Call Note revisions, Enriched Note proposals, and their
  provenance.
- The existing `document_notes` embedding and retrieval path owns indexing and
  company-knowledge discovery of an included canonical Call Note.
- A retrieval result identifies the source as a Call Note and deep-links to the Call.
  Consumers do not query RTMS, Capture, or Transcript tables.
- Founder Weekly Review and document workflows may discover included Call Notes through
  the same company-scoped knowledge retrieval used for other notes. No Call-specific
  feed or evidence adapter is added for release one.
- The full Transcript remains available inside the Call as evidence and exact search,
  not as a downstream RAG source.
- The chronological body, summary, and action items are sections of the canonical Call
  Note, not separately synchronized records or events.
- Participants remain call-local provider identities; they are not exported as contacts
  or LaunchStack users.
- Bookmark citations remain links from accepted note passages to Transcript segments.
  Bookmarks, citations, and embeddings are implementation evidence, not independent
  downstream products.
- Wiki synchronization, task creation, CRM/contact matching, automatic document
  generation, and dedicated Founder Weekly Review ingestion are deferred until a real
  consumer requires an ownership and synchronization contract.

This leaves one stable integration seam—company knowledge retrieval plus a Call deep
link—without making downstream capabilities understand capture-provider internals.
