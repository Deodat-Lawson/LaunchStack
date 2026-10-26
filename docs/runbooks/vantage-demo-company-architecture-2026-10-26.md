# Vantage demo: richer canonical Company Architecture — 2026-10-26

The small Company Architecture was caused by the **sparse synthetic fixture**, not by missing document access, a failed reader or a projection truncation. The database held three supported facts and the adapter projected those same three facts. This round enriches that owned fictional company's existing canonical profile and tests whether the generator makes better use of responsibilities, dependencies and decision authority.

Actual database/API and browser inspection confirm **13 supported projected facts**, zero projection omissions, unchanged native Vantage core-table hashes across enrichment, and a successfully saved real-model rich B. B cites the exact enriched company record and correctly treats its claims as unreviewed context. It does not yet use the added functional responsibilities to distinguish Engineering's work from Operations' work. A valid sparse live A is retained. An additional sparse control using the final encoder failed both provider attempts and was not saved; the comparison therefore has an explicit encoding/stochastic confound. Final typecheck, scoped lint and read-only preservation checks passed.

## Scope and provenance

- Worktree: `C:/Users/junku/orca/LaunchStack/test-output/vantage-frontend-mvp/20261026161746Z/source`.
- Branch: `demo/vantage-integrated-mvp`.
- Baseline HEAD: `39a726c2b84df0165013b020df80bebc9c462a46`.
- Implementation/documentation commit: the local commit containing this runbook; resolve with `git log -1 --format=%H -- docs/runbooks/vantage-demo-company-architecture-2026-10-26.md`.
- Owned synthetic company: `2037`; existing canonical profile row: `142`.
- All evidence files below are relative to [the raw-artifact directory](../../test-output/vantage-context-demo/company-architecture-rich-20261026/) unless stated otherwise. Complete accepted reports: [sparse A](../../test-output/vantage-context-demo/company-architecture-rich-20261026/sparse-v04-live-a.json) and [rich B](../../test-output/vantage-context-demo/company-architecture-rich-20261026/rich-v04-live-b.json).

No production Company Architecture adapter, V1 prompt, V1 evidence selection algorithm, public API DTO or frozen V0 interface is redesigned here. No real company information, production connector or public research tool is used. Existing native reports, topics, decisions, pending-question IDs, actions and metrics are preserved through the enrichment operation.

## Why only three facts were visible

`before-sparse.json` records an actual read-only database audit and the actor-authorized demo API result:

| Layer | Observed state |
| --- | --- |
| Canonical `company_metadata` | Exactly three populated fact paths: `company.name`, `company.description`, `policies.privacy_review`; build idle, no build error |
| Counted source cache | One existing source, `1118@1122`, status `done`, fact count 3, current reader identity, no source error |
| Original source body | Name, a short onboarding description and the privacy-review constraint; no detailed team/authority/process information |
| Company Architecture projection | The same three supported facts, with no ACL-withheld or budget-omitted facts |
| Demo source panel | Rendered the three supplied facts and explicit unknowns; it did not invent missing business context |

The three original values were:

- Name: **Synthetic Orbit**.
- Description: **Builds onboarding software for pilot operators.**
- Constraint: **Pilot access needs a deletion acceptance review; an engineering test pass alone is insufficient.**

The seeded source cache's model-related metadata is fixture data, not evidence that an extraction model executed in this round. Expanding the UI alone could not recover company details absent from the stored canonical fixture.

## Canonical enrichment and truthful review state

The new runtime option delegates to `apps/web/scripts/vantage-context-company-enrich.ts`. That script constructs explicit fictional source facts, then uses the **existing** `listCountedSources`, `assembleMetadata`, `diffMetadata` and `saveProfileLocked` path. The canonical update and new native source/ACL rows are written in the profile lock transaction; the model is not called to extract or synthesize this fixture.

Actual new records:

