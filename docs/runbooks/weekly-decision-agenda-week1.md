# Weekly Decision Agenda — Week 1 acceptance record

[Contract v1](../design/weekly-decision-agenda-contract-v1.md) is frozen by TL
approval on 2026-10-16. [Complete examples](../design/examples/weekly-decision-agenda-v1.json)
are normative fixtures, not observed runtime output.

## Observed checks in this task

| Check                                                          | Result / boundary                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Vantage pipeline tests                                         | 39 passed; includes 8 new period/DST/date/fingerprint cases and pre-existing mocked repository tests |
| Selected web API/history/access/I-O tests                      | 35 passed; route and storage dependencies use test doubles                                           |
| pipelines typecheck                                            | Passed                                                                                               |
| web typecheck                                                  | Passed                                                                                               |
| Repository-wide pnpm check                                     | Did not complete: ESLint exhausted the default Node heap; no full-repository pass claimed            |
| Changed-file lint                                              | Passed for the TL change set                                                                         |
| Real PostgreSQL / forward migration / concurrency and rollback | Not run: local Docker database engine is not running                                                 |
| Real AI / B harness execution                                  | Not run; B's implementation remains their work                                                       |
| Integrated browser                                             | Not run; A's implementation remains their work                                                       |

No feature is accepted from these documentation or isolated unit checks.

## Setup before real database acceptance

Use a new dedicated test database/workspace and synthetic inputs. Record code
revision/diff, database identity, authorized operator, app URL, reporting clock
and America/New_York zone. Do not reset an existing database.

Configure VANTAGE_TEST_MODE=true, VANTAGE_TEST_COMPANY_ID and the comma-separated
VANTAGE_TEST_USER_IDS. VANTAGE_TEST_DATABASE_URL must match the application's
DATABASE_URL and point to the isolated test database. Credentials stay local.
Run the repository's engine/product migration sequence only against that target.
The new product migration is 20261016120000_vantage_contract_v1; existing duplicate
primary links must be reviewed, never silently deleted to make it pass.

TL connects B's supplied real AI/fallback adapter to the generation port. Until then,
503 generation_unavailable is expected. A updates their UI to consume v1 fields
and send Idempotency-Key on decide requests.

## Remaining integrated checklist

- [ ] Monday: previous full week; Saturday: current week to cutoff; DST and date-only boundaries.
- [ ] Scoped source/API/history access, wrong company and excluded operator; no business DB writes.
- [ ] Actual AI success with model/prompt/fixture record; forced failure falls back honestly.
- [ ] Empty/conflicting/unsupported evidence and finite timeout/retry behavior.
- [ ] Save/reload retains report, reviewed topic and action IDs in real PostgreSQL.
- [ ] Concurrent same-key decide creates one action; changed payload conflicts atomically.
- [ ] Resolved outcomes survive retry; conflicting second primary action is rejected.
- [ ] Edit during generation returns stale_agenda and retains human changes.
- [ ] Enhancement accept/reject is separate; stale original conflicts; repeated review is a no-op.
- [ ] Controlled following-week clock shows carry-forward action with original dates and an outcome.
- [ ] A supplies browser/keyboard/narrow-layout evidence against the actual APIs.

Record environment, IDs, commands/results, failed/unrun checks, owner and next
review date. TL then accepts or returns the milestone. No deployment/merge or
production-data release occurred in this task.
