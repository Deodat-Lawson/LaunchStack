---
id: MN-WF-009
title: Decide the RTMS Session Reliability Model
parent: MN-WF-000
status: open
assignee: null
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-001
  - MN-WF-002
  - MN-WF-006
  - MN-WF-007
---

# Decide the RTMS Session Reliability Model

## Question

What state machine and persistence guarantees govern a single-user RTMS capture from authorization through start, buffering, transcript ingestion, duplicate or out-of-order packets, worker restart, transport reconnect, the Capture User leaving and returning, stop, finalization, and partial failure—and which guarantees are required for the internal pilot versus deferred until measured concurrency demands them? Same-user continuation through a new Capture Attempt is in scope; cross-user handoff is not.
