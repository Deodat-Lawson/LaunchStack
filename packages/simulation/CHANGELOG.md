# @launchstack/simulation

## 0.2.0

### Minor Changes

- 614e7d8: A scenario's subject can now be a few paragraphs (a plan, its actions and the
  current cases) without every turn repeating it. `buildBriefRequest` asks a
  subject longer than `TURN_SUBJECT_CHARS` (600) to be restated in at most 90
  words, `parseBrief` returns it as `Brief.situation`, and `turnSituation`
  picks what turns read: undefined for a short subject, else the restatement,
  else the subject's first 600 characters. `createWorld` takes it as
  `situation`, and `personaSystem` reads `World.situation` before
  `World.subject`; the brief, cast and report still read the whole subject.
  The pipelines brief schema gains `situation`, and runs pass the restatement
  into the world.
- 25c9232: Scenario crowds now behave like careful buyers. Every persona has a wallet
  (`currentSolution`, `budget`, `buyingRole`, `switchingCost`, `objection`), and
  a cast asks for a starting mix of stances (`REALISTIC_MIX`, 35% against);
  `skepticShortfall`, `seatsToRecast` and `fillSeats` let a host recast the
  missing skeptics when a cast comes back too warm, which scenario runs now do
  once (post tests, whose audience follows the brand, aim for 20% against). Turns weigh cost,
  switching and proof, and return `convincedBy`, `wouldPay` and `objection`.
  `runRound` applies `guardStance`: a stance moves at most
  `SimulationConfig.maxStanceStep` (1) per round, and a move toward the subject
  needs `convincedBy` to name a post from the agent's feed
  (`warmingNeedsReason`). Round summaries count `wouldPayCounts`, and the
  report and interviews read would-pay and objections. The pipelines' zod reply
  schemas mirror the new fields, with a test that they match the engine's.
- b08dc2a: Scenarios contract v2: durable, exactly-once runs and evidence-grounded people.
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

- 49a4fa5: Add `@launchstack/simulation`: a round-based social-network simulation, an
  independent TypeScript implementation of the OASIS design (CAMEL-AI,
  Apache-2.0; see NOTICE). Agents with an activation probability read a feed
  ranked by interest similarity, Reddit hot score and time decay plus the
  most-liked posts of accounts they follow, then post, comment, like, dislike,
  repost, quote or follow. `runRound` is deterministic per seed and never
  mutates its input, so a host can persist the world between rounds and retry
  a round safely. Also: evidence-cited cast building, a shared brief, narrator
  events injected between rounds, a report with engine-computed factions,
  interviews, run cost estimates, and rank-based calibration helpers. Zero
  dependencies; the host injects the model.
