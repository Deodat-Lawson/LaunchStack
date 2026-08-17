---
"@launchstack/core": minor
---

Ground meeting agents in the workspace's documents, and ship a preset startup
team.

**Turn-level grounding**

Meeting agents were the one part of the product that reasoned about documents
without ever reading them: `MeetingConfig.context` existed, and nothing
populated it. Retrieval is now a port on the engine —
`TurnGroundingProvider` — consulted before each turn for the persona *about to
speak*. The engine still knows nothing about documents or indexes; the
implementation over the existing ensemble retriever lives in the host.

**New exports** from `@launchstack/core/collab`: `TurnGroundingProvider`,
`TurnGrounding`, `TurnGroundingRequest`, `GroundingSource`,
`buildGroundingQuery`, `toExcerpt`, `EMPTY_GROUNDING`, `MAX_EXCERPT_CHARS`.
`MeetingOrchestratorOptions` and `CreateMeetingInput` accept
`groundingProvider`; the orchestrator additionally takes `onGroundingError`.

Retrieval is per-persona because the analyst and the engineer ask the corpus
different questions, capped at four passages because each turn already carries
the whole transcript, and never fatal — a failure yields an ungrounded turn
rather than a dead meeting.

**Behaviour change: `evaluateMeeting` grounding dimension**

`scoreGrounding` now builds its haystack from `config.context` *and* the
excerpts recorded on each message, rather than `config.context` alone. A
meeting grounded purely by retrieval previously scored "no context supplied —
dimension not applicable" at weight 0; it is now scored. Meetings with no
grounding at all are unaffected.

This is why turns record a truncated excerpt of what they read alongside the
citation: it keeps a grounded transcript checkable without the index still
being around, and lets the scorer tell a cited number from an invented one.

**Behaviour change: `selectNextSpeaker` follows the last mention**

`findMention` returned the *first* `@handle` in a message. A turn in a working
channel opens by answering whoever spoke last and closes by asking someone
else, so the first mention is a reply-to and the last is the actual handoff —
taking the first sent the floor back to the person who had just spoken and
starved the specialists. Under `reactive` and `moderated`, the last mention now
wins.

Single-mention messages are unaffected, which is why no existing test moved:
every scripted line in the suite carries exactly one mention. This was found by
running a real meeting.

