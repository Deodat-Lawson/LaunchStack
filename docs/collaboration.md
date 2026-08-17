# Meetings, Slack, and distributed agents

A **meeting** is a conversation that runs inside a **channel**. Agents take
turns working an objective; a human can read along, comment, or take the floor
outright; and the whole thing can be mirrored into a real Slack channel. The
agents do not have to run on the same machine as the app.

The design rule that everything else follows from: **the channel log is the
only transcript**. A meeting row records configuration and where the turn
rotation got to — it does not hold a second copy of what was said. Human
takeover, the Slack mirror, and remote agent nodes are then all just readers
and writers of the same log, with nothing to keep in sync.

---

## Where the code lives

| Path | What it is |
| --- | --- |
| `packages/adapters/src/collab/` | The engine. No Next, no Clerk, no database, no `process.env`. |
| `packages/adapters/src/collab/net/` | The signed HTTP protocol, the hub, the worker, the `node:http` adapter. |
| `packages/adapters/src/collab/slack/` | Slack Web API port, signature verification, the two-way bridge. |
| `packages/adapters/src/collab/grounding.ts` | The turn-level retrieval port and its query builder. |
| `packages/adapters/src/collab/evals.ts` | Deterministic meeting scoring. |
| `packages/core/src/collab/` | Re-export facade only (ADR-002). No logic may be added here. |
| `apps/web/src/server/db/schema/collab.ts` | Channels, messages, personas, meetings, nodes. |
| `apps/web/src/server/collab/` | Postgres store, the process-wide hub, the model adapter, presets, retrieval. |
| `apps/web/src/app/api/collab/` | Meeting routes, the hub mount, the Slack events receiver. |
| `apps/web/src/app/employer/documents/_workspace/collab/` | The Meetings surface and the agent roster. |
| `apps/web/scripts/collab-hub.ts` | Standalone hub, for running the meeting plane on its own host. |
| `apps/web/scripts/collab-worker.ts` | Agent worker. Run this on any machine that should host agents. |

Import from `@launchstack/core/collab` regardless — the facade is the public
entry point, and `scripts/ci/check-core-facade.mjs` keeps it a pure re-export.

---

## Running a meeting

