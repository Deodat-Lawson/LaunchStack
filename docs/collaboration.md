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
| `packages/core/src/collab/` | The engine. No Next, no Clerk, no database, no `process.env`. |
| `packages/core/src/collab/net/` | The signed HTTP protocol, the hub, the worker, the `node:http` adapter. |
| `packages/core/src/collab/slack/` | Slack Web API port, signature verification, the two-way bridge. |
| `packages/core/src/collab/evals.ts` | Deterministic meeting scoring. |
| `packages/core/src/db/schema/collab.ts` | Channels, messages, personas, meetings, nodes. |
| `apps/web/src/server/collab/` | Postgres-backed store, the process-wide hub, the model adapter. |
| `apps/web/src/app/api/collab/` | Meeting routes, the hub mount, the Slack events receiver. |
| `apps/web/src/app/employer/documents/_workspace/collab/` | The Meetings surface and the agent roster. |
| `apps/web/scripts/collab-hub.ts` | Standalone hub, for running the meeting plane on its own host. |
| `apps/web/scripts/collab-worker.ts` | Agent worker. Run this on any machine that should host agents. |

---

## Running a meeting

1. **Settings → Agents & nodes** defines the roster. A workspace that has never
   opened it gets four starter agents seeded on first read, so nothing
   dead-ends on an empty picker.
2. **Meetings → New** picks the participants, states the objective, and chooses
   how the floor moves.
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
| `__tests__/collab/meeting-evals.test.ts` | The scoring function and the scenario suite |
| `__tests__/api/collab/*.test.ts` | Route auth, validation, the hub mount, the Slack receiver |

`two-machine.test.ts` is the one to read if you want to know whether the
distributed path really works: it spawns a hub process and two worker
processes, binds the hub to the host's non-loopback address, and drives the
meeting from the test process as a fourth participant over signed HTTP. Nothing
is shared between them but a URL and a secret — which is exactly what two
physical machines have.