| Record | Identity and meaning |
| --- | --- |
| Fictional company reference | Native document **2141**, exact current version **2145**, title `Synthetic Orbit fictional company reference` |
| Counted source row | **305**, `about_us`, `done`, 13 declared facts, current reader identity, `synthetic-fixture/no-model` |
| Fictional review exercise | Native document **2142**, version **2146**, explicitly headed `FICTIONAL HUMAN-REVIEW FIXTURE — NOT REAL APPROVAL` |
| Existing source | Original document/cache **1118@1122 / source row 212** retained; identical company name keeps both original and new provenance |
| Actual recorded fixture time | `2026-10-26T18:59:31.225Z`; canonical build recorded at `2026-10-26T18:59:31.274Z`, without backdating |

Both new documents are restricted native documents with an explicit **view grant to the synthetic requesting actor**. Company-only membership is not substituted for document authorization. The existing Company Architecture host checks the current exact backing-document versions, actor scope and source rows even though the new reference is not an arbitrary RAG fetch.

The current descriptor's original retrieval catalog is retained. The new rich information is carried through the canonical company record; the separately selected old company document remains unchanged. The profile dependency scan still includes all original and new backing refs. No backing-document ACL or provenance check is removed to make the model request smaller.

The fictional review document contains fixture-only reviewer text, bound source/version identities and acknowledged unknowns. It records **no authenticated real human approval, signature, appointed reviewer, completed task or pilot-access decision**. Canonical `reviewState` remains **`unreviewed`**. It is a synthetic review-format example, not an approval workflow or human-confirmed fact source.

New source facts use `quoteMode=none`: exact native document/version and extraction timestamp are present, while `quote`, page and snippet fields are absent/null. The text contains the declared facts, but no quote is falsely described as having been captured by an extraction model. The existing original name quote is retained. Runtime provenance explicitly says `synthetic-fixture/no-model`; confidence values are fixture inputs, not measured model confidence.

## Actual 13-fact projection

`after-rich-seed.json` records this exact actor-authorized company source. Standalone complete JSON, including the original body and parsed exact projection, is [architecture-projection.rich.json](../../test-output/vantage-context-demo/company-architecture-rich-20261026/architecture-projection.rich.json); [sparse projection](../../test-output/vantage-context-demo/company-architecture-rich-20261026/architecture-projection.sparse.json) is preserved separately:

- Ref: `company:company-metadata/2037`.
- Version: `company-profile-v0:3b0272994e46f0ebe125d4139522bcd5696ba88e4df5244798ca96dba26a3f1b`.
- Content SHA-256: `7a164fab763a0e6dab423d4ce79d38b9611a81eb1652d8aca042ed2799f8471a`.
- Full projection: **4,551 UTF-8 bytes**, 13 facts, zero omissions.
- Every fact's basis: `source-extracted-unreviewed`; profile `reviewState=unreviewed`.

| Exact projected path | Actual value |
| --- | --- |
| `company.name` | Synthetic Orbit |
| `company.description` | Mission: safer pilot onboarding. Subscription SaaS for B2B teams; this profile does not approve a pilot. |
| `company.industry` | B2B SaaS / onboarding assurance. |
| `markets.primary.0` | Small SaaS operators onboarding business customers. |
| `services.0.name` | Orbit Pilot |
| `services.0.description` | An evidence workspace for onboarding and deletion checks. |
| `projects.0.name` | Deletion assurance pilot |
| `projects.0.status` | Active assurance workstream; delivery outcome/date unknown. |
| `profile.facts.responsibilities` | Engineering builds/tests deletion; Operations reconciles account samples; Privacy reviews acceptance evidence. Named staff are unknown. |
| `profile.facts.priorities` | Reconcile run-17 samples before proposing access; validate deletion evidence before scaling. |
| `profile.facts.decision_authority` | Privacy may record Go, No-Go or Needs More Evidence; Engineering and Operations supply evidence but cannot authorise pilot access. No person or actual decision is recorded. |
| `profile.facts.dependencies` | Process: Engineering results -> Operations comparison -> Privacy decision. Shared account IDs and reviewer assignment are dependencies; delivery outcome/date are unknown. |
| `policies.privacy_review` | Minimise personal data; require separate privacy approval before pilot access. Test passes and document edits are not approval. |

The projection retains `subject=Orbit Pilot` on its service description and `subject=Deletion assurance pilot` on project status. Its explicit structural unknown codes are **`personnel_unknown`** and **`hierarchy_unknown`**. Named staff, assigned privacy reviewer, actual decision, delivery outcome and delivery date also remain explicitly unknown in the values/source text. Populating a role-authority path does not appoint a person or approve current work.

