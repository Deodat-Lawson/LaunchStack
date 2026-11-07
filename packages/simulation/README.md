# @launchstack/simulation

Input: a subject, a shared brief, personas (each citing the evidence it is drawn from) and an opening post.
Does: runs a social network in rounds — agents read a ranked feed and post, comment, like, dislike, repost, quote or follow.
Output: a JSON world you can persist between rounds, per-round numbers, a report, and interviews with any agent.

An independent TypeScript implementation of the design of
[OASIS](https://github.com/camel-ai/oasis) (CAMEL-AI, Apache-2.0); see `NOTICE`
for what was borrowed. Zero dependencies: nothing here reads `process.env`,
touches a database or calls a model directly. The host injects a
`SimulationModel` that completes text.

## Install

```bash
pnpm add @launchstack/simulation
```

## Use

```ts
import { createWorld, runRound, buildReportRequest, parseReport } from "@launchstack/simulation";

let world = createWorld({
    subject: "Acme raises prices by 20%",
    brief: "Acme sells invoicing software to small firms.",
    personas, // from buildCastRequest / parseCast, or your own
    accounts: [{ id: "narrator", name: "Newswire", handle: "@newswire" }],
    seedPosts: [{ authorId: "narrator", text: "Acme announces a 20% price increase." }],
    config: { seed: 42 },
});

for (let r = 0; r < 8; r++) {
    ({ world } = await runRound(world, { model, concurrency: 6 }));
    // persist `world` here; a crash resumes from the last saved round
}

const reply = await model.complete(buildReportRequest(world));
const report = parseReport(reply.text, world);
```

## How a round works

1. **Activation.** Each agent acts with its `activity` probability (OASIS's
   `activate_prob`); round 1 has a floor so most agents see the opening post.
2. **Feeds.** Built from the world as it stood before the round: pinned
   narrator posts, the most-liked posts of followed accounts, then
   recommendations scored `(0.75 × interest + 0.25 × hot) × decay`, with a
   share swapped for random posts. Interest is TF-IDF cosine between the
   agent's profile and the post (inject `similarity` for embeddings); hot is
   Reddit's hot score; decay is OASIS's `ln((271.8 − age) / 100)`, floored.
3. **Turns.** One model call per active agent, in parallel; the reply is JSON
   (`thought`, `stance`, `convincedBy`, `wouldPay`, `objection`, up to three
   actions) and anything pointing outside the agent's feed is dropped. The
   turn prompt has the persona weigh cost, switching and proof before
   warming to anything.
4. **Apply.** Actions apply in a fixed agent order under the platform rules
   (one like per post, no rating your own post, reposts resolve to the root,
   no following yourself). Stances and memories update, under the stance
   guard: a stance moves at most `maxStanceStep` (1) per round, and a move
   toward the subject applies only when `convincedBy` names a post from the
   agent's feed.

## The cast

`buildCastRequest` asks for personas grounded in evidence, each with a
wallet: what they use today, their budget, their part in buying, what
switching would cost them and their first doubt. It also asks for a starting
mix of stances (`REALISTIC_MIX`: 35% against, 40% undecided, 25% in favour).
Models write agreeable crowds when left alone, so a host checks the result
with `skepticShortfall` and, when it comes back too warm, recasts the seats
`seatsToRecast` picks (invented people first, fans grounded in evidence last)
and puts the newcomers in with `fillSeats`.

Every random choice is seeded by (run seed, round, purpose) and `runRound`
never mutates its input, so retrying a round gives the same feeds and the
same activations. If more than half the turns fail, it throws
`RoundFailedError` so the host retries.

## Honesty

A run shows what *these simulated people* did. It is a scenario to think
with, not a forecast; `buildReportRequest` tells the model so, and
`calibration.ts` (`spearman`, `directionHits`) exists to check runs against
what really happened.

## API

| Subpath | What it is |
| --- | --- |
| `.` | world, feeds, actions, rounds, cast, brief, report, interviews, estimates, calibration |