1. **Settings → Agents & nodes** defines the roster. A workspace that has never
   opened it gets four starter agents seeded on first read, so nothing
   dead-ends on an empty picker. **Preset teams** at the top of that pane add a
   whole room in one click — see [Preset teams](#preset-teams).
2. **Meetings → New** picks the participants, states the objective, chooses how
   the floor moves, and optionally attaches documents to ground the agents in —
   see [Grounding](#grounding).
3. The channel view shows the transcript. `Run` advances a few turns at a time;
   `Take over` stops the agents and gives you the floor; `End` closes the
   meeting and produces minutes.

### How the floor moves

| Policy | Behaviour |
| --- | --- |
| `round_robin` | Fixed rotation. Deterministic, and nobody gets crowded out. |
| `moderated` | A chair opens and closes, and hands the floor to whoever they name with `@handle`. Unclaimed turns return to the chair rather than stalling. |
| `reactive` | Whoever was addressed speaks next; failing that, the persona whose role words best match the last message. Falls back to rotation so one voice cannot dominate. |

A meeting ends when an agent emits the completion marker (`MEETING_COMPLETE` by
default, stripped before the message is stored), when a human closes it, or
when it hits `maxTurns`. The marker is control flow, not conversation — it
never reaches the transcript.

### Human takeover

Three distinct things a person can do, deliberately kept separate:

- **Comment.** Post into the channel without taking control. The agents read it
  on their next turn.
- **Take the floor.** Agent turns stop until you hand control back.
- **Occupy a seat.** Take over *as* `@eng`; your messages are attributed to both
  you and the seat, and the seat's turn is consumed so the rotation keeps
  moving rather than immediately handing the floor back.

An agent speaking while a human holds the floor is a correctness bug, not a
quality shortfall — the eval suite scores it as an outright failure.

---

## Rooms

A **meeting** is a conversation: one speaker at a time, elected from the
transcript, working toward a close. A **room** is a question: one question,
every member, concurrently, no floor to hold.

```
POST /api/collab/rooms/{id}/ask   { "text": "What breaks if the token becomes a JWT?" }

  @legal    Clause 11.2 caps liability at 12 months of fees.   ← reads contracts/
  @ops      Nothing in my sources covers that.                 ← reads runbooks/
  @finance  The Growth tier is 58% of self-serve revenue.      ← reads finance/
```

Members are bound to **different document sets**, which is the entire point.
Measured across 39 live runs, a room whose members all read the same corpus
performs no better than asking one agent and costs 3–5× the wall-clock — so the
value of a room is exactly the information its members do *not* share.

| | |
| --- | --- |
| Concurrent | Members run in parallel; wall time is the slowest member, not the sum. |
| Isolated | Each member sees the question only, never the other answers. Otherwise the first to finish anchors the rest and it stops being a fan-out. |
| Independently settled | A member that fails, declines, times out, or has no runtime becomes one message. There is no round-level failure. |
| Derived | A round has no row: the question carries its id and expected roster, each answer carries the round id. `summarizeRounds()` reconstructs it from the log. |

Retrieval runs as the **asking human**, never the room's creator — otherwise a
room becomes a way to read documents you could not open yourself. The room's
document set narrows the corpus; the asker authorizes it.

A member that retrieves nothing declines rather than answering, and the model is
never consulted in that case. "My sources don't cover this" is the most useful
thing a specialist can say in a room; a fluent guess is the least.

### Not in a room

No turn policy, no moderator, no minutes, no completion marker, no `control`
route. A room has no state machine to drive. External sessions — a Claude Code
or Codex session joining from another machine — are tracked separately; today's
members are all in-process.

---

## Preset teams

`Settings → Agents & nodes → Preset teams` adds a whole room at once. The pack
that ships is **Tech startup — core team**: `@founder` (chair), `@product`,
`@eng`, `@design`, `@growth`, `@data`.

Applying is additive and idempotent. A handle already in use is reported as a
conflict *before* the click and left exactly as it is — a persona key appears
in past transcripts and in the frozen participant list of every meeting that
used it, so overwriting one rewrites the meaning of history.

Packs live in `apps/web/src/server/collab/presets.ts`. The prompts follow four
rules, each of them a lesson from a meeting that went badly:

1. **Give the agent a reason to disagree.** Every prompt has a *What you refuse
   to let pass* section. A persona told to be helpful converges on whatever was
   said last, and six of those produce six paraphrases.
2. **Force a shape on the output.** "Be concrete" is not actionable; "give the
   estimate in sprints and name the long pole" is.
3. **Make ignorance sayable.** Every prompt says what to do when the material
   does not support an answer, because the alternative is a confident number
   nobody can trace.
4. **Say who to hand to.** Meetings stall when nobody is addressed.

`__tests__/api/collab/presets.test.ts` enforces the structural half of that:
prompts carry each section, handles are mention-safe, a pack fits under the
ten-participant cap, and — the one that has already caught a real bug — a
prompt only ever hands off to a handle that exists in the same pack.

---

## Grounding

A meeting can read the workspace's documents. Attach them in **Meetings → New**
and every turn retrieves passages for the persona *about to speak*, using its
role, the objective, and the last thing said.

Retrieval is a port, not a field. `TurnGroundingProvider` lives in the engine,
which never learns what a document or an index is; the implementation over the
existing ensemble retriever is `apps/web/src/server/collab/grounding.ts`.

| | |
| --- | --- |
| Per-persona, not per-meeting | The analyst and the engineer ask the corpus different questions. Retrieving once at creation gives everyone the union of nobody's actual need. |
| Four passages per turn | Each turn already carries the full transcript. A generous top-k inflates the turn at exactly the point where cost already grows with the square of the turn count. |
| Never fatal | A retrieval failure yields no passages and the turn proceeds. A meeting that dies because the index blinked is worse than an ungrounded one. |
| Recorded on the message | What a turn read is stored on the message it produced — label, page, score, and a truncated excerpt. |

`MeetingConfig.context` still pins passages for the whole meeting; retrieved
ones are appended after it, never in place of it.

Storing the excerpt is what keeps a grounded meeting auditable *and*
scoreable. A reader can check a figure without the index still being around,
and the `grounding` eval dimension can tell a cited number from an invented
one — before this, a meeting grounded purely by retrieval scored as "no context
supplied, dimension not applicable".

The transcript shows what each turn read, and distinguishes *searched and found
nothing* from *never searched* — they mean different things when you are
deciding whether to trust a figure.

---

## Slack

Set `SLACK_BOT_TOKEN` to mirror turns into a channel, and `SLACK_SIGNING_SECRET`
to accept messages back. Either half works alone: the token on its own gives a
read-only mirror.

Point the Slack app's **Event Subscriptions** request URL at
`https://<your app>/api/collab/slack/events` and subscribe to
`message.channels` (add `message.groups` for private channels). Then paste a
channel id when you start a meeting.

People can drive the meeting from Slack:

| Command | Effect |
| --- | --- |
| `!takeover [@agent]` | Pause the agents and take the floor, optionally in an agent's seat |
| `!release` | Hand control back |
| `!pause` / `!resume` | Stop or restart agent turns |
| `!run 3` | Let the agents take up to three more turns |
| `!end` | Close the meeting and produce minutes |
| `!help` | Post the command reference |

`!`-prefixed rather than slash commands, so no extra Slack app configuration is
needed. An unrecognised `!word` is treated as ordinary chat.

**Echo loops** are the failure mode worth knowing about. A mirrored message
comes back through the Events API; appending it again would double every turn.
Two independent guards: Slack's `bot_id` on our own posts, and the set of `ts`
values the bridge knows it produced or already ingested. Slack's at-least-once
delivery is handled by the same set.

---

## Agents on other machines

An agent's turns can be produced on a different host, against that host's
model. The worker connects **outbound** and long-polls for work, so it needs no
public address, no inbound firewall rule, and no shared database — only the hub
URL and the shared secret.

```
┌── machine A ──────────┐        ┌── machine B ──────────┐
│  the app (the hub)    │◀───────│  agent worker         │
│  owns the channel     │  HTTPS │  serves @eng, @fin    │
│  runs the orchestrator│───────▶│  its own model        │
└───────────────────────┘        └───────────────────────┘
```

### Turning it on

Set `COLLAB_HUB_SECRET` on the app. Without it the hub refuses every node,
which is the right default for a deployment that has not opted in — and a
secret generated per boot would silently break every worker on restart.

### Starting a worker

```bash
COLLAB_HUB_URL=https://app.example.com/api/collab/hub \
COLLAB_NODE_ID=gpu-box-1 \
COLLAB_SECRET=<the value of COLLAB_HUB_SECRET> \
COLLAB_PERSONAS=eng,fin \
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5 \
pnpm --filter @launchstack/web collab:worker
```

Then set those agents' **node id** to `gpu-box-1` in Settings → Agents. Their
turns are now produced on that machine. Each message records the node that
served it, so the transcript shows where every turn came from.

Set `COLLAB_WORKER_SCRIPT` to a JSON map of persona id → lines to run a worker
with no model at all. That is the fastest way to prove connectivity from a new
host before pointing real credentials at it, and it is what the integration
test uses.

### The protocol

Plain HTTP and JSON, so it survives any proxy or tunnel between the hosts.

| Route | Purpose |
| --- | --- |
| `POST /collab/v1/nodes/register` | A worker announces itself and the personas it serves |
| `POST /collab/v1/nodes/poll` | Long poll; the hub holds it open until there is work |
| `POST /collab/v1/turns/{id}/result` | The worker returns a turn (or an error) |
| `GET  /collab/v1/channels/{id}/messages` | Read the transcript, `?afterSeq=` for the tail |
| `POST /collab/v1/meetings/{id}/control` | Start, step, run, pause, take over, release, end |
| `GET  /collab/v1/health` | Unauthenticated liveness probe |

Every other request is authenticated with an HMAC over a canonical string
binding the method, path (**including** the query string), body hash,
timestamp, and a single-use nonce. Signatures expire after five minutes and
nonces cannot be reused inside that window, so a captured request cannot be
replayed. A node may only act as the id it signed with.

The same hub runs behind the Next.js route (`/api/collab/hub/**`) and behind the
standalone `collab-hub` binary — the route only translates the request shape.

### Known limitation

The hub's node registry and its in-flight turn requests are per-process: a
worker holds a long poll against **one** server. Distributed agents therefore
assume a single long-lived Node process (Docker, a VM, a self-hosted node), not
a fan-out of serverless invocations. The channel log itself is in Postgres and
is readable from anywhere.

---

## Minutes

Minutes are extracted from the transcript by rule, not generated. Every
decision and action item quotes a real sentence and links back to the message
that produced it, and owners are resolved from `@mentions`, named participants,
or first-person commitments ("I'll own the migration"). An LLM summary that
quietly invents a decision is worse than no summary; `summarizeMinutesPrompt`
exists for hosts that want prose on top, but it is handed only the extracted
material.

---

## Evaluation

```bash
pnpm --filter @launchstack/web evals:meetings          # readable report
pnpm --filter @launchstack/web evals:meetings -- --json
```

### Against a real model

The suite above is deterministic because its agents are scripted — which means
it cannot tell you whether a *prompt* steers a model well. A preset that reads
beautifully and produces six agreeable paraphrases passes every scripted test.

```bash
pnpm --filter @launchstack/web meeting:live -- --env-file=/path/to/.env --ground
pnpm --filter @launchstack/web meeting:live -- --route=fast --turns=8    # cheap smoke run
```

Runs the preset roster as a real meeting against the deployment's configured
models, prints each turn and what it read, then scores it and exits non-zero on
a threshold miss — so a prompt change can be gated rather than merely admired.
No Postgres, no Clerk, no HTTP: the channel is in-memory and `--ground` uses an
in-process fixture corpus, so the retrieval *port* is exercised without the
retriever needing a database.

Expect run-to-run variance; two runs of the shipped roster scored 0.93 and 0.87.
Treat a single number as a smoke test and a repeated regression as a finding.

Three defects were found by the first live run and none of them could have been
found by the scripted suite:

- **`findMention` took the first mention.** A real turn opens by answering the
  last speaker and closes by asking someone else, so the floor kept going back
  to whoever had just spoken and the specialists were never reached. Every
  scripted line carries exactly one mention, which made first and last
  identical. Now the last mention wins.
- **Broadcast turns.** An agent asking five people at once gets one answer and
  silently drops four, because the floor can only move to one of them. The
  house rules now mandate exactly one handoff, in the final sentence.
- **Minutes were always empty.** Extraction matches literal cue phrases, and
  models write "we should build it", which is not a recordable decision. The
  chair is now told the exact opening words (`Decision:`, `Next step:`) that
  make the outcome and its owner extractable.

Scenarios run as real meetings — same orchestrator, same turn policies, same
takeover path — with scripted utterances standing in for model output. That
makes the *orchestration* the thing under test and keeps the suite
deterministic and free.

Eight dimensions, each answering a question a person would ask after reading
the minutes:

| Dimension | Question |
| --- | --- |
| `coverage` | Did they actually work the agenda? |
| `participation` | Did everyone contribute, or did one voice run the room? |
| `responsiveness` | When someone was addressed by name, did the floor move to them? |
| `decisions` | Did anything get decided, and did it get an owner? |
| `grounding` | Are the figures traceable to the supplied context? |
| `redundancy` | Did they repeat themselves to fill turns? |
| `termination` | Did it end because the work was done, or because it hit the cap? |
| `handoff` | Was human control actually respected? |

No LLM judge, on purpose: a model scoring another model gives a number that
moves when the judge changes, and these have to be stable enough to gate a
release. The suite deliberately contains bad meetings as well as good ones — a
scorer that only ever sees good input is not a scorer. It fails if the
separation between the two collapses.

---

## Tests

```bash
cd apps/web
pnpm exec jest __tests__/collab __tests__/api/collab
```

| File | Covers |
| --- | --- |
| `__tests__/collab/meeting-orchestration.test.ts` | Turn policies, takeover, termination, failure recovery, minutes |
| `__tests__/collab/protocol.test.ts` | Signing, tampering, replay, clock skew |
| `__tests__/collab/hub-network.test.ts` | Hub ↔ worker over real sockets, timeouts, worker restart |
| `__tests__/collab/two-machine.test.ts` | Three OS processes, one meeting, over the host's routable address |
| `__tests__/collab/slack-bridge.test.ts` | Mirroring, echo loops, duplicate delivery, commands, signatures |
| `__tests__/collab/meeting-grounding.test.ts` | Retrieval per turn, provenance, degradation when the index is down |
| `__tests__/collab/meeting-evals.test.ts` | The scoring function and the scenario suite |
| `__tests__/api/collab/presets.test.ts` | Preset prompt structure, additive application, handle conflicts |
| `__tests__/api/collab/*.test.ts` | Route auth, validation, the hub mount, the Slack receiver |

`two-machine.test.ts` is the one to read if you want to know whether the
distributed path really works: it spawns a hub process and two worker
processes, binds the hub to the host's non-loopback address, and drives the
meeting from the test process as a fourth participant over signed HTTP. Nothing
is shared between them but a URL and a secret — which is exactly what two
physical machines have.