After enrichment, the demo correctly withholds the old contextual report with “Saved context is unavailable or has changed. A fresh authorized generation is required.” That is the stale-source guard working; the saved history has not been deleted.

## Preserved native Vantage state

The preservation boundary is **`before-enrichment-after-a.json` → `after-rich-seed.json`**. The valid sparse A had already been saved before the first audit in that pair. All seven core-table counts and complete-row hashes match across the enrichment:

| Table | Count | Identical SHA-256 before/after enrichment |
| --- | ---: | --- |
| `vantage_agendas` | 2 | `6d16b117d4beef4c978c82c7491f233b33eb8e91aa526b97dbc3152f28aa6bb6` |
| `vantage_agenda_topics` | 4 | `3c742fe8f6f6ffb53b6e2f1a6fa2128cddd978cc495b28f85d21f0f4e9158106` |
| `vantage_commitments` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `vantage_contract_state` | 2 | `a13101c81bdea3ac21d6e9d76d729a36613ef5bbb321b41592f5ea2ca2d9d721` |
| `vantage_evidence` | 3 | `638b41884c0410bb4db761f33e39275e79bd7c311eed96bbe8a78e77a3c6ab1e` |
| `vantage_metric_definitions` | 4 | `2f4d86bc598f86314b2a3b256e799a20209dedab8764017a9710293b37eb4004` |
| `vantage_metric_observations` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |

These hashes prove the enrichment phase did not alter those rows. They do not claim a later explicitly requested model save leaves its agenda metadata unchanged. New company source/version/ACL/cache/audit rows and the canonical profile update are the intended writes.

The script's second actual invocation returned **`verified-idempotent-no-write`**. It checks its preserved journal, exact enriched source version/body and canonical metadata hash. A missing or changed source/journal fails rather than silently recreating or overwriting an ambiguous prior enrichment.

## Demo source-panel changes

The Company Architecture panel now shows every projected fact, its supplied subject and its actual basis. Repeated generic labels such as “Responsibilities” therefore remain attributable to Engineering, Operations or Privacy when a subject is supplied. Missing basis is not inferred from profile-level review state.

Three exact-path display labels are demo-only:

| Captured path / label | Display label |
| --- | --- |
| `markets.primary.N`, raw label `0` for the actual first item | Target customers |
| `services.N.name`, raw label Name | Product or service |
| `projects.N.name`, raw label Name | Project |

Values, subjects, basis, original labels, source JSON and the production adapter are unchanged by this presentation layer. The raw exact content and provenance remain expandable. Actual browser captures of the complete 13-field panel are `rich-architecture-top.png` and `rich-architecture-details.png`.

## Bounded model transport

The full rich projection is below the existing per-company source ceiling, but the compound model envelope was the binding limit. The first rich preflight measured **23,961 prepared bytes** and correctly refused provider execution. It did not discard company facts to obtain a successful result.

Experimental prompt `vantage/sophia-paired-context/v0.4` now uses a lossless company transport form:

- Exact repeated source provenance is interned into `sourceProvenance`, referenced by `sourceIndexes`.
- Common per-fact basis and source-index lists can be represented once as `factDefaults`; individual exceptions remain explicit.
- Every fact, label, path, value, subject, unknown code, review state, distinct quote, document version and extraction timestamp remains recoverable.
- Unknown input formats stay verbatim. Tiny payloads are not expanded merely to apply the encoding.
- The transmitted source wrapper omits the duplicate object-form ref and hash when the exact surrounding string ref already identifies the frozen source. The full original registry, evidence snapshot, content hashes, excerpts and freshness/grounding guards remain unchanged.

The model is told how to read `company-provenance-interned/v1` and its defaults. This is an **opt-in experimental encoding change**, not a new canonical profile schema or relaxed provenance rule. The source panel continues to show the original full company projection.

Final default-service rich preflight measured **23,131 bytes**, below the unchanged **23,500** cap, with `providerCalled=false` and `persisted=false`. The 2,400 combined output-token limit, two-attempt limit and model-time budgets are unchanged. The existing approved Azure deployment and explicit demo-only reasoning effort `none` are retained. Passing preflight is not live-model success.

