# Weekly Decision Agenda — Week 1 acceptance record

[Contract v1](../design/weekly-decision-agenda-contract-v1.md) remains frozen by TL
approval on 2026-10-16. [Complete examples](../design/examples/weekly-decision-agenda-v1.json)
describe the interface; they are not observed AI output.

## TL verification, 2026-10-16

Base revision: `d41f8eb2175c6e7ddd4a06461dca4acf474cabcf`, branch
`feat/weekly-agenda-contract-v1`, plus the TL fixes/tests in this change set.
A clean `git archive HEAD` copy was overlaid with only those TL files and tested
independently of the earlier uncommitted frontend, legacy generation and repository
drafts. Installed dependency directories were reused. This is clean-source
verification, not a fresh dependency installation. This change set contains
those verified TL sources and the updated acceptance records; earlier drafts
remain excluded. Commit/push publication is separate from functional acceptance.

Database: a newly created local-only `pgvector/pgvector:pg16` container,
`launchstack-vantage-tl-20261016`, PostgreSQL 16.15, bound to `127.0.0.1:55434`.
Database name: `vantage_tl_contract_v1`. Tests refuse other targets and require
explicit `VANTAGE_TL_TEST_DATABASE_URL`; they never fall back to `DATABASE_URL`.
All input, companies, users, memberships, metrics and generated results were synthetic.
Tests removed only their own fixtures; the final company count was zero.
The temporary verification container was stopped after verification.

| Check                                          | Observed result / boundary                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forward migrations                             | All 4 engine and 28 product migrations applied, including `20261016120000_vantage_contract_v1`; both ledgers subsequently passed `--check`                   |
| Vantage pipeline suite, clean copy             | 51 passed: 31 unit cases plus 20 real PostgreSQL cases                                                                                                       |
| Selected web/API/auth suites, clean copy       | 184 passed: 163 unit/mocked cases plus 8 route/database and 13 auth-context/database cases                                                                   |
| History server suite, clean copy               | 12 passed; storage dependencies use test doubles                                                                                                             |
| Existing workspace-history formatting suite    | 18 passed, 1 failed: test expects English `Aug`, machine locale `zh-CN` returns a Chinese month; unchanged source/test, separate from Vantage access/storage |
| Pipelines and web typechecks, clean copy       | Both passed with `--noEmit --incremental false`                                                                                                              |
| TL source/test formatting and lint, clean copy | Passed; ESLint had zero source warnings/errors                                                                                                               |
| Whole-repository check                         | Earlier attempt exhausted the default Node heap; not rerun and no whole-repository pass claimed                                                              |
| Real session issuance / cookie verification    | Not run; session identity and cookie access are explicit test doubles                                                                                        |
| Live AI / B harness / integrated browser       | Not run; A/B implementation remains their work                                                                                                               |

The **41 real database cases** are 20 storage + 8 route + 13 auth-context cases.
Route cases invoke actual Next handlers and repositories against PostgreSQL;
they are not requests to a running HTTP server. Their generation function is an
explicit fixture installed only in the test process. The application still
has no B adapter and returns `503 generation_unavailable` until B is connected.
Auth-context cases exercise the actual user, membership, active-workspace and
company-scoped role queries; they do not validate a signed login cookie.

## Local launcher verification, 2026-10-17

