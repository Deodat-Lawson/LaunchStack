---
"@launchstack/pipelines": minor
---

A refused stage move now says what it was as values beside its English
message: `StageTransitionError.details` carries the stages involved, the
moves that were allowed and the missing requirements, and each
`StageRequirementError` names its `target` stage. The app words a refusal
in the reader's language from these; the messages are unchanged.