## Sparse A and matched-control limitation

### Valid sparse A

`sparse-v04-live-a.json` is the actual valid browser/API result before enrichment:

- HTTP **201**, wall time **14,282 ms**, saved sidecar revision **7**.
- One actual model attempt, generation duration **13,330 ms**.
- Deployment `gpt-6-luna`, reasoning effort `none`, experimental prompt `vantage/sophia-paired-context/v0.4`.
- Prepared prompt **22,195 bytes**.
- This run preceded the final `factDefaults` compact-encoding update.

Actual Weekly Summary:

> For synthetic run-17, QA reports 3/3 sample accounts deleted, while operations reports 2/3 fully deleted and one record remaining; operations notes the account lists may differ. A human privacy review record says the go/no-go question should remain until a named reviewer compares the samples and records approval, and states that the document contains no approval record. The samples have not been reconciled in the supplied evidence, so a deletion-acceptance conclusion remains uncertain. A useful focus is to compare the account-level results and clarify what evidence the reviewer needs before deciding.

Its topics were **“Reconcile run-17 samples for the deletion go/no-go review”** and **“Clarify evidence needed for deletion acceptance.”** The second topic actually cited the thin canonical company record and its original company document. It correctly said that record was unreviewed and listed responsibilities and decision authority as unknown. Therefore merely obtaining a company citation in B will not establish an improvement over this A.

Both topics were grounded in the same QA/Operations sample uncertainty and human review record, and their comparison/reviewer-criteria steps overlapped. No completion or actual privacy approval was established. The complete accepted report, exact citations, questions and proposed steps are preserved in the raw A output.

### Final-encoder sparse control: failed, not saved

A read-only captured sparse envelope was then evaluated with the final encoder. The attempt directory is:

`../runtime/generation-attempts/20261026T190628152Z-fad6250d-0d43-4e9e-88cc-721e5fe1120b/`

Both actual provider responses were HTTP 200 with `finish_reason=stop`, but:

1. Response 1 parsed as JSON while its native report omitted the required `enhancements` field.
2. Response 2 was invalid JSON.

The generator ended in `invalid-output` Rules fallback; the contextual wrapper refused to accept it. **No report was saved.** Raw responses and the Rules diagnostic remain separately preserved. The two failed responses consumed 5,899 + 6,259 = **12,158 tokens**; they are not hidden by counting only successful responses.

Consequently the planned valid sparse-A versus rich-B comparison has an explicit **formatting/encoding and stochastic confound**. A and B share the declared v0.4 label, but A predates the final default-factoring bytes. The only sparse run with the final encoding failed, so there is no validated exact-encoder A control. Do not substitute its Rules output for LLM output or claim a controlled benchmark.

## Actual rich B and qualitative comparison

The QA 3/3 account, Operations 2/3 plus remaining record, possible sample mismatch, human review record, existing native input and model budgets remain the factual anchors. Rich company context should help distinguish **who supplies which evidence** and **which role evaluates acceptance**, without inventing appointed people or outcomes.

Review the actual B prose manually against these criteria:

1. Engineering supplies deletion execution/test evidence; Operations reconciles account/sample scope; Privacy evaluates acceptance evidence and may record Go, No-Go or Needs More Evidence. Their roles are not interchangeable.
2. A role-authority statement is attributed to the unreviewed architecture. It does not become an approved current policy, a real named assignee or an existing Commitment. The experimental schema still requires owner/due/help fields to be null.
3. Sample overlap must be established before treating QA and Operations as a same-account conflict. Matched accounts alone must not erase an unmatched residual record.
4. No fictional review, test pass, document edit, missed feedback or historical date establishes pilot approval, completion or automatic pending-question closure.
5. The report should acknowledge the actually supplied `reviewState=unreviewed`, role/responsibility facts and remaining personnel/hierarchy unknowns. It must not repeat the older erroneous claim that these fields were absent.
6. Recommendations should be concrete and differentiated, not two copies of “compare the account lists.” More valid JSON topics or registered refs alone are not a quality gain.

