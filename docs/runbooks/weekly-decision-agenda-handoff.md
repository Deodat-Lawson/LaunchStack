# Weekly Decision Agenda — branch handoff

This branch contains Contract v1, complete examples and the Tech Lead's backend
foundation. The founder feature is not yet accepted as an integrated application.

## Read first

1. [Frozen English Contract v1](../design/weekly-decision-agenda-contract-v1.md)
2. [Complete HTTP and generation examples](../design/examples/weekly-decision-agenda-v1.json)
3. [Owner assignments](../issues/weekly-decision-agenda.md)
4. [Observed checks and pending acceptance](weekly-decision-agenda-week1.md)
5. [Run the local TL checks](weekly-decision-agenda-local-tests.md) — `pnpm test:tl`

## Team I/O

| Owner               | Input                                      | Output / next work                                                                                               |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Tech Lead           | Authenticated test requests and B's result | Authorized, period-bounded GenerationInput; validated and persisted API responses                                |
| Member A — frontend | Saved API responses and HTTP examples      | Generate/result/source/edit UI, explicit enhancement review and stable decision keys                             |
| Member B — AI       | GenerationInput plus server-only runtime   | GenerationResult with draft, signals, source-linked enhancements, real AI/fallback metadata and harness evidence |

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

TL verification now includes a clean-source copy of the branch plus the current
TL-only fixes, excluding earlier drafts: 51 pipeline tests and 184 selected web
tests passed. These include 41 real PostgreSQL cases for data, auth context,
actual route handlers, concurrency and rollback. Both typechecks and changed-file
lint passed. All 4 engine and 28 product migrations applied to a new disposable DB.

The [local launcher](weekly-decision-agenda-local-tests.md) was also verified on
Windows from fresh copies without installed dependencies or application `.env`:
247 tests passed, including the same 41 real DB cases. Hardened inherited settings,
stop/reuse and occupied-port/remote-Docker guards were checked; four launcher
helper tests passed separately. Dependency installation reused the pnpm cache.

Session identity/cookie access and generation in these tests are explicit doubles;
actual login, a running HTTP server, live AI and browser acceptance remain pending.
The full-repository check has no pass; an additional existing history formatter
test fails on this machine's Chinese locale. See the linked acceptance record for
precise results and reproduction. No business DB was modified. The user authorized
publishing this TL-only change set to `feat/weekly-agenda-contract-v1`; earlier
frontend and generation drafts remain excluded. Publication does not complete
the remaining integrated acceptance.

For the isolated TL checks, follow the [one-command local setup](weekly-decision-agenda-local-tests.md).
For interactive app testing, use normal repository setup and configure the explicit
test operator/database gate described in the integration brief. A/B must review
the contract and run the remaining checks after their implementations are connected.
