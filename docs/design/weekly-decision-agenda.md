# Weekly Decision Agenda — integration brief

Status, 2026-10-16: [Contract v1](weekly-decision-agenda-contract-v1.md) is frozen
by TL approval. TL backend code is present; real database and integrated
acceptance are pending. A owns frontend; B owns AI generation/fallback/harness.

## Flow and ownership

1. A sends generation/review requests to TL's authenticated API.
2. TL selects the New York report period and reads authorized synthetic records
   from the isolated test database. Current evidence and historical context differ.
3. B receives GenerationInput and a server-only runtime, then returns
   GenerationResult: draft, signals, enhancement candidates and actual execution mode.
4. TL validates identity/source references, checks report changes and saves the
   result. A renders the saved response and supports founder review.

| Boundary                                                    | Owner | Handoff                                                          |
| ----------------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| Data, test access, API, versions and storage                | TL    | Typed input to B; saved response to A                            |
| Evidence pack, prompts, real model, fallback, harness       | B     | Structured result with refs, enhancements and execution metadata |
| Controls, report/source display, editing, enrichment review | A     | Requests, stable decision keys and browser evidence              |

Shared types: [contract-v1.ts](../../pipelines/src/vantage/contract-v1.ts).
Complete fixtures: [request/response examples](examples/weekly-decision-agenda-v1.json).
The existing Vantage domain remains canonical; the new state table holds review,
version and submission metadata. Existing code findings at commit 6134214 are
historical source evidence, not runtime proof for this revision.

## Current implementation boundary

TL added period-scoped data loading, explicit test-operator access, generation
input/output validation, version-aware save, primary-action submissions and
separate enhancement review. The [generation port](../../apps/web/src/server/vantage/generation-port.ts)
is intentionally uninstalled. B supplies a conforming function; TL connects it during server setup;
until then generation returns 503 generation_unavailable. No fake model success.

The test gate requires VANTAGE_TEST_MODE=true, VANTAGE_TEST_COMPANY_ID,
VANTAGE_TEST_USER_IDS, and VANTAGE_TEST_DATABASE_URL matching DATABASE_URL.
Use a dedicated database, not production configuration. A read-only real-document
adapter is later work; this milestone does not collect real documents.

A new forward product migration adds metadata and primary-action uniqueness.
It has not been applied. Existing duplicate topic links must be reviewed before
migration; no automatic deletion/repair is performed. Old migrations are preserved.
The initial pilot uses short write serialization in the isolated DB; production
throughput and rollout remain outside this acceptance.

## Review gates

- Week 1: real AI plus fallback, runnable founder workflow, persisted edits.
- Week 2: improve grounding, prompt quality and enrichment review; decide any real-source adapter.
- Week 3: recovery/follow-up and durable execution only if needed.
- Week 4: integrated verification and an explicit controlled-pilot decision.

Staff/sales workflows, sharing, exports, external delivery and scheduling remain
deferred. See [assignments](../issues/weekly-decision-agenda.md) and
[acceptance record](../runbooks/weekly-decision-agenda-week1.md).
