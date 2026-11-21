# Vantage topic-first retrieval v1

The topic-first mode runs Weekly Review end to end against both local fixtures with injected providers. The branch starts at `cd2bda46`. Set `VANTAGE_TOPIC_FIRST_ENABLED=true` with Internal Retrieval V1 to enable it. The development and acceptance runner enables scripted topic-first by default. Its comparison settings are flag off for baseline and `VANTAGE_TOPIC_FIRST_PROVIDER=seeds` or `scripted` for the other arms.

| Step | Commit | Change |
|---|---|---|
| Plan | `dc915dff` | Original plan committed before implementation |
| 1 | `3b3e870b` | Canonical UTF-8 hash parity and engine-owned, ACL-gated on-demand digests |
| 2 | `1cc63029` | Owner-only topics and watches, revision CAS, localized Context UI |
| 3 | `558dda5e` | Key-first replay, pinned seeds and manifest, run claim and expiry |
| 4 | `8e468d6a` | Recorded `runAgent` tools, injected and configured ports, partial trace persistence |
| 5 | `95ca1cae` | Canonical excerpt freeze, separate capacity profile, snapshot-bound V2.1 admission |
| 6 | `14928f84` | Localized exploring stage and exact excerpts in This week |
| Hardening | `2a7f7508` | Run-owned DTO redaction, UTF-16 boundaries, digest deduplication, authority and compatibility regressions |
| 7 | `7a3f8718` | Deterministic long corpus and six-arm fixture capture, comparison, and checks |

## Limits and decisions

- S0 keeps its 3-second transaction. It pins the authority epoch, cutoff, topic revisions and carryover IDs. Explicit watches precede carryover and recent changes. The run offers up to 50 authorized optional documents, 40,000 UTF-8 bytes per parent, and a 48,000-byte catalogue. Fixed sources retain existing Context configuration rules and are checked again at freeze.
- The exploration deadline is 150 s including on-demand digests and freeze. The agent gets 12 turns, 8 calls per turn, 60 total calls, 12,000 characters per result and a 512,000-byte trace record. Configured digest calls have a 60 s per-call timeout and use batches of six. The active topic snapshot is capped at 24 topics. The Generator's compact topic notes are capped at 3,200 serialized UTF-16 units to fit the existing Judge scenario schema.
- The freeze reserves mandatory context and Stars, then tries three change-lane candidates for one slot. It merges overlapping or adjacent spans and admits up to six 200–6,000 UTF-16-unit excerpts per document. Explicit endpoints that split a surrogate pair fail. The existing V2.1 contract permits 16 frozen source units total. Seeds-only takes canonical prefixes in seed order. Scripted exploration selects ranges from recorded digests and probes excerpts through the tools. The fixture digest ignores repeated numbered boilerplate and uses only the supplied text.
- Frozen evidence text is capped at 80,000 bytes. Generation and Judge payload budgets are 200,000 and 240,000 bytes with an 8,000-byte report reserve. Generation times out at 90 s, Judge at 120 s, with a 121 s assessment bound. Recovery can expire the uncertain run after 210 s since its last dispatch. The Generator prompt, deterministic evidence checks and Judge criteria follow V2.1.
- Configured routes default to `default` for digests and `reasoning` for exploration, overridable by `VANTAGE_TOPIC_FIRST_DIGEST_ROUTE` and `VANTAGE_TOPIC_FIRST_EXPLORATION_ROUTE`. Topic text and the capped trace are stored with the owner/run records and excluded from report DTOs. Trace retention follows the run.

## Comparison

All six reports were accepted through the real HTTP and PostgreSQL paths at cutoff `2026-11-16T00:00:00Z`. Each arm used its own owner and identical guidance and fixed evidence within a corpus. The fixed architecture was the full Harborlight priorities document or one approved 1,000-character long passage. The arms used zero Stars. A separate freeze regression exercised mandatory sources and Stars together.

Each case cell counts exact version-matched anchors present over anchors listed. The scope case includes a deliberately stale v1 anchor. It was absent in all six runs. The [comparison record](../samples/vantage/harborlight-long/topic-first-comparison-20261121.json) gives each anchor result and all selected document keys, versions and offsets.

| Fixture | Arm | Docs | Scoped excerpts | Frozen bytes | Scope | Rollback | Security | Metric | QA | Noise | HTTP ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Harborlight | Baseline | 5 | 0 | 6,123 | 0/2 | 1/2 | 1/2 | 2/3 | 1/2 | 2/3 | 750 |
| Harborlight | Seeds | 12 | 11 | 14,610 | 1/2 | 2/2 | 2/2 | 3/3 | 2/2 | 3/3 | 1,154 |
| Harborlight | Scripted | 12 | 11 | 14,610 | 1/2 | 2/2 | 2/2 | 3/3 | 2/2 | 3/3 | 1,717 |
| Long | Baseline | 1 | 1 | 1,000 | 0/2 | 0/2 | 0/2 | 0/3 | 1/2 | 0/3 | 756 |
| Long | Seeds | 14 | 14 | 79,000 | 0/2 | 0/2 | 0/2 | 0/3 | 1/2 | 0/3 | 1,690 |
| Long | Scripted | 9 | 16 | 13,540 | 1/2 | 2/2 | 1/2 | 2/3 | 2/2 | 1/3 | 2,244 |

Within the scripted streams, exploring to writing took 1.04 s on Harborlight and 1.62 s on long. Writing and checking arrived together with injected Generation. Checking to saving took 0.15 s and 0.13 s respectively. These are one-run fixture timings.

## Verification and scope

- Web Jest passed 161 focused tests, including real PostgreSQL authority and scoped-evidence regressions. Covered offered-set and range checks, deadline fencing, fixed-source preservation, all lane outcomes, same-key replay, snapshot tampering, timeout preservation of the previous report, and saved v1–v3 report actions across flag toggles.
- Vantage pipeline tests passed 290, with the existing optional action-integrity integration test skipped. Seven digest tests passed, including actual PostgreSQL parity with Unicode and NULL lines. The founder reader retains its path-first ordering. Ten importer/corpus tests passed. Web and store TypeScript reported zero diagnostics. ESLint reported zero issues in changed TypeScript files. Both migration journals passed.
- Browser runs on both fixtures created topics and watches in Context, rendered the generation stages including Exploring, expanded exact excerpts in This week, recorded a decision and preserved it on reload. The long fixture has 50 documents over 53 versions, including three in-week updates. Its restricted document was absent from the recorded offer set and trace and had zero digest rows.
- The comparison measures authored anchor coverage and scripted mechanics. Configured-model quality, latency, and production ingestion were outside fixture verification. All writes were to task-owned loopback databases. Paid models and embeddings were unused.
- The v1 scope defers encryption, per-turn authorization, digest leases and sweep, search, proposals, receipts, understandings, P4/P5, and legacy cleanup. No deployment or PR was part of this work.
