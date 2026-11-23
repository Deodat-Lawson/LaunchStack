# Vantage port to main — 2026-11-23

Branch `vantage/port-to-main-20261123` starts at fetched `origin/main` `ac57e02ae877d961d5144940cccba5245b493fb3`. The port uses source `c8ecbcda997bab1b62627aa1b350170b6b636b92` from `codex/vantage-topic-first-20261121`.

## Commits by layer

| Layer | Commit | Contents |
| --- | --- | --- |
| Shared infrastructure | `66e54184` | Bounded model runner, cancellation, single-attempt calls and versioned AAD encryption. Main’s long-wait fetch, redirect protection and usage recorder remain in the transport. |
| Schema and storage | `51d05ef0` | Digest storage, review and topic schemas, fresh migrations and final authority DDL. |
| Vantage product | `233550db` | Topic-first acquisition, V2.1 generation, validation, Judge, admission, encrypted persistence and authorized history. This week, Context and My topics use the canonical API. |
| Verification and operations | `3894a586` | Injected acceptance, CI parity checks, Windows test-runner fixes and the current [Vantage contract and operations notes](vantage-topic-first.md). |

The sole production evidence strategy runs explorer selection followed by question-ranked backfill with an 80,000-byte ceiling. The deployment’s creation switch defaults off. The workspace Beta apps setting gates the UI, APIs and history. Existing report reads and permitted decisions remain available with Beta on and creation off. The old Agenda creation endpoint returns HTTP 410 after its access checks.

Baseline selection, V3 role/internal/combined selection, plain live and live-docs+windows, continuity/research/ledger prototypes, and the old Agenda generator stayed on the source branch to keep one production workflow. The cut retains compatibility schemas and readers where history uses them. Northstar and RAG-Multi-Corpus evaluation code, corpora, captures, results and historical experiment notes remain with their source experiments. Founder Weekly Review comes from main. Approval changes are reserved for V2.

## Migrations and write cost

- Engine `packages/store/drizzle/20261123171346_vantage_document_digests.sql`
- Product `apps/web/drizzle/20261123171354_vantage_topic_first.sql`

Each extends main’s journal and snapshot chain. The existing migrations and snapshots are byte-identical to main. Fresh migration applied 8 engine and 58 product entries. An already migrated main database applied one new entry per set. Repeat runs were no-ops. Both Drizzle checks passed and generation produced no changes. The fresh, upgraded, and TypeScript-built schemas matched across 4,993 normalized dump lines, including indexes, constraints and authority triggers.

Median milliseconds per 1,000 writes on disposable PostgreSQL 16 with pgvector.

| Write | Before authority DDL | Vantage off | Vantage on |
| --- | ---: | ---: | ---: |
| Document insert | 17.834 | 38.294 | 39.207 |
| Document update | 16.475 | 57.074 | 63.893 |
| Chunk insert | 12.975 | 29.931 | 29.499 |
| Chunk update | 14.440 | 48.014 | 79.077 |

The benchmark used two warmups and seven measured samples per case, one connection and rolled-back sequential SQL loops. Off and on changed both rollout controls. Authority triggers stayed active in both cases. Same-row updates and host variation limit the comparison. Concurrent ingest contention and production write latency remain unverified.

## Verification

- Frozen-lockfile install, workspace typecheck and lint passed. Lint reported 26 warnings and zero errors.
- Package suites passed 2,089 tests, including collab, transport, crypto and PostgreSQL tests. One test was skipped. Four workspace test scripts had no test files.
- Chromium passed the injected flow with creation enabled. It signed in, saved required context and a personal topic, generated a V2.1 review, inspected version-bound evidence, recorded a decision, reloaded it, and checked that Beta off hid the app and refused its API and history.
- Chromium also passed after restarting with creation disabled. Beta on kept the saved review available and disabled Regenerate. Direct generation returned `weekly_review_disabled` and left the run count unchanged. Beta off denied access again.
- The final Web Jest run passed 790 suites and 9,887 tests, including the collab and auth suites. Five suites and nine tests were skipped. The rerun used a separate disposable PostgreSQL instance after fixing Windows test fixtures for process launch, paths, locale and filesystem links.

## Unverified

Production build and deployment, live provider quality and live billing remain unverified.
