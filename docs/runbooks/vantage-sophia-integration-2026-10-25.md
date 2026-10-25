# Vantage: first Sophia V0 integration round — 2026-10-25

This is an isolated, synthetic integration experiment. Production V0 generation, the default Generate route, public research, and Joseph's production module remain disabled.

**Result:** the actual Company Architecture Adapter, Sophia retrieval, TL registry/assembler and a genuine V0-consuming model call compose successfully. Both live pairs passed; the final experimental prompt is `vantage/sophia-paired-context/v0.2`. The final B result's native V1 carrier and canonical citation set passed PostgreSQL guarded commit; the contextual report remains an artifact. The observed benefit is a more explicit privacy-review decision, with remaining reasoning weaknesses; a separate incremental benefit from canonical Company Architecture has not been established.

## Provenance and preservation

- Local baseline: `feat/vantage-previous-context`, `8a3221a1b5d24e186ff119e0dc35c3af56e54dfe`.
- Sophia delivery: [PR #557](https://github.com/Deodat-Lawson/LaunchStack/pull/557), fork `TongyeZ/LaunchStack`, branch `codex/sophia-vantage-retrieval`, pin `c6eb63c6a6d6705b60a6ccec8bcba7704fee3532`, original base `364a3c8bd3b1c5bb2ee45cf66c1ea608b3c44618`.
- Local `cherry-pick -x`: `713685308a434288f0ab9748491552538274c571`. Its message retains Sophia's original commit. The only conflict was the `context-v0/index.ts` export list; both the Company Architecture and Dynamic Retrieval exports were preserved.
- Integration implementation: `fd728a44129999bc4dc8c9bea47bb688d3ce34c4`.
- Worktree: `C:/Users/junku/orca/LaunchStack/test-output/vantage-sophia-integration/20261025T201037Z/source`; branch `integration/vantage-sophia-v0`.
- Original checkout remains on `feat/weekly-agenda-contract-v1` at `a9d3e64240551a648c36ba04bce6078e0408168e`. All 17 pre-existing dirty/untracked file hashes were checked. The feature checkout remains clean at `8a3221a`.
- No reset, rebase, remote merge or push. Existing worktrees, credentials and database volumes were preserved.

All raw artifacts below are relative to this integration worktree:

`test-output/first-sophia-v0/20261025T201037Z/`

The directory is ignored. Attempts use exclusive filenames; earlier failed attempts were retained. No endpoint resource name, key, password or authorization header is stored in raw provider artifacts.

## Composition and evidence boundaries

```text
Authenticated synthetic actor + native Company Profile/documents/ACLs
  → actual Company Architecture Adapter
  → mocked Joseph-compatible roles and personal Stars
  → server-authorized exact-version source catalog
  → Sophia runDynamicContextV0 / createDynamicRetrievalProviderV0
  → TL Source Registry / Context Manifest Assembler / frozen evidence snapshot
  → experimental context-aware generator
  → TL guarded commit checks / experimental receipt
```

| Component | What actually ran |
| --- | --- |
| Company Profile | Native `company_metadata`, profile-source and document-version rows in isolated PostgreSQL; no second profile generator |
| Company Architecture | Existing actual adapter, with native document ACL checks and conservative provenance filtering; profile stays `unreviewed` |
| Actor | Synthetic session/cookie identity double; real native membership, role permissions, document/folder grants and version reads |
| Business Roles / personal Stars | Explicit server-owned synthetic Joseph-compatible fixture ports; versions rechecked; no production role mapping or Star discovery |
| Sophia retrieval | Actual published provider and pipeline, using the authorized bounded catalog and synthetic native metadata; local catalog ranking, no production embedding/RAG bridge |
| Registry / assembler | Existing TL authoritative implementations; retrieval selects from trusted records and cannot mint source bodies |
| Research | No public tool or connector; the default explicit STOP path |
| Generation | Separate original V1 control and opt-in experimental model call; V0 content does not enter the production Generate route |
| Persistence | Experimental receipt through guarded native transaction; no new action, task tracker, report DTO or production V0 save route |

Canonical profile facts and extractor/source rows were seeded as synthetic native records. This round did not execute Company Metadata ingestion, extraction or synthesis. The Company Architecture projection, database reads, authorization, retrieval, assembly and guarded receipt checks are actual implementations.

The composer is explicitly synthetic-only, requires the dedicated loopback test database and marked synthetic company/document rows, and has no route. Initial reads, freshness reads and final persistence use short Company Architecture guarded transactions. Native document refs retain their actual document-version IDs; text hashes and metadata fingerprints remain separate. The final composition guard also binds native Vantage input and report state.

Historical pending questions are clues with unknown progress. They are **never** converted to retrieval `state: open`. The fixture's older open item has separately supplied explicit state at the exact reporting cutoff. A resolved work record does not close a carried question; only supported human disposition can do that.

## Experimental generation shape

`createContextAwareGenerationAdapter` alone does not inject model context. The new opt-in experiment actually sends the frozen selected excerpts, checked source refs, role IDs/versions, reporting window and manifest fingerprint through the existing model transport. Required-source reservation happens in the host/pipeline. The current model payload does not label personal-Star priority separately.

One B provider response contains two drafts:

- `native`: a valid V1 carrier using only the original native V1 evidence IDs, at most one topic.
- `experimental`: the contextual report sidecar, with canonical `{kind,id,version}` refs for actual registered sources. There are no fabricated `ev:` mappings for documents or Company Architecture.

Both drafts are authored in that same response. The separately executed A control is not reused as B's carrier. Invalid sidecar refs or reliably detected event-state contradictions enter the existing repair path; a Rules fallback cannot be labeled successful context-aware generation.

Budgets remain 23,500 prepared input bytes plus the existing repair reserve under the 24,000-byte transport ceiling; 2,400 combined output tokens; at most two 20-second attempts inside 45 seconds. Required context is not silently clipped to make this fit. A setup exceeding the envelope fails explicitly.

The existing envelope carries role IDs and versions, not complete business-role descriptions or a separate provider-constraint list. The model is told this limitation. Company Profile content remains unreviewed contextual claims; source authorization and exact citation IDs do not establish semantic entailment.

## Reproduction and initial validation

Use Node `24.19.0` and the repository-pinned pnpm `10.15.1`. The run used the pinned pnpm JavaScript entry because the globally installed pnpm was a different version. `pnpm install --frozen-lockfile --ignore-scripts` installed the isolated worktree dependencies; an earlier offline attempt lacked one cached package and was retained.

Before integration additions, Sophia's original scripts ran:

```powershell
pnpm --filter @launchstack/pipelines test:retrieval
pnpm --filter @launchstack/pipelines demo:retrieval --json
```

- Original focused tests: **141/141**, 1.34 seconds Vitest / 1,945 ms command.
- Original six-scenario demo: **6/6**, 953 ms command. The first sandbox launch failed at Windows `tsx` startup (`uv_os_get_passwd` / `ENOMEM`) before running; the unsandboxed retry passed. Public research in that demo is a synthetic double, not a network call.
- Pre-experiment Vantage suite: **390 passed / 54 database cases skipped**; the database cases were then run against PostgreSQL.
- Isolated PostgreSQL harness: **85/85 pipeline tests and 219/219 web API/auth/profile tests**. This includes 54 native persistence tests and 16 native Company Architecture tests. Engine/product migrations were already up to date; no database reset occurred.

Sophia's reported suggestions-test failures were reproduced: **16 passed / 2 failed**. Four assertions expected `patchTopic` without its existing third version argument. The calls and assertions predate Sophia's changes; her pin changes none of the affected production files. Adding expected version `1` to those four test assertions gives **18/18**, with no production CAS change.

The integration adds six pending-history retrieval-boundary tests and 17 context-aware generation tests. The combined Vantage unit run is **413 passed / 54 skipped**, with those database cases covered separately. The selected UI/pending-question/RAG-access suite is **122/122**; the retrieval package is **29/29**.

Logs and exact command/duration JSON are under the raw directory's `logs/`. A mistaken broad Jest pattern invocation was interrupted after it selected unrelated suites; it is not counted as a completed workspace validation. Explicit `--runTestsByPath` commands are used for the reported web results.

## Exact integration changes

The implementation commit changes nine files:

| File | Purpose |
| --- | --- |
| `apps/web/src/server/vantage/experiments/sophia-composition-v0.ts` | Synthetic-only composition, native ACL/version/content reads, server-owned fixture freshness, TL guarded commit |
| `apps/web/src/server/vantage/experiments/sophia-fixture-v0.ts` | Reusable native PostgreSQL company/profile/document/evidence fixture and explicitly mocked Joseph ports |
| `apps/web/__tests__/server/vantage-sophia-composition.integration.test.ts` | 20 real database tests; explicit opt-in live child and guarded receipt |
| `pipelines/src/vantage/experiments/sophia-generation-v0.ts` | Actual V0 excerpt consumption in one compound response per bounded attempt; canonical experimental sidecar |
| `pipelines/src/vantage/experiments/sophia-generation-v0.test.ts` | 17 deterministic transport/validation/budget tests |
| `pipelines/scripts/vantage-sophia-generation-experiment.mjs` | Sequential original-V1 versus contextual observer; request bodies, responses, actual usage and source-file fingerprints |
| `pipelines/src/vantage/dynamic-retrieval/pending-history.test.ts` | Six tests preventing historical questions from becoming authoritative open work |
| `apps/web/__tests__/components/vantage-suggestions.test.tsx` | Four test-only CAS expectation corrections |
| `scripts/dev/vantage-integration-tl-test.mjs` | Includes the new composition suite in the existing isolated database harness |

Sophia's cherry-pick contains her 16 delivered files, including Dynamic Retrieval/research, Founder Weekly Review change metadata reuse, scripts, and optional version/chunk metadata in the existing RAG types. No shared V0 contracts were replaced. This runbook is a separate documentation commit.

## Final regression results

| Actual command | Observed result |
| --- | --- |
| `pnpm --filter @launchstack/pipelines exec vitest run src/vantage` | 413 passed, 54 skipped, 1.99s Vitest; the skipped database cases passed below |
| `pnpm exec node scripts/dev/vantage-integration-tl-test.mjs` | 85 pipeline + 239 web tests passed, 16.354s total; 13 web suites include all 20 new actual PostgreSQL cases |
| `pnpm --filter @launchstack/web test --runInBand --runTestsByPath ...` | 122 selected UI, pending-question, Company Architecture unit and RAG ACL tests passed |
| `pnpm --filter @launchstack/retrieval test` | 29 passed |
| `pnpm --filter @launchstack/pipelines typecheck` | Passed, including final v0.2 module |
| `pnpm --filter @launchstack/web typecheck` | Passed |
| `pnpm --filter @launchstack/retrieval typecheck` | Passed |
| Scoped ESLint on integration/retrieval/RAG changes | Passed; repository Next pages-directory configuration notice only |
| Prettier check on new experiment/test files | Passed |
| `git diff --check` | Passed |

The database suite includes real writes/readback and rollback, full native-input comparison rather than trusting its `inputVersion` field, report fingerprint CAS, denied/foreign sources, exact versions and content hashes, same-version metadata/body drift, required Star capacity and revocation, partial/missing Required Context, connector-copy deduplication, independent conflicting reports, and mutable mocked role/Star versions. In three cases the injected generation call changes document ACL, document text or Company Profile: generation returns AI output, and final persistence is refused with zero persistence callbacks.

The final guard invokes TL `commitContextGeneration`, including envelope/result binding and `assertFreezeCurrent`. An opaque private token maps to the Company Architecture adapter's owned transaction. That transaction holds profile/document/ACL locks and native Vantage table SHARE locks. The repository snapshot reads through the same physical database pool, whose identity is checked, while those locks prevent source/report changes; it is not a separate nested save transaction. Only the test's synthetic agenda receipt is written on that transaction. The full contextual report remains an artifact; no generated Topics, actions or Commitments are saved.

Original generator, event-state grounding, Rolling Carry-Forward, repository, Contract v1, V0 ports/contracts/registry/assembler/adapters, canonical profile producer, production model configuration and default Vantage route were checked unchanged from `8a3221a`. A privacy scan of the raw artifacts and changed files found zero configured secret matches. The original 17 dirty/untracked file hashes and clean feature branch were rechecked.

## Live execution and measured usage

Both pairs used the same approved Azure deployment `gpt-6-luna`; every actual provider response identified **`gpt-6-luna-2026-09-22`**. The local credential-free configuration SHA-256 is `2b5e377779313de1e13868b4c61f0633d15b63a3eb82e03d761f399768e02bb9`. Endpoint/credentials were supplied in memory. No model, provider, effort setting or budget was substituted.

Each pair has identical native A/B input hashes. The second pair uses a fresh fixture with equivalent evidence and new native IDs. It is not byte-identical to the first pair. Reporting week: 2026-10-12; synthetic reporting cutoff: 2026-10-19T16:00:00Z. Native ACL/data queries are real; fixture timestamps and the host clock are deterministic synthetic values.

| Pair / mode | Actual calls | Prompt tokens | Completion tokens, including reasoning | Total tokens | Generation duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `live-host-01`, A original V1 | 1 | 2,745 | 865 | 3,610 | 6.253s |
| `live-host-01`, B experiment v0.1 | 2 | 10,070 | 4,735 | 14,805 | 30.726s |
| `live-host-02`, A original V1 | 2 | 5,524 | 2,242 | 7,766 | 15.586s |
| `live-host-02`, B experiment v0.2 | 1 | 5,089 | 2,170 | 7,259 | 13.239s |

All four final results are validated AI results with `fallbackReason=null`. Six actual provider calls were made across the two pairs, totaling 33,440 tokens. USD pricing was not measured. Do not infer stable efficiency from the second pair: repairs reversed the first pair's timing. B also splits its output cap between a carrier and contextual report, so this is not an isolated context ablation or an equal-output-budget benchmark.

Two rejected responses were preserved:

- First B v0.1 response: HTTP 200, `finish_reason=length`, empty visible content, all 2,400 completion tokens consumed as reasoning. The existing repair returned valid output. B's internal usage diagnostic counts the accepted parsed response only; the table above correctly sums both raw provider responses.
- First A in the final pair: HTTP 200, `finish_reason=stop`, but its new Topic contained an extra `baseTopicVersion: 1`. Replay against the actual strict Zod schema reports exactly that unrecognized key. Repair removed it. This was an unchanged V1 model/schema failure, not a retrieval incompatibility.

Review found that v0.1 called all checked refs `requiredRefs`, including optional sources. The only v0.2 payload change renames that field to `checkedRefs`; it does not change selection, model behavior configuration, budgets or production prompts. Both attempts remain separately available. Prepared B prompt sizes were 23,097 / 23,336 bytes in v0.1, and 23,150 in v0.2, all below 23,500. The final prompt has limited spare capacity; larger valid manifests can explicitly fail model setup without deleting Required Context.

Each actual B request contained exactly one Company Architecture record and the required personal Star. Hidden and foreign synthetic source bodies were absent from all actual model requests. The final B receipt is `4bdf0858-192b-4b60-a7b0-00857aa4623c`, company `2035`; the first is `97a1a869-d6e9-4cca-bfd0-8d27ef43a83b`, company `1811`. These new synthetic datasets and receipt rows were intentionally retained for inspection; ordinary test fixtures clean only their own newly created rows.

## Grounding and reasoning assessment

Both reports correctly attribute QA's 3/3 sample and operations' 2/3 sample, preserve the possibly different account lists, and avoid claiming privacy approval or independently verified completion. A already proposed concrete account-level reconciliation. B's main added value is a distinct named-reviewer acceptance question supplied by the authorized privacy-review record. Final B also cites the company backing document for the separation of engineering success and acceptance review.

The canonical Company Architecture was delivered, was `unreviewed`, and included actual source/version provenance and marked unknown industry, personnel, hierarchy and decision authority. Neither live B report cites the canonical `company` ref. The final report cites its original company document instead. This is safe provenance, but the same privacy constraint appears there and in the Star: an incremental reasoning benefit from the canonical projection alone is **not established**. Likewise, retrieval used both role profiles, but the model received role IDs/versions only; responsibilities-conditioned model reasoning is not demonstrated.

Manual final-pair source checks:

| Generated material | Supporting exact source | Finding |
| --- | --- | --- |
| A's QA fact | `ev:cdfdd78f-2212-4d6b-933b-d13682db06f0` | Matches 3/3 reported sample result and explicit no-sign-off qualification |
| A's operations fact/conflict | `ev:46427b85-d3bd-4799-acfc-52573bf5569f`, both ev refs for conflict | Matches 2/3, remaining record, possibly different samples; no invented trend |
| B1 QA/operations facts and conflict | `doc:workspace-document/1109@1113`, `doc:workspace-document/1111@1115` | Same actual supplied accounts; explicitly not a confirmed shared-sample comparison |
| B1 older blocker | `doc:workspace-document/1112@1116` | Accurately says the historical blocker “stated” the question; does not infer current incomplete work from silence |
| B2 retained go/no-go question | `doc:workspace-document/1108@1112` | Human review record supports the request, not completed review or current universal absence of approval |
| B2 company constraint | `doc:workspace-document/1107@1111` | Actual supplied company text says access needs acceptance review beyond an engineering test |
| B2 QA qualification | `doc:workspace-document/1109@1113` | Correctly distinguishes reported sample success from privacy sign-off |

Decision/action review by Topic:

1. **A — Reconcile run-17 deletion results.** The account-by-account question is useful and comparison is executable. Its final success condition is too broad: “if all matched accounts are deleted, treat that as a reconciled run result” can overlook an unmatched account containing the remaining record. That is a proposed-inference weakness, not a false cited fact.
2. **B1 — Find out whether the run-17 checks tested the same accounts.** Useful, specific question about overlap and the remaining record. Its check explicitly includes that record before deciding whether another reconciled-sample test is needed. This is better scoped than A's matched-only success condition. It still does not specify the exact deletion-path investigation if a residual persists.
3. **B2 — Clarify the deletion acceptance review status.** Adds a real governance clarification: whether a named reviewer recorded a decision. The source-location and reviewer identity are unknown. Its “only … approval” rule for treating the question as answered is over-prescriptive: a documented no-go decision or explicit human addressed/dismissed review can also address a question. Other authorized/later records remain possible. This text did not close anything: the live fixture's pending ledger is empty, the output is a sidecar, and persistence saves no Topics or action states.

The B summary's “says no approval is recorded” remains attributed to the human review record; its facts more precisely say **that document** has no approval record, and unknowns acknowledge later/other authorized records. Prefer the latter precision. No definite unsupported global completion/approval assertion was found in the cited facts. This limited observation is not full semantic entailment validation.

Initial subjective scores for the final pair, 1–5; these are qualitative judgments, not benchmark measurements:

| Dimension | A | B | Concrete basis |
| --- | ---: | ---: | --- |
| Factual Grounding | 5 | 5 | Every actual fact/conflict was manually matched to the texts above; this score excludes the proposed-inference weaknesses assessed below |
| Cross-Source Synthesis | 4 | 4 | Both preserve possible sample mismatch; B connects technical results to the supplied review requirement |
| Decision Usefulness | 4 | 4 | Specific reconciliation/go-no-go questions, but no defined acceptance threshold or known reviewer |
| Actionability | 3 | 4 | A's partial-match result criterion is insufficient; B1 checks the residual, while B2's exclusive closure wording still limits quality |
| Prioritization | 4 | 4 | Current discrepancy and review uncertainty lead; neither creates lunch or resolved-deployment filler |
| Uncertainty Handling | 4 | 4 | Good account/approval caveats, weakened by A's result rule and B's approval-only rule |
| Specificity | 5 | 5 | Actual run-17, 3/3 versus 2/3, remaining record and named-reviewer requirement |
| Non-Redundancy | 5 | 4 | A has one focused topic; B separates technical and review decisions but reuses the QA/sign-off fact |

## Remaining limitations and next integration step

1. **Replace the mocked Joseph ports next.** Plug his actual actor-bound Business Role and Required Context/Star resolvers into the existing interfaces. Bind real role, profile, Star and ACL versions to capture/final commit; retain mandatory reservation and fail closed when required context is partial. Do not derive authoritative open state from pending historical questions.
2. **Complete the server-authorized production source bridge with Sophia.** This experiment uses real authorized native synthetic rows and her real provider, but no production vector/BM25 search, embedding call or connector. A production bridge must resolve exact native versions and server-owned content/ACL metadata, including copies with proven common origin. Query budgets currently count provider/search lanes, not all native SQL/auth calls; Company Architecture has its own bounds.
3. **TL owns production persistence and citation presentation.** Keep doc/company refs exact. The frozen V1 DTO and source endpoint do not represent this sidecar's citations. A reviewed experimental/V0 presentation and atomic durable-worker save integration are still required; this receipt is not that integration. Do not nest unchanged `saveGeneration` inside another transaction.
4. **Required/profile semantics remain bounded.** Canonical profile is not human-approved, richer role descriptions/provider constraints are absent from the model envelope, and Company Architecture's separate contribution is unisolated. Actual dependency-complete provenance and explicit review capabilities remain the existing adapter's production dependencies; do not relax them.
5. **Quality and cost need more evidence.** Retrieval retained a lunch update, a resolved older item and a pending/unverified historical document under its loose source budget; the model omitted filler, but these consumed scarce prompt bytes. Repeated native/document copies are not independent corroboration. Exact refs and narrow event-state checks do not catch A's partial-match reasoning or B's exclusive closure rule. Preserve repair usage when measuring costs and test more companies/weeks before claiming improvement.

No second profile generator, task tracker, Historical Selector, role-mapping module, public research activation or new retrieval architecture was introduced. Historical reports/actions and original pending-question IDs are unchanged; the 54 real repository persistence cases cover cross-week continuity. Default production generation remains V1, with the existing factual-grounding and human-review protections.

## Reproduction paths

The tracked PostgreSQL suite prepares the native synthetic fixture. With the dedicated local database variables already supplied by the existing isolated harness, run:

```powershell
pnpm exec node scripts/dev/vantage-integration-tl-test.mjs
pnpm --filter @launchstack/pipelines exec vitest run src/vantage
pnpm --filter @launchstack/retrieval test
```

The opt-in live test additionally needs `VANTAGE_SOPHIA_LIVE=true`, an absolute ignored `VANTAGE_SOPHIA_COMPOSITION_ARTIFACT_DIR`, approved `CHAT_BASE_URL` / `CHAT_API_KEY`, and an **absolute** `CHAT_MODELS_CONFIG` pointing to the preserved Azure YAML. Do not print their values. `VANTAGE_SOPHIA_KEEP_FIXTURE=true` retains only the new synthetic fixture and receipt for inspection. Run only the test named `emits a reusable actual-PG envelope` when requesting a live pair. Ordinary combined tests disable models and need no model credentials.

In this workspace, the preserved ignored launcher performs that setup without credential output:

```powershell
node test-output/first-sophia-v0/20261025T201037Z/run-experiment.cjs repeat-unique live test-output/first-sophia-v0/20261025T201037Z/run-live-host.mjs repeat-unique
```

Use a new label; it refuses overwrites. The tracked pure observer can also repeat generation from a saved synthetic envelope without accessing the database:

```powershell
node --import tsx pipelines/scripts/vantage-sophia-generation-experiment.mjs --live --input <absolute-synthetic-envelope.json> --output <new-output-directory>
```

That standalone observer establishes frozen-snapshot generation only. The opt-in PostgreSQL host retains the branded capture across the actual model child and performs final current-state validation before receipt insertion. Live outputs can vary even with identical inputs, configuration and prompt version.

Raw final paths under `test-output/first-sophia-v0/20261025T201037Z/`:

- `live-host-02/sophia-composition-7d6e4597-1a9e-4f0e-bc3a-416273cb9e01.json`: original native inputs, real profile/source projection, authorized manifest/snapshot, exact versions/hashes, source fixture definitions.
- `live-host-02/live-7d6e4597-1a9e-4f0e-bc3a-416273cb9e01/`: A/B actual outputs, body-only requests/responses, prompt/model configuration fingerprints, native evidence selection and execution records.
- `live-host-02/live-7d6e4597-1a9e-4f0e-bc3a-416273cb9e01.guarded-receipt.json`: actual final receipt/readback.
- `live-host-01/`: separately retained initial v0.1 pair and receipt, including B's truncated response.
- `live-evaluation-observations.json`: actual usage sums, schema replay, transmission checks and receipt identities for both pairs.
- `executed-code-verification.json`: source bytes recorded by the final live observer match the committed implementation files.
- `logs/postgres-combined-final.{log,json}`, `logs/final-vantage-v02.{log,json}` and other labeled logs: exact commands/results/durations.
- `pre-commit.verification.json`, `pre-commit.preservation.json` and final equivalents: frozen-code/privacy/preservation checks.


## Final source inventory

Final manifest fingerprint: `e313d2239baf932d186d6c9793692f660250cdb9cd64f39a45c7226e24ab3b46`. Retrieval status is `complete`; research is explicit `STOP/stopped`; manifest status is `partial`. Required coverage has no missing/revoked sources. The inherited assembler reports a partial overall manifest when optional research is stopped; this does not mean Required Context was silently filled.

| Selected source | Native role / content | SHA-256 of exact content |
| --- | --- | --- |
| `{"kind":"company","id":"company-metadata/2035","version":"company-profile-v0:a97b9a3807b2205e6b0a2a403b5e67977ee22073813b9ed80009f1ac2bdc8cf0"}` | canonical Company Architecture (unreviewed) | `5ec4c484255b707a1ebef495b95e81c0756497f3a6b22a92429cd6b3bb8dfe95` |
| `doc:workspace-document/1107@1111` | company | `051f3775576c1f442c60fb968e44f51c8d4ff54ed45c951bb3bc3c26096c0443` |
| `doc:workspace-document/1108@1112` | privacyStar | `adb403a7f345786408373e8a3273d78e1fe8a6079ae4b49a71ab1e8963492ca3` |
| `doc:workspace-document/1109@1113` | deletionQa | `fb5c1e4c085382d48acfdc64d5ec155818352c9222eb47957f19411156036956` |
| `doc:workspace-document/1111@1115` | independentOps | `1dc40d3d83c215f033857abdcd92dc1963961d8852abe3911b90a1ed495a9ded` |
| `doc:workspace-document/1112@1116` | olderBlocker | `9ce5941fd7220466b219f742562bc7e209458d82ad6f1ced4a6864a4596eae0c` |
| `doc:workspace-document/1113@1117` | olderResolved | `d08b5f4064725dedd4b9f5251405b51c70eb93bb5a85ca44d9384e20f951a564` |
| `doc:workspace-document/1114@1118` | pendingQuestion | `bee6b098e8f83a9597d5ea8eec7f23c92808a4c9e5ae4058ff92944a429729e6` |
| `doc:workspace-document/1115@1119` | irrelevant | `f6215b9aaf381fd445531bc23a5ca4a02e8a0c893fa55d9fc3ac93dc821c43fa` |

Selected 9 sources: 1 canonical company record and 8 native documents. Excerpts total 2454 characters / 2454 UTF-8 bytes, within the shared source budget (20 sources / 12,000 excerpt characters / 16,000 conservative token units). The separate full model-envelope bound also passed.

Omitted proven connector copy: `doc:workspace-document/1110@1114`. It has identical QA text and explicit matching connector/origin/revision; the independent operations source remains. Hidden/ungranted and foreign sources were excluded before the catalog: 2 unavailable entries, no disclosure in actual model requests.

The older blocker is the only `unresolvedOlderItems` lane entry and has separately explicit as-of open metadata. The resolved item and pending/unverified document remain ordinary role matches; neither becomes authoritative open work. The recent lunch update also fits the loose context budget. None becomes a generated filler Topic. No metrics, observations or Commitments exist in this fixture; the 3/3 and 2/3 accounts are reported samples, not a computed longitudinal metric trend.

## Full final weekly report examples

These are the actual accepted final-version outputs, with exact source references. No suggested owner or due date was invented; both reports have no enhancements. The experimental report is separate from the native B carrier, which is also preserved in the raw output.

### A — Original V1 generator

**Weekly Summary**

> For synthetic run-17, QA reports 3 of 3 sampled accounts deleted, while the independent operations audit reports 2 of 3 and one record remaining. The audit says its account list may differ from QA’s, and no shared sample was supplied, so the results do not establish a reconciled pass or failure; QA also says its result is not a privacy sign-off. This week’s useful focus is to reconcile the sampled accounts and their deletion records before drawing a conclusion.

**Topic 1: Reconcile run-17 deletion results**

Facts:

- QA reports that 3 of 3 sample accounts were deleted and says its sample passed; it notes that this is not a recorded privacy sign-off. Sources: `ev:cdfdd78f-2212-4d6b-933b-d13682db06f0`.
- The independent operations audit reports that 2 of 3 sample accounts were fully deleted and one record remained; it says its account list may differ from QA’s and no reconciled shared sample was supplied. Sources: `ev:46427b85-d3bd-4799-acfc-52573bf5569f`.

Interpretation: The two reports give different outcomes, but the possible sample mismatch means they cannot yet be treated as measurements of the same accounts. Reconciling them could clarify the run’s deletion status; neither report establishes privacy sign-off.

Decision Question: Can the QA and operations samples be reconciled account by account, and what deletion status is confirmed for each shared account?

Proposed Next Step: Compare the sampled account lists and deletion records, then note overlap and each matched account’s status. If any matched account still has a record, investigate that account’s deletion path; if all matched accounts are deleted, treat that as a reconciled run result, not as privacy sign-off.

Owner: `null`. Due date: `null`. Help requested: `null`.

Unknowns:

- Whether the QA and operations samples overlap.
- Which account or record remained in the operations audit and its current status.
- Whether any separate privacy sign-off has occurred.

Conflicts:

- QA reports 3 of 3 sample accounts deleted, while the independent operations audit reports 2 of 3 fully deleted and one record remaining; the audit cautions that the samples may differ and no shared sample was supplied. Sources: `ev:cdfdd78f-2212-4d6b-933b-d13682db06f0`, `ev:46427b85-d3bd-4799-acfc-52573bf5569f`.

Rationale: Prioritize this because the supplied reports for the same run disagree on deletion results, and the audit says there is no reconciled shared sample. Account-level comparison is needed before interpreting the difference.

### B — Experimental context-aware sidecar (v0.2)

**Weekly Summary**

> Run-17 deletion results remain unreconciled: the QA deletion verification reports 3 of 3 accounts deleted, while the independent operations audit reports 2 of 3 and one record remaining; operations says the account lists may differ. The human privacy review record says to retain the deletion go/no-go question until a named reviewer compares the samples and records approval, and says no approval is recorded. A useful focus is to reconcile the sample accounts and remaining record, then clarify whether a named reviewer has completed the required comparison; these checks would inform, not themselves constitute, approval.

**Topic 1: Find out whether the run-17 checks tested the same accounts**

Facts:

- The QA deletion verification reports 3 of 3 sample accounts deleted and says the sample passed; it is not a recorded privacy sign-off. Sources: `doc:workspace-document/1109@1113`.
- The independent operations audit reports 2 of 3 sample accounts fully deleted, with one record remaining. It says the account list may differ from QA's and no reconciled shared sample was supplied. Sources: `doc:workspace-document/1111@1115`.
- An engineering deletion reliability blocker stated: identify which run-17 accounts remain after deletion. Sources: `doc:workspace-document/1112@1116`.

Interpretation: The checks have different reported outcomes, but the samples may differ. Reconciling the lists and checking the reported remaining record could clarify the discrepancy and address the specific reliability question; it would not by itself establish privacy acceptance.

Decision Question: Do the QA and operations lists overlap, and what is the status of the record operations reported as remaining?

Proposed Next Step: Compare the QA and operations account lists, then check the reported remaining record. Observe which accounts overlap and whether the record remains; use that result to decide whether to run another deletion check on a reconciled sample.

Owner: `null`. Due date: `null`. Help requested: `null`.

Unknowns:

- Whether the samples overlap or can be reconciled.
- Whether the operations-reported record remains present.
- Whether any subsequent deletion check has been performed.

Conflicts:

- QA reports 3 of 3 sample accounts deleted; operations reports 2 of 3 and one record remaining, while noting the account lists may differ. These are not confirmed results from a shared sample. Sources: `doc:workspace-document/1109@1113`, `doc:workspace-document/1111@1115`.

Rationale: The current checks provide specific, differing run-17 results, and a historical engineering blocker names identifying remaining accounts as the issue. The proposed check tests that question without treating either sample as definitive.

**Topic 2: Clarify the deletion acceptance review status**

Facts:

- The human privacy review record says to retain the deletion go/no-go question until a named privacy reviewer compares QA and operations samples and records approval; the document contains no approval record. Sources: `doc:workspace-document/1108@1112`.
- The supplied privacy description says access needs a deletion acceptance review, not only an engineering test pass. Sources: `doc:workspace-document/1107@1111`.
- The QA verification says its 3-of-3 sample result is not a recorded privacy sign-off. Sources: `doc:workspace-document/1109@1113`.

Interpretation: The supplied review record distinguishes an engineering sample result from acceptance approval. The record does not establish that approval was given, so the acceptance status remains unresolved in the available evidence.

Decision Question: Has a named privacy reviewer compared the QA and operations samples and recorded a go/no-go decision?

Proposed Next Step: Check whether a named reviewer has made and recorded the comparison required by the review record. Observe whether the record contains the comparison and an approval; only that documented result would support treating the go/no-go question as answered.

Owner: `null`. Due date: `null`. Help requested: `null`.

Unknowns:

- Whether a named reviewer has completed the comparison or recorded a decision since the supplied review record.
- Whether the deletion acceptance question has been addressed through any other authorized record.

Conflicts:

None generated.

Rationale: The supplied human review record explicitly keeps the go/no-go question open pending a named review and recorded approval, while the QA result expressly is not a sign-off. This suggests a distinct clarification from reconciling the technical samples.