`rich-v04-live-b.json` is the actual accepted browser/API result after a cold server restart: **HTTP 201**, **13,801 ms** wall time, saved revision **8**, and one successful AI attempt lasting **12,990 ms**, without fallback. The provider identifies the existing `gpt-6-luna` deployment, snapshot `2026-09-22`, with explicitly configured demo-only reasoning effort `none`. This is real provider output, not a Rules test double. Its prepared prompt is **23,131 bytes**.

Actual B Weekly Summary:

> Run-17 QA reports deletion for all 3 sampled accounts, while the independent operations audit reports 2 of 3 fully deleted and one record remaining; the audit says the account list may differ, and no shared sample was reconciled. A human privacy review record says the go/no-go question is to remain until a named reviewer compares the samples and records approval, but it contains no approval. This makes sample reconciliation the most concrete focus: determine whether both checks cover the same accounts and what evidence explains the remaining record before considering another targeted check. The company profile is explicitly unreviewed, so its process claims are context rather than verified current events.

The cited human-review document is itself part of this synthetic fixture; it is not evidence of a real employee's approval. The later fictional companion review document `2142@2146` is not among B's selected excerpts or topic citations.

| Topic | Actual supporting sources | Grounding and usefulness |
| --- | --- | --- |
| **Reconcile run-17 samples before a privacy go/no-go** | QA `doc:workspace-document/1120@1124`; Operations `1122@1126`; synthetic human-review record `1119@1123` | Facts preserve 3/3 versus 2/3, the remaining record and possible account-list mismatch. Its question asks whether acceptance discussion should wait for a named reviewer's account-level comparison. Its proposed check compares account lists/deletion evidence, explicitly focuses on the reported residual record and suggests a targeted repeat only if overlapping accounts differ. This is measurable and avoids comparing unmatched samples as a trend. |
| **Keep pilot-access constraints distinct from test results** | Exact enriched `company:company-metadata/2037@company-profile-v0:3b0272994e46f0ebe125d4139522bcd5696ba88e4df5244798ca96dba26a3f1b`; original document `1118@1122` | The company fact explicitly says “marked unreviewed”, separate privacy approval, no actual person/decision, and no approval inferred from tests or edits. The question asks whether a separate current recorded privacy decision exists; the check seeks that record and keeps status unknown if none is supplied. Its rationale correctly says this does not establish that access is currently planned or that approval is absent. |

The strongest B company-grounding example is its actual fact:

> The exact company profile excerpt is marked unreviewed. It states that separate privacy approval is required before pilot access and that test passes and document edits are not approval; it records no person or actual decision.

That fact cites the exact new company source version above, whose hash matches `after-rich-seed.json`. The new canonical company context was therefore **used**, not merely transmitted. B does not invent named staff, approved access, work execution, completion or automatic pending-question closure. Its unknowns distinguish “approved, declined, or awaiting a decision” and whether the unreviewed constraint reflects reviewed current policy.

There are still concrete limitations:

- B's summary says **“no shared sample was reconciled”**, while Operations' exact text says **“No reconciled shared sample was supplied.”** The topic fact and rationale use the narrower evidence boundary correctly. The summary slightly overstates what missing supplied evidence establishes about events outside the inputs.
- B does **not** explicitly assign the comparison to Operations or distinguish Engineering's testing responsibility from Operations' reconciliation responsibility. It also does not enumerate all three fictional Go/No-Go/Needs More Evidence outcomes in its recommendation. More company fields did not automatically produce better functional ownership guidance.
- `proposedOwner`, `proposedDue` and `helpRequested` are null because the experimental schema requires it. Their absence cannot be credited as good owner selection, nor does a role mention create an assignee or Commitment.
- Both A and B have two topics. B separates sample reconciliation from recording authorization more clearly, but the reviewer/approval checks still overlap. Sparse A already cited its canonical company record and distinguished test passes from approval. The demonstrated gain is richer, accurately bounded company context, not an established large reasoning improvement.
- The enriched mission, market, service and project fields are visible and available, but B does not substantively use them. No unsupported business-priority conclusion is invented from them.

