# Weekly Decision Agenda — assignments

[Contract v1](../design/weekly-decision-agenda-contract-v1.md) is frozen by TL
approval, 2026-10-16. A/B acknowledgement is not invented; implementation and
milestone acceptance are separate. No teammate messages or remote issues were sent.

| Owner | Work                                                                            | Input / output                                                                   | State                                                           |
| ----- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| TL    | Test data access, authorization/API, storage, versions and submission integrity | Authenticated request -> GenerationInput; GenerationResult -> saved API response | Code present; focused checks passed; real DB validation pending |
| B     | Evidence packing/signals, model generation, fallback and AI harness             | Frozen GenerationInput -> GenerationResult                                       | Left for B; adapter uninstalled                                 |
| A     | Generate/progress/result/source/edit workflow and enhancement review            | API examples -> UI; user decisions -> stable-key requests                        | Left for A; browser acceptance pending                          |
| TL    | Integration review and acceptance                                               | Model, DB/API and browser evidence -> pass/return decision                       | Pending                                                         |

## Starting independently

B can develop against the [normal/fallback/empty/enrichment fixtures](../design/examples/weekly-decision-agenda-v1.json).
A can use the same HTTP examples. TL owns persistence; B's generator does not
read/write the database. A calls TL APIs rather than a separate AI service.
Do not treat fixtures as observed feature output.

## Weekly reviews

| Week | Deliverable                                                                                | Review focus                                                                                  |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 1    | A: founder workflow; B: real model/fallback/initial harness; TL: isolated data/API/storage | Real-provider success, explicit fallback, correct period and saved human work                 |
| 2    | Better evidence grounding and reviewable enrichment                                        | Sources support claims; no silent human-text replacement; decide real-source policy if needed |
| 3    | Failure recovery and reliable action follow-up                                             | Stable IDs, duplicate/restart behavior, bounded failures                                      |
| 4    | Integrated verification and pilot readiness                                                | Access, quality, usability, cost/latency and release decision                                 |

Review earlier drafts per owner and choose adopt/revise/defer. A's frontend and
B's existing generation implementations were not changed by the TL code work.
TL may revise their own backend drafts. Contract changes require a dated revision.
