---
id: MN-WF-008
title: Decide Identity, Consent, Tenancy, and Retention Boundaries
parent: MN-WF-000
status: closed
assignee: Main
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-001
  - MN-WF-002
  - MN-WF-007
---

# Decide Identity, Consent, Tenancy, and Retention Boundaries

## Question

How do Clerk identity and company tenancy relate to Zoom app ownership, Zoom users, meeting hosts, participants, and stored OAuth tokens; who may start, view, enrich, share, export, or delete a Call; what consent evidence is retained; and what transcript, note, token, and derived-artifact retention defaults make an OSS deployment safe without inventing a compliance platform?

## Resolution

Call Notes uses existing Clerk company membership as its only application tenancy
boundary. It records the consent and authorization facts Zoom and LaunchStack can
actually observe, retains Call data until explicit deletion, and does not claim to be a
general compliance or retention-policy system.

### Identity and tenancy

- The self-hosting operator owns and configures the Zoom General App for the deployment.
  That app is infrastructure identity, not a LaunchStack company or user.
- A Zoom connection belongs to exactly one Clerk user in one LaunchStack company and
  stores the authorized Zoom account/user identifiers. The same person must authorize
  separately in another company context.
- A Capture User is the company member whose connected Zoom identity controls the
  Attempt. It does not confer Transcript or company ownership.
- Provider Participants remain call-local identities and display names. They are not
  matched to Clerk users, contacts, or participants in another Call.
- Every Call Notes row and command carries `company_id`; uniqueness, lookup, mutation,
  worker claims, and retrieval filters include it. Wrong-company access resolves as not
  found.

### Authorization

- An active company member with a valid Zoom connection may start capture for an
  eligible occurrence. Concurrent starts converge on the existing company Capture.
- All active members of the Call's company may view its Transcript and company-visible
  Call Note.
- Only the Call Note owner may edit it, create Bookmarks, request or accept enrichment,
  change visibility, and enable or disable company-knowledge inclusion.
- A private Call Note is visible only to its owner and is excluded from company
  knowledge; the company Transcript remains visible.
- There is no external share link or export workflow in release one.
- A company administrator may explicitly delete a completed or non-empty Call. The Call
  Note owner may delete only an empty failed Call, as settled by the interaction
  contract. No background cleanup deletes Calls.

### Authorization secrets

- OAuth access and refresh tokens are encrypted at rest with an operator-supplied key,
  never returned to the browser, embedded in images, committed, or written to logs.
- Tokens are scoped to company plus LaunchStack user, refreshed only by an authorized
  runtime, and removed when the connection is disconnected, revoked, or its user/company
  is removed. Disconnecting Zoom does not delete already captured company evidence.
- The worker receives only credentials needed to claim and operate its authorized work;
  Clerk browser/session credentials are not copied into it.

### Consent evidence

- LaunchStack retains the Capture User's explicit initial Start command, any manual
  Pause/Resume, automatic same-user continuation events, relevant Zoom account/app
  setting facts, webhook/event identifiers, host approval outcome when supplied, and
  timestamps.
- Automatic continuation after the same user returns is recorded as a new Attempt under
  the still-open Capture. It is not treated as a new participant-wide consent event.
- Zoom owns its participant disclosure and host/admin approval UX. LaunchStack may state
  that Zoom displayed or reported those controls only when observed; it never stores or
  presents an invented “all participants consented” assertion.
- The UI clearly identifies capture state and partial intervals. Provider disclosure is
  not replaced by a hidden LaunchStack-only indicator.

### Retention and deletion

- Calls, Transcript segments, Gaps, Bookmarks, Call Note revisions, enrichment runs,
  model metadata, and consent evidence are retained until explicit deletion. Release one
  has no automatic duration, per-artifact retention matrix, or scheduler.
- Rejected or failed enrichment output remains attached to the Call for provenance but
  never enters knowledge retrieval.
- Deleting a Call is a company-scoped, audited cascade that removes Transcript evidence,
  Bookmarks, Note revisions and embeddings, enrichment artifacts, and provider
  lifecycle/consent records. It does not delete the operator's Zoom app or unrelated
  user authorization.
- Disabling company-knowledge inclusion deletes the retrieval embedding only; it does
  not delete the Call Note or Call.
- No raw audio, video, or screen share is retained in the Zoom-first release.

Operators that require timed retention, legal hold, export, or deletion approvals must
add those as explicit future product requirements. Release one prefers visible,
operator-controlled deletion over silent loss or a partial compliance framework.
