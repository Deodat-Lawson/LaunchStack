# Vantage founder UI — 2026-11-16

Branch: `codex/vantage-realistic-sample-docs-20261116`. This implementation is committed directly on parent `e9b554ba38365eb9dc45f427cd47810386402637` in the existing retrieval-roadmap worktree. The published commit SHA is supplied in the delivery message.

## Changed

- Split the former entry component into ThisWeekScreen, ContextScreen, a shared request-identity hook, and focused components. Shared API helpers and server-owned wire types replace local fetch/type copies. Active pointer identity remains separate from the displayed historical report; stale replies and draft isolation remain guarded.
- This week leads with decision questions, clearly proposed recommendations, compact next steps, blank human decision editors, append-only decision versions, and manually confirmed commitments. A session marker survives navigation/reload; commitment creation sends neither agendaId nor topicId.
- Citations use loaded titles/versions and open a scrollable kit Dialog. Evidence text comes first; technical details stay collapsed. Source coverage and other already-loaded readable documents appear at the bottom. Dates, confidence, operations and purposes use localized formatting/copy.
- Context has a setup checklist, searched document pickers/counts, dirty-only saves, success toasts, inline errors, confirmed role clearing, and a collapsed advanced scope editor. Scope/hash/range logic is retained.
- Optional NDJSON generation responses stream actual service boundaries: gathering before collection; writing after generation dispatch authorization; checking immediately after generation returns, before validation/budget/Judge; saving before admission/persistence. JSON 201, keys, expectedActiveId and error codes remain supported. Disconnects/observer failures do not alter the authorized run. The only timer counts elapsed seconds.
- Repaired 35 Chinese Vantage values and two workspace messages, restored dash punctuation, and added a corruption guard across every locale/namespace. New/changed copy exists in English and Simplified Chinese and was read back as UTF-8.
- The auth-free simulator now covers review/context/role/source/evidence/decision/generation operations with fictional Harborlight-like data and the same stages/injected label.

## Deleted

Removed AgendaScreen, OverviewScreen, WeeklyReviewEntry, the replaced role/evidence components, WeekSteps, useAutoDraft, obsolete tests/catalogue groups, unused frontend API helpers, and old simulator agenda/topic generation code. `/agenda` is no longer a screen alias. Disabled Weekly Review shows an EmptyState. Triage help items no longer link there; unsupported history records remain visible without an Open action. Components still used by Evidence, Metrics, Commitments and Triage are retained.

## Verification

| Executed now | Result |
| --- | --- |
| Focused Jest: UI, identities, retained widgets, service/stream/client, simulator, history/navigation, i18n | **559 passed, 50 suites** |
| `npx --no-install jest src/i18n --runInBand` | **35 passed**, included above |
| Canonical V2.1 runner Vitest | **28 passed** |
| Current-source web TypeScript | **0 diagnostics** |
| Changed TS/TSX lint | **53 files, 0 errors, 0 warnings** |
| Formatting / diff whitespace | Passed |

The installed pipelines dependency junction targets an older checkout. TypeScript/lint therefore use a private program mapping to this worktree's current pipeline source; the existing injected dev host uses the same source alias. No dependency junctions or installed packages were changed.

Authenticated injected browser checks on the existing Harborlight sample workspace passed: real four-event stream and visible progress tracker; citation from its final (only) topic; record then change a decision; earlier version expansion; confirmed commitment and toast link; commitment/decisions/session marker after reload; Context dirty save/toast and persisted value. The three-topic simulator independently passed an off-screen last-topic citation, all stages, and both direct unauthenticated routes. English and Simplified Chinese screens passed; real account-menu language/theme switching was used. Both screens fit 390px mobile width in dark mode; the citation Dialog stayed within the viewport. A clipped injected badge found visually was fixed and rechecked at 326px width with wrapped text.

All four service events were observed in order. With the immediate injected provider, React can coalesce the writing/checking active-state paint; no artificial dwell or timed stage advancement was added. A stalled-stream Jest case verifies that 60 seconds do not advance a stage. Quality failure retains the accepted report and marks the observed failed stage.

Monday finding: the previous API/service used weekStart exactly and did **not** normalize it. The picker now uses the existing pipeline weekStartOf helper; GET/POST/service reject non-Monday or invalid dates with HTTP 400 `invalid_review_week`. No stored dates were migrated.

Limits: no paid provider calls, budget/prompt/validator/admission/Judge/retrieval/schema changes, production soak, migration/rollback exercise, or live canary retry. PostgreSQL fixture suites require separate databases and were excluded after their guards rejected missing dedicated URLs; they were not pointed at the trial database. The three existing E2E specs were updated/static checked, not run wholesale; the browser workflow above was executed separately. A broader initial Jest path pattern also overmatched unrelated suites and is not reported as a green repository run. Repeated dev hot reloads became slow; only the task-owned injected host was recycled with unchanged limits. Private browser artifacts/logs and six existing untracked review documents remain outside this commit.

## Backend removal candidates — list only

- Legacy agenda prepare/list/detail/update/topic routes and generation: consider removal after remaining consumers, historical records and exports are inventoried. Overview/triage and existing commitments still depend on agenda data; removing the screen alone is insufficient.
- Agenda/topic tables and their foreign keys: require a retention/migration plan for existing commitments, topic titles, help requests and audit history. No table is declared safe to drop here.
- Legacy read-authority: remove only together with every old-report consumer or a replacement retaining current access checks; it still guards legacy routes.
- Budget profiles and admission schema versions: active contracts and historical formats, **not currently safe to prune**. Prove writer/reader compatibility and historical coverage before consolidation.
- Restore/recover routes and uncertain-run expiration: possible surface simplification after product/operations review; preserve pointer CAS, idempotency and uncertain-dispatch safety.
- Drizzle history/rollback scripts: operational safeguards, not unused frontend artifacts. Retire only with an explicit recovery/retention replacement; no rollback was attempted.

## Future commitment-to-review provenance — list only

- Add immutable reviewRunId + reviewTopicId (both or neither), or an origin link table; do not reuse the agenda/topic foreign keys. Extend API/DTO/schema and include origin in the idempotency identity.
- In the creation transaction, verify tenant/actor, accepted run, current frozen-source authority and topic membership. A separate preflight read leaves a revocation race. Keep the user-confirmed fields and blank completion criterion; never convert a model proposal into a human decision automatically.
- Define visibility first: existing company commitments and owner/current-ACL review reports have different audiences. Copied private titles can leak even if the origin link is hidden. An owner-only origin/action policy is the conservative starting point pending sharing rules.
- Bind to the immutable accepted run/topic, not the active pointer. Specify revoked/unavailable origin behavior and retained/tombstoned history; test authorization races, idempotency conflicts, atomic rollback, regeneration/restore, sharing and archive/purge behavior.
