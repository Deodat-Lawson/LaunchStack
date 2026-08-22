---
id: MN-IMP-001
title: Freeze the Call Notes Contract Baseline
parent: MN-IMP-000
status: closed
assignee: Kien
labels:
  - call-notes
  - contracts
  - architecture
tracker: local-markdown
blocked_by: []
---

# Freeze the Call Notes Contract Baseline

## Outcome

One versioned, executable source of truth lets four lanes implement independently without inventing competing Call, Capture, Transcript, note, enrichment, or knowledge contracts.

## Owned surface

- `packages/features/src/call-notes/contracts.ts`
- `packages/features/src/call-notes/ports.ts`
- `packages/features/src/call-notes/schema.ts`
- `packages/features/src/call-notes/testing.ts`
- `packages/features/src/call-notes/index.ts`
- `packages/features/src/schema.ts` and package exports
- Call Notes product migrations
- Shared contract behavior tests

## Acceptance

- Public commands, normalized provider events, query snapshots, enrichment structures, and knowledge output parse through exported Zod schemas.
- The persistence schema represents Call, one logical Capture, multiple Capture Attempts, immutable segments, participants, gaps, Bookmarks, canonical-note revisions, enrichment runs, durable work, and operator-owned Zoom authorization.
- Stable occurrence, attempt, provider-event, packet-hash, request, and work-item keys define replay behavior.
- Deterministic fixtures cover detected-candidate Dismiss, Start, authoritative Pause/Resume commands, duplicate and late Transcript delivery, capture-user departure, automatic same-user continuation as a new attempt, partial finalization, owner-only Bookmarks, wrong-company not-found behavior, private-note and knowledge isolation, enrichment review/acceptance, transcript search, and knowledge inclusion.
- Reusable capture-source and application conformance boundaries are exported for every lane.
- Feature and web typechecks plus focused contract tests pass.

## Relevant decisions

MN-WF-001 through MN-WF-014.

## Non-goals

No Zoom SDK connection, production repository/service, API route, UI, model call, embedding job, Docker wiring, or substitute in-memory Call Notes implementation.

## Resolution

The baseline is frozen at `call-notes/v1` with enrichment output `call-notes-enrichment/v1`. Contract changes now use the epic's strict change protocol and are integrated only by Kien.
