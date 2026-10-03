---
id: MN-WF-002
title: Define the Call Notes Domain Model
parent: MN-WF-000
status: closed
assignee: Kien
labels:
  - wayfinder:grilling
blocked_by: []
---

# Define the Call Notes Domain Model

## Question

What are the canonical concepts, ownership rules, identities, and lifecycle boundaries for a Call, Capture, Capture Attempt, Capture User, Participant, Transcript, Call Note, Enriched Note, and generated outputs—especially when several LaunchStack users attend the same Zoom meeting, view company evidence, or authorize competing capture attempts?

## Resolution comment

The Call Notes domain uses these boundaries:

- A **Call** is one real Zoom meeting occurrence inside one LaunchStack company. Recurring provider identifiers do not merge occurrences, and separate LaunchStack companies never share a Call or Capture.
- A company owns the Call, its single logical **Capture**, Participants, immutable Transcript, and transcript **Bookmarks**. Every authorized company user can view the Transcript and Bookmarks; only the Call Note owner creates Bookmarks. The Capture can contain multiple **Capture Attempts** when provider streaming stops and later resumes.
- Zoom anchors each RTMS session to one authorized **Capture User** who is present in the Zoom meeting and exclusively controls that Capture Attempt. LaunchStack's worker is not a meeting participant, and Zoom exposes no company-level service identity. Cross-user continuation is deferred.
- The first LaunchStack user whose capture start succeeds owns the Call's one canonical **Call Note**. It is shared read-only with the company by default, but the owner can make it private during or after the Call; other users then see the Transcript without a note and cannot create another. Ownership transfer is deferred.
- An **Enriched Note** is an AI-proposed revision grounded in the Transcript. It preserves existing owner steering, may propose a complete Call Note when blank, and becomes canonical only after side-by-side owner approval; revision history preserves the prior note.
- The Transcript remains immutable and speaker-attributed. Transcript editing is deferred. A Participant keeps provider-supplied call-local identity and name; no LaunchStack-user/contact linking or name-based reconnect merging is required.
- Capture outcome is `complete`, `partial`, or `failed`. If the Capture User leaves, or capture starts late, ends early, or has a known gap, LaunchStack retains the evidence received and marks the Transcript partial. The same Capture User can continue the logical Capture through a new Capture Attempt after returning; the initial release does not hand it to another user.

Canonical terminology is recorded in [`CONTEXT.md`](../../../CONTEXT.md). Target-account access remains assigned to [Confirm RTMS Access in the Target Zoom Account](./013-confirm-target-zoom-rtms-access.md); cross-user continuity is a later effort.
