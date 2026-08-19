---
id: MN-WF-005
title: Decide the AI Enrichment and Provenance Contract
parent: MN-WF-000
status: closed
assignee: Main
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-002
  - MN-WF-003
  - MN-WF-004
---

# Decide the AI Enrichment and Provenance Contract

## Question

How should post-call AI combine the user's steering notes with transcript evidence: precedence, omissions, contradictions, proposed edits versus automatic overwrite, citations to speakers and timestamps, repeat enrichment, model routing, structured outputs, and the boundary between an editable note and generated summary, decisions, and action items?

## Resolution

Enrichment is an explicit post-call action that creates one complete, editable proposal
beside the current canonical Call Note. It never overwrites the Call Note automatically.
The owner accepts or rejects the whole proposal; acceptance creates the next canonical
revision.

### Merge and output contract

- The finalized Transcript determines chronological order and topic coverage.
- The chronological body covers every substantive topic, decision, disagreement,
  commitment, and meaningful transition in discussion order. Greetings, repetition,
  filler, and technical noise may be omitted.
- Existing owner-note fragments are matched to their relevant Transcript topic or
  interval. The proposal may reorder those fragments to restore call chronology and may
  clarify, expand, and elaborate them, but it must preserve their intent.
- Substantive Transcript topics absent from the owner's note still receive generated
  notes.
- The proposal ends with a concise summary and structured action items.
- Unsupported owner context is retained and visibly labelled as owner-provided rather
  than Transcript-derived. A conflict between owner context and Transcript evidence is
  surfaced for review; neither source silently replaces the other.

### Provenance contract

- Every run records the Call, finalized Transcript identity, base Call Note revision,
  model ID, prompt/schema version, timestamps, status, and original structured output.
- Only passages generated from Bookmarks expose inline speaker/timestamp citations to
  immutable Transcript segment IDs. Other generated prose does not show segment-level
  citations; the run-level Transcript identity is its provenance boundary.
- The original model output remains distinguishable from owner edits made to the
  proposal before acceptance.
- Rejection preserves the canonical Call Note. Acceptance records the owner, accepted
  content, source enrichment run, and acceptance time as a new canonical revision.
- A later enrichment starts from the then-current canonical revision and finalized
  Transcript. At most one proposal is active for review; starting another run does not
  mutate canonical content.
- An unaccepted proposal never enters knowledge retrieval. If the Call Note is already
  included in company knowledge, only acceptance or a later manual save replaces its
  indexed canonical revision.

### Model boundary

Enrichment uses LaunchStack's configured chat-model routing and structured-output
validation, never the RTMS transcription source as an analysis model. Provider-specific
model code is not added. A missing or invalid model route fails the enrichment run
without changing the Call Note; it does not silently fall back to a different provider
or accept unvalidated prose.
