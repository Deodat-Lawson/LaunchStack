---
id: MN-WF-006
title: Decide the LaunchStack Module and Runtime Boundaries
parent: MN-WF-000
status: open
assignee: null
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-001
  - MN-WF-002
  - MN-WF-004
---

# Decide the LaunchStack Module and Runtime Boundaries

## Question

Which responsibilities belong in `apps/web`, a long-running workspace application such as `apps/call-worker`, `packages/features`, `packages/core`, PostgreSQL, object storage, Inngest, and the existing batch transcription sidecar—and what dependency and process boundaries keep Zoom lifecycle code, product policy, knowledge integration, and portable infrastructure from leaking into one another?
