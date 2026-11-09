# Joseph V0 acceptance — 2026-10-26

Base: `Junkun/vantage-week2-rebuild` at
`364a3c8bd3b1c5bb2ee45cf66c1ea608b3c44618`.
Contract: `v0-proposed`; assembler: `v0-assembly-1`.
See [audit, proposal and handoff](../design/vantage-joseph-context-v0-handoff.md).

## Executed checks

| Check                                                                                                                          | Result                          | Boundary                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------- |
| Pipeline Vitest selection: `src/vantage/role-context-v0`, `src/vantage/context-v0`, `src/vantage/proposals/context-v0.test.ts` | 76 passed / 9 files             | 28 new Joseph provider/handoff tests plus 48 shared V0 regressions; synthetic adapters |
| Web Jest: `--runInBand --testPathPatterns=vantage-personal-context`                                                            | 8 passed / 1 suite              | React interaction tests with fixture provider and synthetic localStorage               |
| Pipeline TypeScript                                                                                                            | Passed                          | `pnpm --filter @launchstack/pipelines typecheck`                                       |
| Web TypeScript                                                                                                                 | Passed                          | `pnpm --filter @launchstack/web typecheck`                                             |
| Changed TypeScript/TSX ESLint                                                                                                  | Passed, no file warnings/errors | Root invocation prints existing React-detection/pages-directory configuration notices  |
| Changed-file Prettier and `git diff --check`                                                                                   | Passed                          | Source, JSON and handoff docs                                                          |

84 selected automated tests total. No whole-repository test/build claim.

## Observed browser flow

Local Next development server on `http://127.0.0.1:3001/dev/vantage-context`;
real browser with **synthetic fixture client**, not authenticated production API.

1. Founder and Engineering suggested from synthetic profile title.
2. Engineering selected as primary; Save roles confirmed persistence and reordered
   saved priorities. No permission state changed.
3. January engineering document starred; source 101 version 7, exact character
   range and included coverage appeared despite its age.
4. Full reload retained the two roles, primary perspective and star.
5. Revoked-document scenario hid its title/content, showed Access revoked and
   blocked readiness.
6. Removing the unavailable personal star restored readiness.
7. Missing-company scenario showed a separate mandatory-company error.
8. Restored normal state and starred the engineering document for review.

Screenshot is saved with the local task outputs as
`joseph-week2-context-preview.jpg` (synthetic content only). UI tests additionally
cover double-submission prevention, acknowledged-save/failed-refresh reconciliation,
failed mutation recovery, role confirmation/remount, and preview labeling.

Provider tests cover unknown/partial roles, deterministic aliases and primary
merging, manual correction, actor/workspace/module scoping, atomic stale revisions,
zero stars, unchanged old sources, missing/revoked/cross-tenant/version/cutoff
failures, duplicate required/star sources, bounded budgets, timeouts/cancellation,
adapter outages and independent TL manifest assembly. The assembly test caught and
corrected the fixture's report-end/asOf mismatch; its passing result uses the
unchanged shared validator/assembler.

## Explicitly not verified or shipped

- No production PostgreSQL star/role persistence adapter or migration is installed.
  The Week 2 Plan requires TL schema review first; the concrete proposal is in the
  handoff. The fixture store demonstrates scope/CAS but cannot prove SQL isolation.
- No real authenticated route/client wiring or source/current-state adapter.
- No actual cross-branch Joseph/Sophia provider or guarded transaction integration.
- No business data, live LLM, public research, external account connector, deployment
  or main merge. Existing v1 E2E belongs to TL and was not rerun or claimed here.

After schema/API approval, Joseph's remaining persistence implementation can target
`PersonalContextStoreV0`; TL owns final source/ACL/current-state wiring and rerunning
isolated SQL/auth/browser acceptance. Do not label this prototype production-ready.
