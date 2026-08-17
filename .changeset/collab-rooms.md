---
"@launchstack/core": minor
---

Add rooms — ask every member one question at once, each answering from its own
documents.

A meeting is a conversation: one speaker, elected from the transcript, working
toward a close. A room is a query: one question, every member, concurrently, no
floor to hold. They share a channel log and nothing else.

**New exports** from `@launchstack/core/collab`: `askRoom`, `summarizeRounds`,
`buildRoomTurnContext`, `extractDecline`, `ROOM_DECLINE_MARKER`,
`DEFAULT_MEMBER_TIMEOUT_MS`, and the `RoomConfig` / `RoomAnswer` /
`AskRoomResult` / `RoomRound` types.

`askRoom` is a function rather than a method on `MeetingOrchestrator` for three
reasons: the orchestrator marks a whole meeting `failed` when no runtime serves
a persona, which is the ordinary case for a room member that is offline; a room
carries no state between rounds, so there is nothing to persist; and
`maxConsecutiveFailures` is meaningful for a conversation and actively wrong for
a fan-out, where one member failing says nothing about the rest.

A round has no row of its own. The question carries `meta.round = { id,
expected }`, each answer carries `meta.roundId` and its status, and
`summarizeRounds()` reconstructs the round from the log — the same rule meetings
follow, where the channel is the only transcript.

**`TurnContext` gains an optional `mode`.** Absent means `meeting`, so a worker
built before rooms existed keeps its current behaviour. `buildSystemPrompt`
branches on it: a room member answers once, alone, and is told that declining is
a useful answer, rather than being given a turn budget and handoff instructions
for a room that does not exist.

Members are deliberately isolated — each receives the question only, never the
other answers. If they saw each other, the first to finish would anchor the
rest, and the fan-out would collapse into a slower conversation.
