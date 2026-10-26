# Joseph V0 integration experiment — 2026-10-26

## Stable checkpoint first

Phase 1 completed before this branch began. The verified GitHub branch `demo/vantage-integrated-mvp` is frozen at **7bf2f201e0c56ff60b615477b5421e668563d28a**. Use that branch and **http://localhost:3104/dev/vantage-context** for tonight. Its [clean-clone setup](vantage-demo-clean-clone.md) and [acceptance](vantage-demo-stable-acceptance-2026-10-26.md) remain valid regardless of this experiment.

## Source and integration status

Feature branch: **feat/vantage-joseph-integration**. Source PR: [LaunchStack #561](https://github.com/Deodat-Lawson/LaunchStack/pull/561), draft, Joseph fork `josephlongbui-stack/LaunchStack`, exact commit **515a80cf648bde45e75714cbcc488f7fc6a2809f**, original base **364a3c8bd3b1c5bb2ee45cf66c1ea608b3c44618**.

Selective import commit **b374843** preserves Joseph's role/provider/UI provenance. His conflicting standalone preview/page was excluded; the existing integrated frontend was extended. Package exports changed by 12 lines, retaining existing manifest indentation. Shared V0 interfaces, frozen Contract v1, production V1 routes, generation prompts and budgets are unchanged.

**Verified partial integration:** real Joseph multi-role recognition, optional primary perspective, versioned directory, source-aware stars, provider and reusable UI are wired through an authenticated, explicitly enabled development API. Actual canonical Company Architecture, Sophia catalog/retrieval and TL registry/manifest/ACL guards are reused. Successful Joseph-owned report generation is **blocked**, not claimed.

The decisive incompatibility is Joseph's unchanged required-context policy: it accepts `reviewed` or `unknowns-marked` Company Architecture, while the actual canonical adapter correctly emits `unreviewed`. The shared TL contract allows unreviewed contextual claims, but that does not override Joseph's stronger policy. No fabricated approval, review receipt or relabeling was introduced.

## Implemented host and UI

- `/api/vantage/demo/personal`: authenticated GET and strict revision-checked PATCH for roles/stars. Actor/company are resolved by existing server context and verified against the owned synthetic descriptor. Client identity selectors and forged versions are rejected.
- `joseph-personal-host.ts`: real Joseph provider with server-owned actor-authorized records from the existing Sophia composition. It introduces no independent unrestricted document reader. Current company/source identities, exact versions, contents and ACLs are rechecked.
- Personal state is scoped by company/principal/module in **server-process memory**, not localStorage and not PostgreSQL. Browser refresh retains it while the same server runs; server restart loses choices. No production schema or persistence claim is made.
- Source choices use full `workspace-document/N` IDs and exact native version IDs. Numeric IDs are parsed only within the server's existing Sophia bridge. Old/unchanged available sources remain selectable. Unavailable source bodies/titles are withheld; own stale selections remain removable.
- The synthetic profile-title hint is explicitly `Founder + Engineering`; it is not an authorization role or production profile reader. Joseph's controlled directory/mapping supplies the actual multi-role behavior. Confirmed roles alter perspective only, not permissions or company authority.
- Epoch, revision, full roles/primary/star state, ACL and source identity join the personal snapshot. The prepared host role-profile versions bind that identity without changing the directory's actual mapping version. Final commit holds the personal CAS mutex through the existing guarded PostgreSQL transaction; stale snapshots reject.
- Sophia composition has a narrow optional `RoleContextPortV0` injection. A ready provider would supply required context to the existing pipeline, registry and assembler. Required context is never silently replaced by optional retrieval.
- Personal catalog reads omit the *old mock star requirement* while retaining document ACLs. Revoking that old mock source therefore does not prevent the actor from removing their own personal selection. Native report loading/generation keeps its original requirements.
- The frontend composes Joseph's panel into the existing Weekly Review. It retains the independently authorized original report, exact source panel, pending questions, diagnostics and human-review controls. It labels the old report's original context and the process-memory lifetime.
- When required context is incomplete, the Joseph-enabled Generate/Replay control is disabled. Direct generation also rejects **409**, while preflight returns `ready:false, providerCalled:false, persisted:false`. No model call or successful Joseph report save is invented.

The strict review gate occurs before Joseph can return a usable required bundle. The host exposes safe source-by-source diagnostics and the unreviewed blocker rather than labeling an incomplete manifest complete. The existing saved TL/Sophia report is an independently labeled prior report, not evidence that this gate passed.

## Run the isolated feature preview

Current local checkout:

`C:/Users/junku/orca/LaunchStack/test-output/vantage-joseph-integration-20261026/source`

It uses a new owned synthetic company namespace in the already verified portable PostgreSQL **127.0.0.1:55438/vantage_week2_tl_contract_v1**. No additional database was created for Phase 2. Current preview: **http://localhost:3106/dev/vantage-context**.

For a fresh checkout of this feature branch, install the same pinned dependencies as the stable runbook, then:

```powershell
$env:VANTAGE_CONTEXT_DEMO_DB_PORT = '55438'
$env:VANTAGE_CONTEXT_DEMO_APP_PORT = '3106'
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --setup

# Optional: first save the actual recorded report under the legacy TL demo policy.
# Joseph mode must be unset/false for this explicitly labeled replay.
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --serve
# Sign in, choose October 12, Replay recorded report, then stop this app with Ctrl+C.

$env:VANTAGE_CONTEXT_DEMO_JOSEPH_ENABLED = 'true'
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --serve
```

Retrieve only this checkout's generated synthetic login privately from ignored `test-output/vantage-context-demo/runtime/credentials.json`. Never copy a generic root .env or use pdr_ai_v2. No provider credentials are needed. Do not stop or reset the stable demo's database/volume.

The optional initial replay demonstrates the saved report independently; it is not a workaround to bypass the Joseph gate. Once Joseph mode is enabled, new generation remains blocked until its required review policy is genuinely satisfied.

## Actual validation

| Check | Result |
| --- | --- |
| Combined pipelines | **491/491**, 26 files, including 54 PostgreSQL repository tests |
| Combined web | **361/361**, 22 files before the final added revocation case |
| Final Joseph PostgreSQL rerun | **9/9**, including the added original-mock-star revocation case |
| Runtime safety | **12/12** |
| Unique selected total | **866 passed**, including **134 PostgreSQL tests**; zero selected failures/skips |
| Web and pipeline TypeScript | Passed |
| Scoped changed-code ESLint | Passed, zero warnings/errors |
| Changed-code formatting / diff whitespace | Passed; package exports retain existing four-space manifest style |
| Actual headless integration | **11 checks passed**, 8 screenshots, 48.467 seconds |
| Fresh model / successful Joseph report | **Not run / not produced**; strict review gate blocks it |

The final ninth PostgreSQL case reran eight existing cases; those repeats are not double-counted. A final ninth PersonalContextPanel test adds one new truthfulness regression (blocked sources are authorized previews, not assembled context), bringing the unique total to 866. Session/model identities are test doubles where the existing integration suites use them; browser acceptance uses actual Better Auth and actual PostgreSQL-backed source reads.

Actual headless browser verified ordinary synthetic login, 13-fact unreviewed Architecture, Founder + Engineering with Engineering primary, two exact-version stars, add/remove/re-add, same-process refresh, old exact citation opening, stale revision409, unknown source403, forged company400, preflight not-ready and generation409 with the prior report byte-content unchanged. Desktop and 390px mobile layouts remained usable without horizontal overflow. No foreground desktop/mouse was used.

Saved artifacts (relative to the feature checkout):

- `test-output/vantage-joseph/acceptance-final/`: actual browser results, source/version state, preserved report and eight screenshots.
- `test-output/vantage-context-demo/legacy-before-joseph/`: explicit initial recorded replay acceptance.
- `test-output/vantage-publication/joseph-combined-20261026203622827/`: full commands, 491/361 logs and results.
- `test-output/vantage-publication/joseph-pg-final-nine.log` and `.json`: final nine-case real PostgreSQL proof.
- `test-output/vantage-publication/joseph-runtime-combined.log`.

Earlier failed headless attempts are retained: cold personal-control checks exceeded the standalone 5-second assertion default, and an unknown-source assertion expected404 while Joseph correctly returned generic403. The final script uses a 30-second assertion budget and records the actual fail-closed status. Some real authenticated personal operations take several seconds because each provider boundary revalidates the existing source host. The 48-second walkthrough is not a production performance guarantee.

A pre-existing test-only literal typing error in `company-transport-v0.test.ts` was corrected by permitting its intentionally varied quote fixture to be string or null. No transport behavior or prompt changed.

## Remaining work / review decisions

1. Resolve the Company Profile review-policy contract: define a trustworthy explicit review receipt and unknowns workflow, or explicitly approve a policy change. Do not promote AI-derived profile content automatically. Until then, real Joseph generation stays blocked.
2. Review Joseph's proposed durable role/star storage, tombstone semantics and authenticated production APIs. No production migration, PostgreSQL role/star adapter or multi-process CAS storage was implemented.
3. Replace the explicitly synthetic title hint and fixture-only bounded catalog with approved canonical identity/profile and source adapters, preserving current actor ACL and exact provenance.
4. Validate successful Joseph required-bundle → Sophia retrieval → TL manifest → generation → guarded commit once the review-policy prerequisite exists. The optional injection and snapshot lock are implemented; that success path has not been runtime-demonstrated against the actual unreviewed profile.
5. Expand role-directory coverage only through an agreed taxonomy. Company functions such as Operations and Privacy are not automatically new business-role IDs, permissions or decision authority.
6. Production hosting/rollout, full-repository build/tests, public research and report quality improvements remain outside this task.

The stable branch stays frozen and usable. This feature branch is a separately reviewable, fail-closed experiment and must not replace tonight's stable demo or be merged into main automatically.
