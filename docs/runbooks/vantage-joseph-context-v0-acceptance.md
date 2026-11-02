# Joseph personal context acceptance — 2026-10-26

Base: `Junkun/vantage-week2-rebuild` at
`364a3c8bd3b1c5bb2ee45cf66c1ea608b3c44618`.
See [implementation and handoff](../design/vantage-joseph-context-v0-handoff.md).

## Executed checks

| Check                                                                     | Result               | Boundary                                                                           |
| ------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Pipeline Vitest: role-context-v0, context-v0, proposals/context-v0        | 76 passed / 9 files  | Joseph provider and shared TL validator/assembler regressions                      |
| Real PostgreSQL Jest: personal-context-postgres                           | 14 passed            | Forward migrations, actual transactions, fresh connections, ACL and scoped storage |
| Web Jest: vantage-tool, personal-context-routes, vantage-personal-context | 38 passed / 3 suites | Navigation, authenticated route handling and React behavior                        |
| Existing authorization Jest selection                                     | 49 passed            | Permission and document-scope regressions; 8 existing opt-in DB cases skipped      |
| Web TypeScript                                                            | Passed               | Complete web typecheck                                                             |
| Changed TypeScript/TSX ESLint                                             | Passed               | Existing root pages-directory notice only                                          |

177 distinct selected tests passed. The separate opt-in authorization DB suite was
not claimed as run. Joseph's new real PostgreSQL suite was run explicitly.

## Real database test setup

A separate local `pgvector/pgvector:pg16` container named
`launchstack-joseph-context-test-20261026`, port 55439, database
`joseph_context_test` was created. The normal engine/product forward migrations
were applied from empty, including the new personal context migration. All test
users, companies and documents were synthetic. The tests refuse a database URL
outside that named loopback test instance.

Run after starting/migrating that isolated instance:

```sh
JOSEPH_CONTEXT_TEST_DATABASE_URL='<isolated test database URL>' \
  pnpm --filter @launchstack/web test --runInBand --testPathPatterns=personal-context-postgres
```

The suite checks multi-role and primary persistence from a fresh connection,
workspace-title precedence, confirmed empty selections, two competing revision-0
writes, old stars, exact updated version text, revoked-title/content exclusion,
explicit grants, deletion diagnostics, unversioned/oversized extraction rejection,
cross-workspace denial, suspended memberships, transaction-time CAS validation,
shared-provider binding, and membership-deletion cascade.

## Browser and database verification

The full LaunchStack application was started against the isolated PostgreSQL DB.
A synthetic account signed in through the normal sign-in form and opened
`/employer/documents?feature=vantage&at=%2Fcontext`.

1. My context rendered inside the real Vantage workspace tab.
2. Founder and Engineering suggestions came from the database profile title.
3. Saving Engineering as primary called the real authenticated role endpoint.
4. Starring a January document called the real star endpoint and returned exact
   version/character coverage and a personal snapshot.
5. Reopening the screen retained both roles, primary perspective and star at
   revision 2. A direct query of the isolated database confirmed the same stored
   roles, mapping version, revision and one personal-star row.
6. The normal narrow in-app viewport rendered the stacked form without a separate
   demo banner. Local proof: `outputs/joseph-real-app-context.png` in the task
   workspace (synthetic content only).

## Release boundaries

The original `/dev/vantage-context` fixture remains available for deliberate fault
scenarios. It is not the new app entry point or evidence of database persistence.
The 14 database tests and signed-in full-app exercise provide that evidence.

No hosted/public app deployment or upstream merge is claimed by these tests.
Personal snapshots do not substitute for the TL's company/retrieval/full report
integration, live-model tests or guarded commit acceptance. Review the migration
and deletion-retention choice before applying to a shared deployment.

## Container build and local rollout preflight

The full `apps/web/Dockerfile` production build passed, including Next compilation
and type validation. The build required the public contract JSON fixture imported
by the existing dev route and a configurable 4 GB Node build heap. An authenticated
container test also exposed the internal/public-origin mismatch under port mapping;
the personal-context routes now validate browser origins against `BETTER_AUTH_URL`,
with a regression test.

A read-only migration preflight against the original `localhost:3000` database
refused rollout because it contains `20261011003324_per_link_join_approval`, which
is absent from the assigned Week 2 branch. The guard was not bypassed: no migration,
container replacement, database downgrade or data modification was made to that
existing instance. Its code and the assigned integration branch need reconciliation
before replacing it. The standalone image was exercised on `localhost:3002`
against the separate synthetic PostgreSQL database. Normal sign-in, personal-context
GET and snapshot POST returned 200. The snapshot contained the January document’s
exact version text. Saving roles in the packaged app returned the visible saved
confirmation and advanced the stored revision to 3. The original `3000` app remains
unchanged; the `3002` installation is local testing, not a hosted public release.
