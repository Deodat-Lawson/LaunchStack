# Vantage local remediation and functional acceptance

Date: 2026-11-14 America/New_York. Implementation is explicitly authorized. This ledger is updated during execution; an open item is not a completed claim.

## Baseline and isolation

- Worktree: `C:/Users/junku/.codex/worktrees/vantage-retrieval-roadmap/implementation-vantage-production-20261109`.
- Repair branch: `codex/vantage-review-remediation-20261114`, from `9c753340bd4f25ef3c6d2dcb3219b942044d1f4b`.
- Existing four untracked review reports are preserved. No other active writer was reported in this workspace when work began.
- Production integration ancestor remains `58f435d924d9010652800e18c6e93876ad96f4e8`. No push, PR, merge, or remote deployment is authorized.
- Existing stopped trial databases are preserved. New container `launchstack-vantage-remediation-20261114` is bound only to `127.0.0.1:55569`, with synthetic database `vantage_production_acceptance`. Official engine/product migrations are used.
- Existing task-owned scoped PostgreSQL container on loopback55570 is used for isolated synthetic tenant regression tests. No production data is used.

## Milestones

| Milestone | State | Evidence |
| --- | --- | --- |
| M1: R9, R2, R1/R3, R6, R7 | Implemented; local checkpoint | Parent-run 87 unit/component and 15 history/PG/classification checks passed; current-source web typecheck zero diagnostics. Browser acceptance in progress. |
| Scoped prerequisites R8/R10 and exact inspection R4 | Pending | Purpose-aware evaluation and bounded preview/approval |
| Local authenticated application and full functional path | Preparing | Actual Next.js application, deterministic provider first |
| Bounded real provider functional canary | Authorized, not started | Maximum 80 total real model attempts, including retries and related models; parent serial dispatch only |

## Evidence interpretation

No independent team dataset or gold labels are available. Functional integration checks do not establish semantic relevance or decision quality. Continuity/public research remain unintegrated offline prototypes. Production experiment flags remain default-off; local test configuration enables them explicitly.

## Initial regressions

- R2 new repository regression: two stale-pointer cases failed before the fix; all six identity/CAS tests passed afterward. This is an injected repository test; authenticated HTTP proof remains pending.
- R9 worker reproduced six GET privacy failures before filtering; 25 focused context/selection checks passed afterward, pending parent integration check.
- R6 worker reported both audience transition regressions reproduced, then 12 unit and two isolated PostgreSQL checks passed; parent integration check pending.
- R7 real PostgreSQL pre-fix updates changed epoch `[3,1,0]` to `[15,5,0]` for incidental/no-op activity; incidental writes under a share lock hit `55P03`. Official additive trigger migration prepared; corrected checks pending.

## Operational notes

The shared dependency junction resolves pipeline packages to an older checkout. The task-owned local launcher overrides pipeline resolution to this worktree and uses an ignored TypeScript configuration; project configuration and dependency junctions remain unchanged.

Live model identity/configuration and credential availability have not yet been verified. Requested agent configuration is GPT 6.1 Sol Ultra; no unverified switch of the active lead runtime is claimed.

## M1 checkpoint

Changed areas: context GET minimizes administrative and personal scope metadata by capability/current readable documents; UI separates week/request/displayed/active identities and report-topic drafts; Generation authorization rejects stale active expectations before setting a dispatch flag; historical read/decision/restore reconstructs captured audience only after current ACL/purpose checks; additive migration filters users/membership UPDATE authority fields without changing AFTER revocation locking.

Fresh parent verification: `m1-unit.json` 87/87, `m1-postgres.json` 15/15, no skipped checks; `m1-typecheck.log` zero current-source diagnostics. Included PostgreSQL tests use real migrated tables/encryption with injected actor scope and model responses. Schema classification tests fail if new identity columns are not explicitly classified. Document/version/chunk writes still invalidate company epochs; that broader behavior is intentionally retained.

Official migrations: new local app database applied 6 engine and 52 product migrations; existing isolated scoped test database applied the one additive product migration. Original trial container remains stopped and unchanged. Local server launcher resolved existing dependency-junction and Windows config-path issues without changing project config or installing dependencies.

The user subsequently authorized at most 80 real model attempts for functional validation. All paid application calls remain parent-owned, sequential, counted including failures/retries, with zero automatic repair retries. No team gold or semantic quality evaluation is implied. Original repository provider configuration is present; only presence/endpoint/model metadata was inspected, never credentials printed.
