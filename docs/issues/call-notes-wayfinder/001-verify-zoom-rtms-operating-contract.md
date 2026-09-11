---
id: MN-WF-001
title: Verify the Zoom RTMS Operating Contract
parent: MN-WF-000
status: closed
assignee: ZoomRtmsContract
labels:
  - wayfinder:research
blocked_by: []
research_context: agent://ZoomRtmsContract
---

# Verify the Zoom RTMS Operating Contract

## Question

What current, source-verifiable Zoom RTMS contract constrains a self-hosted, multi-user LaunchStack deployment: General App ownership and distribution, Developer Pack billing, OAuth authorization scope, intra-account and external-meeting use, start and stop controls, host and administrator approval, participant disclosure, transcript packet semantics, webhook verification, reconnect and buffering behavior, concurrency limits, and the supported Node SDK/runtime path?

## Resolution comment

Resolved from official Zoom documentation and repositories checked on 2026-08-14. Full research context: [Zoom RTMS contract research](agent://ZoomRtmsContract).

- RTMS requires a user-managed Zoom General App, RTMS event subscriptions and scopes, and Developer Pack credits. A private app serves users in its owning Zoom account; durable external distribution requires reviewed unlisted or public publication. Approved beta authorization is temporary and capped.
- Account and group settings enable RTMS; hosts can approve or deny it; Zoom shows every participant that meeting content is being sent to one or more apps. Zoom documents host approval plus disclosure, not an all-participant click-to-consent flow.
- A REST start targets an invited participant who has joined while the host or designated alternate is present. RTMS can also auto-start or be controlled through supported in-client APIs.
- Transcript packets are continuous, speaker-attributed `msg_type: 17` messages carrying participant identity, timestamps, language, and text. Zoom documents no finality flag, total-order guarantee, deduplication key, or transcript replay guarantee; application finalization and post-processing are therefore required.
- The runtime contract is signed webhook → signaling WebSocket → media WebSocket → client-ready acknowledgement, with keepalives and bounded reconnection behavior. Audio has documented buffering; transcript replay during interruption is unspecified.
- The current official Node package targets a long-running Node runtime and its package metadata requires Node 22, despite older examples mentioning Node 20. A public HTTPS webhook and outbound WSS connectivity are required.
- Zoom's live pricing UI showed $0.02 per meeting streaming minute with transcription and $0.01 without on 2026-08-14. Public documentation does not unambiguously specify cross-account billing attribution for a reviewed app, universal concurrency, transcript replay/finality, or several timeout and stop-reason details; those remain support/account-verification questions rather than safe assumptions.

Primary sources: [RTMS setup](https://developers.zoom.us/docs/rtms/meetings/add-features/), [stream lifecycle](https://developers.zoom.us/docs/rtms/meetings/work-with-streams/), [media and transcripts](https://developers.zoom.us/docs/rtms/meetings/media/), [event reference](https://developers.zoom.us/docs/rtms/event-reference/), [reconnection](https://developers.zoom.us/docs/rtms/meetings/failover-reconnection/), [participant UX](https://developers.zoom.us/docs/rtms/meetings/ux-participant/), [distribution](https://developers.zoom.us/docs/distribute/), [webhooks](https://developers.zoom.us/docs/api/webhooks/), [official Node SDK](https://github.com/zoom/rtms), and [Developer Pack pricing](https://zoom.us/pricing/developer).