An initial fresh-copy `pnpm test:tl` run based on `8e61bfd9` plus launcher/docs
changes installed locked dependencies and passed 247 tests: 51 pipeline and 196
web/server-history, including the same 41 real PostgreSQL cases. The source copy
had no dependency directories, application `.env` or earlier excluded drafts;
the install reused the existing pnpm cache. All 4 engine and 28 product migrations
applied. The hardened launcher then repeated the frozen install and all 247 tests
in a second fresh copy despite inherited production/Compose settings and invalid
external database URLs. After `--stop`, a normal rerun passed all 247 tests and
retained the same container ID, product migration-ledger fingerprint and local
credential-file SHA. Stop preserved its data volume; occupied-port and remote
Docker guards refused startup as intended. Four launcher helper tests also passed
separately. See the
[launcher verification record](weekly-decision-agenda-local-tests.md#launcher-verification-2026-10-17)
for the separate setup results and Windows-only runtime boundary. The earlier
dated clean-source evidence above is preserved.

## Defects corrected within TL ownership

- Validate company ownership and matching agenda/topic links before creating an
  action; company-scope topic-title joins and foreign metric lookup.
- Enforce one primary action across decision and standalone action APIs;
  require an acceptance test and a nonempty resulting outcome when resolving.
- Route human topic/status/order/action/undo writes through short transactions
  and v1 versions. Preserve legacy topics that already have linked actions.
- Reject malformed JSON and impossible dates. CSV imports retain valid rows and
  report invalid rows rather than sending invalid dates to PostgreSQL.
- Validate B's structured signals and source IDs against supplied data;
  reject contradictory execution metadata without implementing AI generation.
- Deny unknown membership statuses instead of treating them as active; avoid
  logging raw database/provider errors in Vantage handlers.
- Keep the schema declaration aligned with the migrated primary-action index.

## Reproducing the TL checks

From the repository root:

```sh
pnpm test:tl
```

Follow the [local TL checks runbook](weekly-decision-agenda-local-tests.md) for
prerequisites, the dedicated Docker service, optional settings and how to stop it.
The dated records above distinguish the earlier clean-source checks from the
fresh-copy launcher, hardened-environment and stop/reuse verification.
Without the explicit test URL, real database suites are skipped; a skip does not
establish a database pass. Before launching the actual app, also configure
`VANTAGE_TEST_MODE=true`, `VANTAGE_TEST_COMPANY_ID`, permitted
`VANTAGE_TEST_USER_IDS`, and `VANTAGE_TEST_DATABASE_URL` matching `DATABASE_URL`.
Use normal authenticated sessions in the app; test doubles are not app setup.
Existing duplicate primary links must be reviewed before migration; no automatic
deletion or repair was introduced.

## Backend acceptance evidence

- [x] Monday selects the previous complete week; Saturday uses this week to
      cutoff; DST, real dates, date-only evidence and comparable periods are checked.
- [x] Company-scoped records, metric input and operator/permission gates are
      checked. Actual membership/status/custom-role queries are exercised.
- [x] Save/reload retains report, reviewed topic and action IDs in PostgreSQL.
- [x] Eight concurrent same-key submissions create one action; changed payloads
      and conflicting second primary actions fail without partial changes.
- [x] Resolved outcomes and timestamps survive retries.
- [x] Human edits and other report mutations reject stale generation saves.
- [x] Enhancement acceptance stays separate; stale originals conflict and
      repeated terminal review is a no-op.
- [x] Injected database faults roll back decision/action writes and replacement
      of generated topics, retaining the prior report.
- [x] Synthetic carry-forward inputs retain original action IDs and dates.

## Remaining integrated acceptance

- [ ] TL connects B's supplied conforming generation function.
- [ ] B supplies observed real-provider success, forced fallback, empty/conflicting/
      unsupported evidence and timeout/retry/harness evidence.
- [ ] A supplies the real frontend workflow, including v1 fields, stable decision
      keys and explicit enhancement review.
- [ ] Run authenticated HTTP/browser checks with actual session issuance/cookies,
      including source/history access, revoked access and reload behavior.
- [ ] Demonstrate the following-week report and outcome check-in through A/B's
      integrated workflow, with browser/keyboard/narrow-layout evidence.
- [ ] Confirm hosting supports the configured synchronous generation timeout.

TL foundation checks are recorded; the integrated founder feature is not yet
accepted. A/B implementation files, earlier drafts, Google Doc and business data
were not changed. The user authorized committing and pushing this TL change set
to `feat/weekly-agenda-contract-v1`. No deployment, merge or teammate message is
part of that publication, and integrated acceptance remains pending.
