---
id: MN-IMP-004
title: Implement the Calls Product Surface
parent: MN-IMP-000
status: open
assignee: Hank
labels:
  - call-notes
  - frontend
  - product
tracker: local-markdown
blocked_by:
  - MN-IMP-001
---

# Implement the Calls Product Surface

## Outcome

The accepted single-workspace interaction becomes the production Calls experience: a persistent Calls rail, note-first Call workspace, live attributed Transcript, visible capture state/gaps, Bookmarks, privacy, post-call enrichment review, and deliberate knowledge inclusion.

## Contracts consumed and provided

Consumes `CallSnapshot`, Call Notes command/query schemas, stable product APIs, and deterministic fixtures. Provides production Calls routes/components/client behavior and UI-level accessibility/interaction tests without embedding domain or provider policy in the browser.

## Owned surface

Production Calls pages, layouts, components, client state, navigation entry, styling, and their UI tests. Product API handlers, domain persistence, shared contracts/schema, Zoom runtime, enrichment internals, and root integration files remain outside this lane.

## Acceptance

- The prototype's accepted interaction contract is preserved: one compact Live/Recent Calls rail and one restrained, note-first Call detail pane with a contained collapsed Transcript card.
- Start, detected-call suggestion, manual Zoom URL/meeting ID fallback, Pause, Resume, connecting/live/paused/partial/failed/finalizing states, and retryable outcomes are understandable without hidden provider assumptions.
- Transcript search filters the current immutable segment list; Bookmarks are visible on hover and keyboard/touch access; speaker/timestamp evidence remains legible.
- Note edits expose real saving/saved/failed state, never only optimistic local text.
- Transcript evidence stays company-visible; owner-only edits and private-note redaction are reflected exactly as returned by the API.
- AI-enhanced is a separate editable proposal with provenance/conflict/citation cues, explicit Accept/Reject, and no silent overwrite of My notes.
- Knowledge inclusion defaults off and clearly controls the canonical accepted Call Note, not Transcript indexing.
- Desktop and narrow-browser flows are visually exercised against contract fixtures, with keyboard access and reduced-motion behavior intact.

## Relevant decisions

MN-WF-003 through MN-WF-005, MN-WF-008, MN-WF-011, MN-WF-012, and MN-WF-014. The prototype at `/prototypes/call-notes` is behavior evidence only.

## Non-goals

Reusing prototype code as a production state store, writing product APIs, editing shared schemas, Zoom SDK work, AI orchestration, transcript correction, live copilot features, native/browser recording, or pixel-for-pixel preservation of discarded prototype variants.
