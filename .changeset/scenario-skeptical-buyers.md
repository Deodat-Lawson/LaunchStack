---
"@launchstack/simulation": minor
"@launchstack/pipelines": patch
---

Scenario crowds now behave like careful buyers. Every persona has a wallet
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