Captured sparse A and rich B have equal **native inputVersion**, equal `v1Input.data`, equal role IDs and byte-identical full document snapshot entries, including versions, excerpts and content hashes. The canonical company profile and experimental transport encoding changed. The failed exact-encoder sparse control described above prevents attributing prose differences to the richer facts alone.

| Actual accepted run | Provider attempts | Model duration / HTTP wall time | Input / output / total tokens | Reasoning tokens |
| --- | ---: | --- | --- | ---: |
| Sparse A, prior v0.4 encoder | 1 | 13,330 / 14,282 ms | 4,712 / 1,696 / **6,408** | 0 |
| Rich B, final v0.4 encoder | 1 | 12,990 / 13,801 ms | 4,782 / 1,678 / **6,460** | 0 |

These two successful samples do not establish latency or cost distributions. The two failed matched-control responses additionally consumed 12,158 tokens. All accepted and failed provider responses are preserved separately; failed structural validation was not counted as a successful contextual report.

## Reproduction and verified checks

Use the existing local demo prerequisites from [the frontend MVP runbook](vantage-integrated-frontend-mvp-2026-10-26.md), including the dedicated owned database, actor, ignored credential files and approved process-only model configuration. From this isolated checkout:

```powershell
node scripts/dev/vantage-context-demo-runtime.mjs --status
node scripts/dev/vantage-context-demo-runtime.mjs --enrich-company
node scripts/dev/vantage-context-demo-runtime.mjs --serve
```

The application is already running at **http://localhost:3104/dev/vantage-context**. For a restart after stopping this demo's server, the existing ignored, approved local bridge loads only the chat endpoint/key into the dedicated launcher's process environment:

```powershell
Set-Location 'C:\Users\junku\orca\LaunchStack\test-output\vantage-frontend-mvp\20261026161746Z\source'
$env:Path="$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
docker start launchstack-vantage-week2-tl-20261022-db
node test-output/vantage-context-demo/launch-live.cjs
```

This reuses `127.0.0.1:55437/vantage_week2_tl_contract_v1`, its owned existing volume and saved synthetic account. It does not use any root `.env` database setting or `pdr_ai_v2`. No reseed or migration is needed. The local sign-in account and password can be retrieved privately from `test-output/vantage-context-demo/runtime/credentials.json`; do not paste that file into shared logs.

`--enrich-company` is an explicitly requested synthetic **database write** on its first successful run. It does not call a model, reseed reports or reset a database. Repeating an intact completed enrichment verifies its proof and performs no writes. It refuses wrong targets, ambiguous prior state, non-owned companies, timestamps beyond the configured cutoff and changed canonical/source content.

Sign in normally at `http://localhost:3104/dev/vantage-context`. Inspect Company Architecture before generation, confirm all 13 values and unknowns, then use **Generate with context** only when another approved provider request is intended. Failed preflight/model output retains saved records; it is not accepted as a successful AI report.

| Verification | Observed status |
| --- | --- |
| Source-panel UI tests | **19/19 passed**, including same-label subjects, actual unreviewed basis, exact-path market/service/project labels and unmodified raw JSON |
| Fictional company builder | **8/8 passed** |
| Experimental generator / lossless company transport selection | **26/26 passed** |
| Final focused pipelines regression | **131/131 passed**: 7 transport, 19 experimental generator, 51 Company Architecture, 8 Contract v1, 35 rolling questions, 11 grounding |
| Final focused web regression | **43/43 passed**: 16 real PostgreSQL Company Architecture, 19 source-panel UI, 8 fictional builder |
| Runtime helper | **5/5 passed** |
| Native database/API inspection | Three sparse facts before, 13 after, zero projection omissions, exact versions/hashes as recorded above |
| Enrichment preservation | Seven native Vantage core-table hashes/counts identical across enrichment |
| Actual repeat enrichment | `verified-idempotent-no-write` |
| Full-panel browser display | All 13 fields inspected; top/details screenshots preserved |
| Rich final prompt preflight | Ready, 23,131/23,500 bytes; no provider invocation or save |
| Final-encoder sparse live control | **Failed**, two provider responses, no contextual save |
| Rich live B | **Passed**, actual HTTP 201, AI, one attempt, exact rich company citation, saved revision 8; semantic limits documented above |
| Final full web typecheck | **Passed**, `tsc --noEmit` |
| Scoped ESLint | **Passed**, zero warnings/errors through `pnpm --filter @launchstack/web exec eslint`; direct root invocation initially could not resolve its installed React Hooks plugin |
| Runtime syntax and diff whitespace | **Passed**, `node --check` and `git diff --check` |
| Post-generation preservation | **Passed**: original human-reviewed revision 4 and sparse revisions 6/7 are exactly retained in encrypted history; active rich revision 8; six non-agenda table hashes unchanged |
| Original checkout/worktrees | **Passed** at 19:19 UTC: original 17/17 dirty-file hashes unchanged, stable integration clean; owned demo processes had 55437 connections and zero 5433 connections |

