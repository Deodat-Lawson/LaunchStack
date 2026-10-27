---
"@launchstack/simulation": minor
"@launchstack/pipelines": patch
---

A scenario's subject can now be a few paragraphs (a plan, its actions and the
current cases) without every turn repeating it. `buildBriefRequest` asks a
subject longer than `TURN_SUBJECT_CHARS` (600) to be restated in at most 90
words, `parseBrief` returns it as `Brief.situation`, and `turnSituation`
picks what turns read: undefined for a short subject, else the restatement,
else the subject's first 600 characters. `createWorld` takes it as
`situation`, and `personaSystem` reads `World.situation` before
`World.subject`; the brief, cast and report still read the whole subject.
The pipelines brief schema gains `situation`, and runs pass the restatement
into the world.
