---
id: MN-WF-000
title: Plan LaunchStack Call Notes Architecture
status: open
assignee: null
labels:
  - wayfinder:map
tracker: local-markdown
---

# Plan LaunchStack Call Notes Architecture

## Destination

An architecture decision set for a Zoom-first, self-hosted LaunchStack Call Notes feature. The map is complete when the product and domain boundaries, Zoom capture lifecycle, knowledge model, module and runtime topology, deployment, security, operations, and future adapter seams are settled; implementation remains a separate handoff.

## Notes

- Domain: Founder OS call capture and AI-assisted notes integrated into LaunchStack.
- Every decision session should consult the `grilling`, `domain-modeling`, and `ponytail` skills and the current LaunchStack architecture documentation.
- Fully decide Zoom RTMS; use Google Meet and native capture only to pressure-test future seams.
- Make self-hosted Docker the authoritative deployment. A hosted LaunchStack OAuth application is not part of this effort.
- The operator owns the Zoom General app, Developer Pack billing, OAuth credentials, and public deployment endpoint.
- During a call, LaunchStack must provide a live Zoom-attributed transcript and a place for the user to write notes. AI enrichment happens after the call, not as a live copilot.
- Each Capture Attempt is anchored to one authorized Capture User. If that user leaves, the attempt ends and any retained Transcript is partial; the same user can continue the logical Capture in a new attempt after returning, while cross-user handoff is deferred.
- Zoom's attributed transcript is the initial transcription source. Custom streaming ASR and raw-audio retention are not launch requirements.
- Transcript evidence and the owner-authored Call Note are both first-class inputs. The architecture must preserve transcript thoroughness, owner steering, visibility, and provenance when AI enriches the note.
- Existing code distinguishes editable, embedded `document_notes` from versioned, ingested `document` knowledge sources. The map must decide how a Call links or materializes both rather than assuming they are interchangeable.
- Local-markdown tracker convention: ticket frontmatter records parent, label, status, assignee, and blocking relationships. An open ticket with `assignee: null` is unclaimed; a ticket is on the frontier when every `blocked_by` ticket is closed.

## Decisions so far

- [Verify the Zoom RTMS Operating Contract](./001-verify-zoom-rtms-operating-contract.md) — RTMS is viable for an operator-owned private app, but requires a long-running signed webhook/WebSocket runtime and application-owned transcript finalization; several commercial and replay guarantees remain undocumented.
- [Define the Call Notes Domain Model](./002-define-call-notes-domain-model.md) — A company-scoped Call occurrence owns one logical Capture and immutable Transcript; its initiating user owns one revisioned Call Note, shared read-only with the company by default but optionally private, and each initial Capture Attempt stays anchored to one authorized Capture User.
- [Resolve the Human Calls and Agent Meetings Boundary](./014-resolve-calls-agent-meetings-boundary.md) — The existing agent Meetings feature remains untouched; the new human-conversation feature is Call Notes, uses Calls in navigation and Call in the domain, and shares only downstream knowledge outputs with agent Meetings.

## Not yet specified

- The final ADR/document split and execution handoff shape will become clear only after the substantive architecture decisions close.
- Operator upgrade, migration, and backward-compatibility obligations depend on the selected deployment and persistence boundaries.
- Whether future providers need transcript revision semantics, raw-media capabilities, or only finalized attributed segments depends on the Call aggregate and Zoom operating contract.

## Out of scope

- Implementing the feature or producing a build-task backlog.
- A complete Google Meet, native recorder, browser recorder, or meeting-bot implementation.
- A centrally hosted LaunchStack OAuth app, Marketplace publication, centralized RTMS billing, or SaaS pricing.
- Custom streaming ASR and raw-audio recording for the Zoom-first release.
- Pixel-level visual design beyond prototypes needed to resolve architecture-affecting behavior.
- User-editable transcript correction tooling; the Zoom-first model keeps transcript evidence immutable.
- Participant-to-LaunchStack-user or contact identity matching; the first release keeps provider-supplied participant names and call-local identities only.
- Cross-user Capture handoff, overlapping RTMS user sessions, and continuity billing. Same-user continuation through a new Capture Attempt remains in scope.
