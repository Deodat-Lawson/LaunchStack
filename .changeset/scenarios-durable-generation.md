---
"@launchstack/pipelines": minor
"@launchstack/llm": minor
"@launchstack/simulation": minor
---

Scenarios contract v2: durable, exactly-once runs and evidence-grounded people.

- `@launchstack/pipelines/scenarios/v2`, plus its `db`, `engine`, `stages`,
  `graph-http` and `read` subpaths: a v2 run is a plan of units, each executed
  under a fenced lease.
  - A unit's outputs, its credit settlement and its journaled model replies
    commit in one transaction.
  - Acceptance, idempotency, the first hold and the dispatch outbox are one
    transaction.
  - Graph mode builds a Graphiti + Neo4j graph through the private
    `services/scenario-graph`.
  - Cast fields carry a basis (source, inferred, assumed, unknown) and
    evidence ids.
  - A finished run replays from its recorded turns with no model calls.
  - Contract v1 runs are unchanged.
- `@launchstack/llm`: `resolveChatModel({ longWait: true })` sends a request
  through undici's own client, so a timeout longer than Node's five-minute
  limit on waiting for reply headers is honoured. `longWaitFetch` and
  `NODE_FETCH_HEADERS_TIMEOUT_MS` are exported.
- `@launchstack/simulation`: a persona can carry its cast `slotId` and the
  facts it `knows`, and new model purposes cover the ontology, the cast plan
  and the attributed cast.