Useful focused commands, with no provider calls:

```powershell
pnpm --filter @launchstack/web test --runInBand --runTestsByPath __tests__/components/vantage-context-demo.test.tsx __tests__/server/orbit-company-fixture.test.ts
pnpm --filter @launchstack/pipelines exec vitest run src/vantage/experiments/sophia-generation-v0.test.ts src/vantage/experiments/company-transport-v0.test.ts
```

### Files changed in this round

- `apps/web/src/server/vantage/experiments/orbit-company-fixture.ts`: pure 13-fact fictional source/cache and explicitly fictional review record.
- `apps/web/scripts/vantage-context-company-enrich.ts`: idempotent, owned canonical assembly and ACL-bound native source creation.
- `scripts/dev/vantage-context-demo-runtime.mjs`: explicit `--enrich-company` entry point.
- `apps/web/src/app/employer/tools/vantage/_components/ContextSourceDialog.tsx`: subject/basis and exact-path display labels; no canonical data mutation.
- `apps/web/__tests__/components/vantage-context-demo.test.tsx`: display/provenance regressions.
- `apps/web/__tests__/server/orbit-company-fixture.test.ts`: builder/provenance/fictional-review/budget/timestamp checks.
- `pipelines/src/vantage/experiments/company-transport-v0.ts` and `.test.ts`: lossless provenance/default interning and round-trip checks.
- `pipelines/src/vantage/experiments/sophia-generation-v0.ts` and `.test.ts`: opt-in v0.4 transport assembly and unchanged guard/budget checks.
- This runbook, including actual provider failures and limitations.

### Raw artifacts

- `before-sparse.json`: actual initial canonical/cache/API diagnosis.
- `sparse-v04-live-a.json`: accepted saved sparse A with complete report.
- `before-enrichment-after-a.json`, `after-rich-seed.json`: paired enrichment preservation and exact projection proof.
- `rich-v04-preflight.json`: refused 23,961-byte rich envelope.
- `rich-v04-preflight-final.json`: accepted no-provider 23,131-byte preflight.
- `rich-v04-live-b.json`: complete accepted rich B report and saved diagnostics.
- `architecture-projection.rich.json`, `architecture-projection.sparse.json`: exact standalone actor-authorized projections.
- `rich-architecture-top.png`, `rich-architecture-details.png`, `rich-generated-report.png`: actual full-panel and generated-report UI inspection.
- `rich-company-topic-and-pending.png`, `rich-exact-company-citation.png`: actual rich company-grounded topic, surviving pending question and opened exact-version citation.
- `focused-final.json`, `focused-final.log`: 131 pipelines / 43 web focused acceptance commands and output.
- `../runtime/company-rich-v1.json`: exact enriched source/version, fictional companion review, field map and no-model proof; contains no sign-in password.
- Sparse A actual provider captures: `../runtime/generation-attempts/20261026T185642864Z-fad6250d-0d43-4e9e-88cc-721e5fe1120b/`.
- Failed matched sparse control: `../runtime/generation-attempts/20261026T190628152Z-fad6250d-0d43-4e9e-88cc-721e5fe1120b/`.
- Rich B actual provider captures: `../runtime/generation-attempts/20261026T191242434Z-e816d41e-640a-4908-9626-83de34d6b961/`.
- `after-rich-generation.json`, `final-history-and-controls.json`: read-only final database/API and exact prior-report/human-review preservation evidence. Agenda hash changes only from the expressly requested saved generation; all other native table hashes match.
