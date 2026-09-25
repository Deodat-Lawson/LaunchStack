---
"@launchstack/collab": minor
---

Add meeting phases: `MeetingConfig.phases` describes a workflow inside a
meeting — each phase has a goal, a turn budget and an optional speaker
subset. Phase position is a pure function of the turn index (`phaseAt`), so
a meeting still replays from its log. The orchestrator narrows the room to
the phase's speakers, restarts the rotation per phase, announces each change
as a system message (`meta.event === "phase"`), exposes `state.phaseIndex`,
and injects the current phase into every turn's prompt. `createMeeting`
accepts `phases` and `workflowKey`; `phasePlanProblems` validates a plan
against a room. Meetings without phases are unchanged.

Minutes also recognise a chaired meeting's close: "recommendation for the
approver", "we recommend", and a sentence that starts with "Option:" or
"Recommendation:" count as decisions; "Owner:" and "X owns …" count as
action items.
