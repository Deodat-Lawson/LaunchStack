---
"@launchstack/simulation": minor
---

Add `@launchstack/simulation`: a round-based social-network simulation, an
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
