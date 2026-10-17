# Weekly Decision Agenda — branch handoff

This branch contains Contract v1, complete examples and the Tech Lead's backend
foundation. The founder feature is not yet accepted as an integrated application.

## Read first

1. [Frozen English Contract v1](../design/weekly-decision-agenda-contract-v1.md)
2. [Complete HTTP and generation examples](../design/examples/weekly-decision-agenda-v1.json)
3. [Owner assignments](../issues/weekly-decision-agenda.md)
4. [Observed checks and pending acceptance](weekly-decision-agenda-week1.md)

## Team I/O

| Owner | Input | Output / next work |
| --- | --- | --- |
| Tech Lead | Authenticated test requests and B's result | Authorized, period-bounded GenerationInput; validated and persisted API responses |
| Member A — frontend | Saved API responses and HTTP examples | Generate/result/source/edit UI, explicit enhancement review and stable decision keys |
| Member B — AI | GenerationInput plus server-only runtime | GenerationResult with draft, signals, source-linked enhancements, real AI/fallback metadata and harness evidence |

B supplies a conforming generation function; TL connects it to the server.
The adapter is intentionally uninstalled until B's work is ready. Generation
currently returns 503 generation_unavailable rather than fabricated success.

Week 1 uses America/New_York, an isolated test DB/workspace and one primary action
per topic. Monday defaults to the prior complete week; other days use the current
week to the captured cutoff. Preserve human content and review additions separately.

## Included and excluded work

The selected change set includes TL data/auth/API/storage, shared I/O, the forward
product migration, Contract/examples/docs, and reviewed backend history/export
restrictions required by the isolation contract. These dependencies must travel
together. Earlier frontend and AI-generation drafts are not part of this handoff.

The existing working directory may still contain those excluded drafts. Switching
branches carries uncommitted work with it; a normal commit includes staged files
only. Do not stage everything indiscriminately for this handoff.

## Verification boundary

The working-tree validation recorded 39 pipeline tests and 35 selected web tests
passing, both relevant package typechecks passing, and TL changed-file lint passing.
Those checks are not an independent clean-checkout integration result. The whole
repository check ran out of Node heap memory. The new migration, real PostgreSQL
concurrency/rollback, real model and integrated browser checks remain pending.
Apply migrations only to the configured isolated database; no business DB was modified.

Use the normal repository setup, then configure the explicit test operator/database
gate described in the integration brief. A/B must review the contract and run the
remaining checks after their implementations are connected.
