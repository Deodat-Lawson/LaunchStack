---
id: MN-WF-014
title: Resolve the Human Calls and Agent Meetings Boundary
parent: MN-WF-000
status: closed
assignee: Main
labels:
  - wayfinder:grilling
blocked_by: []
---

# Resolve the Human Calls and Agent Meetings Boundary

## Question

LaunchStack already uses `Meeting` for a Slack-shaped channel where agents work an objective, with its own Meeting state, participants, messages, and minutes. What distinct product and domain language should the Zoom human-conversation feature use; should the two surfaces remain separate, replace one another, or share a higher-level concept; and what navigation boundary prevents users and code from confusing agent Meetings with captured human calls?

## Resolution comment

The existing agent collaboration feature remains **Meetings** and is not modified. The Zoom-first human-conversation feature is **Call Notes**, appears in navigation as **Calls**, and uses **Call** as its aggregate name. Calls and agent Meetings keep separate routes, tables, lifecycle states, participant models, and product surfaces; they meet only through existing knowledge outputs such as notes, documents, decisions, and action items. `Meeting` remains reserved for the existing agent collaboration domain, while provider-specific prose may still refer to a Zoom or Google meeting.
