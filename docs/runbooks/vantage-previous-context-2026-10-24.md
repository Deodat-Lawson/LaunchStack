# Previous Vantage Context with Skeptical Revalidation — 2026-10-24

Implemented on `feat/vantage-previous-context` in an independent local checkout, based on `Junkun/vantage-week2-rebuild` at **`364a3c8bd3b1c5bb2ee45cf66c1ea608b3c44618`**. The original dirty checkout and its worktrees remain separate. No push, main merge, new persistence table, task tracker, or V0 interface change is part of this feature.

Each generation now reads the exact previous week's saved report as bounded, explicitly untrusted history. Historical topics help find relevant **current authorized Vantage evidence** and frame a fresh question. They do not become new evidence, action commands, or presumed current facts. The saved previous report and linked actions are not rewritten by new-week generation.

The final synthetic live run produced **11 genuine AI reports, one deliberate empty Rules result, and no fallback** across the 12 scenarios. All nonempty cases used one provider attempt. This is observed model behavior on the supplied fixtures, not a general guarantee of semantic correctness.

## Existing persistence and the narrow amendment

[schema.ts](../../pipelines/src/vantage/schema.ts) already defines `vantageAgendas` with `vantage_agendas_company_week_unique(companyId, weekStart)`. A new reporting week therefore has its own report row. [loadOverviewV1](../../apps/web/src/server/vantage/service-v1.ts) already returns `previousAgenda`; no new overview field or frontend workflow was needed.

The only generation-input amendment is the optional internal field:

```ts
interface GenerationInput {
  // Existing v1 fields remain unchanged.
  previousVantageContext?: PreviousVantageContext | null;
}
```

`GenerationResult`, public report/overview DTOs, and the existing human-review flow retain their shapes. Existing three-argument snapshot callers remain valid and receive no actor-bound historical context. The authorized generation service passes `{ actorId: args.userId }` explicitly.

The interface is defined in [previous-context-v1.ts](../../pipelines/src/vantage/previous-context-v1.ts) and re-exported by [contract-v1.ts](../../pipelines/src/vantage/contract-v1.ts):

```ts
interface PreviousVantageContext {
  contractVersion: "previous-vantage/v1";
  trust: "untrusted-history";
  reportId: string;
  weekStart: string;
  generatedAt: string | null;
  reportVersion: number;
  snapshotVersion: string;
  summary: string | null;
  topics: PreviousVantageTopic[];
  unavailableSources: PreviousVantageSource[];
  omissions: { topics: number; refs: number; summary: boolean };
  documentVerification: "unavailable";
}
```

Each topic contains its ID/version/origin/review status, bounded title, old fact-like `historicalClaims`, interpretation, question, suggested step/due date, explicit `recordedDecision`, `reportedActions`, and original source refs with availability classifications. These are separate fields so the model does not receive an undifferentiated narrative.

## Authority and trust

| Field                                                                   | What it establishes                                                                            | What it does not establish                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Prior summary, claims, interpretation, question, proposed step/deadline | What an earlier report said or suggested                                                       | Current truth, causality, task necessity, success, failure, or authorization to execute         |
| Topic origin/status                                                     | Who initially generated the topic and its saved review status                                  | Keeping an AI topic does not turn its prose into evidence or create a recorded decision         |
| `recordedDecision`                                                      | A human choice was explicitly recorded, with its saved timestamp                               | That the planned work happened or that the decision's factual premises remain true              |
| `reportedActions`                                                       | **Current as-of canonical database state** of actions linked to the old report                 | An independent verification of real-world completion or a frozen snapshot of last week's status |
| `reportedActions[].stateVersion`                                        | Fingerprint of the full relevant current action DTO before clipping                            | A new status, new commitment, or an inferred outcome                                            |
| `originalRefs`                                                          | Historical provenance and whether a canonical source is presently usable at the cutoff         | Additional current citation eligibility or semantic support for old prose                       |
| Current selected evidence/observations/commitments                      | Authorized, period-bounded source accounts and recorded states that may support current claims | Infallibility; a source ID alone still does not prove entailment                                |

In particular, `reportedActions` are read from existing action rows at generation time and filtered against `asOf`. They are linked to an old report, but are not reconstructed from that report's AI text. An open application record and a note reporting successful checks can legitimately disagree. The report can ask whether they should be reconciled; it cannot mark the action done.

## Reading, bounds, and freshness

[repository-v1.ts](../../pipelines/src/vantage/repository-v1.ts) adds `previousVantageSnapshot` to the existing generation snapshot:

1. Select the company's saved report at exactly `calendarAdd(currentWeekStart, -7)`. Do not substitute the current draft or a more distant report if that week is absent.
2. Read that report's topics, state/version ledger, and linked canonical actions. Resolve only its bounded historical `ev:`, `obs:`, and `cm:` source references within the same company.
3. Classify missing/foreign/unsupported, after-cutoff, and document-unverifiable sources explicitly. An observation also needs a known metric definition.
4. Withhold a topic when its sources cannot be safely used, or relevant topic/action timestamps are later than the cutoff. Withhold the global summary when omitted or unavailable content could otherwise leak through it.
5. Build a deterministic bounded context. No URL, document, vector store, research tool, or model is called by this reader.

Report creation/generation/update timestamps, topic/decision timestamps, action timestamps, evidence observation dates, and observation coverage are checked where available. This is a current read constrained by the reporting cutoff, not a historical database time-travel facility; if a relevant saved object was changed after that cutoff, its old revision is not invented.

| Budget                             | Limit                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Serialized previous context        | **4,096 UTF-8 bytes**                                                                                                                       |
| Historical topics                  | At most **6**, deterministic position/ID order                                                                                              |
| Original refs                      | At most **8 per topic**; unavailable-source list at most **8**                                                                              |
| Linked actions in topic projection | At most **2**                                                                                                                               |
| Historical text                    | Summary 600; title 120; up to two old claims ×160; interpretation 160; question 140; suggested step 180; recorded decision 180 string units |
| Current evidence pack              | Existing maximum 40 refs / 14,000 selected-item bytes                                                                                       |
| Human-message payload              | At most 18,000 bytes                                                                                                                        |
| Schema + system + human content    | At most **23,500 bytes**, leaving 500 bytes below the existing 24 KB shared transport guard for repair/message shaping                      |
| Model runtime                      | Unchanged: 2,400 output tokens; 20 s per attempt; at most two attempts; 1 s transient retry wait; 45 s total                                |

History is trimmed before current evidence when they compete for the prompt envelope. Omission counters are retained; an omitted historical issue is not classified as completed or irrelevant.

The generation fingerprint includes the historical context, the full relevant prior-report state fingerprint, and actor identity. The latter hashes the raw report, **all prior topic rows including omitted topics**, linked action rows, state ledger, and the historical source/definition rows actually consulted. Thus clipping an old decision or excluding a seventh topic does not make edits to that report invisible. Action-state fingerprints similarly compare full fields rather than clipped display text. BigInt/Date values are canonicalized safely.

Before persistence, `saveGeneration` binds the snapshot actor to the saving actor and rereads the same snapshot under the existing transaction lock. Changes to report/source/decision state produce `409 stale_context`; current-report changes produce the existing `stale_agenda` protection. A previously missing prior report appearing during generation also invalidates the snapshot. Generation occurs outside the short write transaction.

## Current-evidence revalidation and generation

[revalidate-previous-v1.ts](../../pipelines/src/vantage/revalidate-previous-v1.ts) supplies guarded history access and conservative association helpers. It rejects wrong-week/future history, treats shared refs or at least two non-generic issue words as **clues**, and compares linked action state without mistaking text truncation for a change.

[evidence-v1.ts](../../pipelines/src/vantage/evidence-v1.ts) searches the already supplied authorized current evidence for those clues. Related current text gets rank 2.5, below conflicts/notable metric changes and commitments, ahead of ordinary text at rank 3. This is a bounded deterministic search over supplied Vantage rows, not semantic proof, a new retrieval agent, or workspace-document access. Metric signal computation and current citation selection remain independent of historical conclusions.

[generation-v1.ts](../../pipelines/src/vantage/generation-v1.ts) sends history in a separate `previousVantageContext` JSON section. Prompt **`vantage-agenda/contract-v1.5-history.1`** explicitly requires current-source revalidation, distinguishes recorded decisions from execution, forbids completion inference from silence/document edits, reassesses deadlines, and permits omitting historical issues. Historical topic IDs are not valid enhancement targets; only the current generation's protected `reviewedTopics` can receive enhancements.

History never enters `canonicalRefs`, current `WeeklySignals`, or the current evidence pack. A prior ref can be cited for a current claim only if its underlying canonical item independently qualifies and was actually selected for the current invocation. Old report IDs are not evidence refs. The existing schema/ref validator and reviewed-topic protections remain in force, with no second default model call.

[rules-v1.ts](../../pipelines/src/vantage/rules-v1.ts) only revisits independently generated current candidates:

- It does not iterate history to recreate topics/actions.
- A related current account is quoted as a **current source report**. Its question asks whether it resolves, contradicts, or leaves open the historical issue.
- Revisited candidates have an empty proposed work step, null owner/due, and explicit uncertainty about recorded state. This conservative fallback does not try to infer completion with keyword matching.
- An unchanged carry-forward action alone is not fresh progress evidence and does not renew an old recommendation. A changed canonical state/outcome can be independently relevant.
- With history but no current evidence, the result stays empty/Rules with no model call and acknowledges that progress cannot be determined.
- Existing same-week reviewed topics remain protected separately. History is not converted into current reviewed content or an enhancement target.

Only the existing explicit human decision/action APIs can create or resolve commitments. A newly generated proposal remains a proposal.

## Document-change audit: verification remains unavailable

The existing Founder Weekly Review machinery is useful but cannot safely be reused as an actor-authorized Vantage document reader without another integration seam:

- [document-change.ts](../../pipelines/src/founder-weekly-review/document-change.ts) has pure version-pair selection, bounded excerpts, and chunk alignment. It assumes that input versions/chunks have already been authorized; it does not resolve the requesting actor.
- [evidence-service.ts](../../pipelines/src/founder-weekly-review/evidence-service.ts) collects document changes through company/period-scoped store interfaces. An actor attached to founder-context input is not a document ACL grant for those stores.
- [document-version-chunks.ts](../../apps/web/src/server/founder-weekly-review/document-version-chunks.ts), `FounderWeeklyReviewDocumentVersionStore.listVersionsForReportingPeriod/getDocumentChunksForVersions`, checks company/document/version ownership. Its signature does not accept the Vantage requester's document scope.
- [workspace-document-store.ts](../../apps/web/src/server/founder-weekly-review/workspace-document-store.ts), `StrictCurrentWorkspaceDocumentStore`, has bounded current-version vector retrieval but filters by company/current version rather than the requesting actor's document ACL.
- Actor-level filtering exists in [authz/scope.ts](../../apps/web/src/lib/authz/scope.ts), `resolveDocumentScope/scopedDocumentWhere`, and is used by [workspace/document-access.ts](../../apps/web/src/server/workspace/document-access.ts), `loadVisibleDocument`, through `WorkspaceContext.documentScope()`. There is no existing pure actor-bound version/chunk adapter connecting that permission boundary to this generation path.

No company-only content reader was promoted into an actor-level authorization path. No new unrestricted document fetch or duplicate retrieval system was added. Historical document-backed material is withheld with `document-verification-unavailable`; current Vantage rows of kind `document` are explicitly labeled as **submitted accounts, not verified workspace reads**. Document changes, filenames, version IDs, and timestamps never prove completion.

The document scenarios below therefore test truthful **unavailability**, not a claimed successful workspace-document verification. Joseph/Sophia's unfinished production modules are not dependencies.

## Actual two-week report review

The fixture period is October 19–24, 2026 in America/New_York, with `asOf=2026-10-24T14:00:00Z`; historical report week is October 12. All data is synthetic. [Fixtures](../../fixtures/vantage-previous-context/two-week.json) contain separate expectations, not model outputs.

The Rules and live artifacts were read manually against every scenario's current input and historical candidate. All live topic facts cite current selected refs; none use the old AI report as current evidence. No final output targets a historical topic as an enhancement, copies the old five-check-plus-implementation recommendation verbatim, marks an action done automatically, or claims a workspace document was verified.

| Scenario                                        | Actual Rules result                                                                                                    | Actual final live result and grounding judgment                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Completion indicated                         | Quotes five passing checks, shows current recorded-open action beside it; asks a fresh clarification with no work step | One topic reconciles the October 21 result with the five-check commitment; cites current note **and current `cm:` record**. Says more testing may be unnecessary, but does not mark done.               |
| 2. No new progress evidence                     | Empty; progress unknown; no renewed suggestion                                                                         | Same empty Rules response, zero provider attempts. Silence establishes neither failure nor completion.                                                                                                  |
| 3. Prior AI contradicted                        | Quotes successful export and asks whether the old issue is resolved/contradicted                                       | One notification-specific topic corrects “export unavailable,” distinguishes successful export from absent notification, and proposes a narrow check of recurrence. It does not implement export again. |
| 4. Expired recommendation, no current relevance | Keeps only the current 12-account cohort source; omits old pitch                                                       | Only cohort-definition/outcome questions. No renewed October 15 pitch task or assumed failure.                                                                                                          |
| 5. Expired target, important current blocker    | Keeps current reconciliation blocker, no copied old due date                                                           | Distinguishes export failure from inability to verify it; cites current blocker and October 30 reconciliation need. Suggested due is October 30, not expired October 15.                                |
| 6. Changed document, potentially relevant issue | Uses submitted account and explicitly unavailable document verification                                                | Says the update supplies no excerpt/completion evidence; asks a small behavior check. Cites only the current submission and states workspace verification is unavailable.                               |
| 7. Document edit does not prove completion      | Preserves title/date-edit account and completion uncertainty                                                           | Explicitly separates rename/date correction from implementation/acceptance. Does not declare done; proposes observing actual export behavior.                                                           |
| 8. No human decision                            | Historical decision/actions absent; no invented decision                                                               | A visibility learning question, with “whether any implementation or follow-up occurred outside this observation” left unknown. No alleged recorded decision.                                            |
| 9. Same-week regeneration                       | Assembler removes self-history; ordinary current-source output                                                         | Only the 12-account cohort is discussed. Self-feedback sentinel/old invoice premise is absent.                                                                                                          |
| 10. Missing/revoked/unauthorized history        | Derived topic/summary masked; unrelated current cohort retained                                                        | Current cohort only, no private-history sentinel or invented verification. Unavailable historical ref remains metadata, not a factual citation.                                                         |
| 11. No previous report                          | Ordinary source-grounded generation                                                                                    | A confirmation-understanding check from the current observation, without a historical premise.                                                                                                          |
| 12. History changes during generation           | Sparse current result yields clarification, no old task                                                                | Asks what the current check actually observed; no invented outcome. **Race rejection is demonstrated separately by real PostgreSQL tests**, not by this model response.                                 |

Zero new topics is permissible. Fresh suggested checks in live outputs are human-review proposals, not automatically created actions. Rules is intentionally more conservative than the model and asks a clarification instead of classifying task state.

### Example A — indicated completion is not a recorded resolution

Before: historical AI suggested **“Run five invoice export confirmation tests and implement a new notification.”** The recorded human decision was to verify confirmation before deciding whether to change it.

Current input: **“all five synthetic invoice export confirmation checks passed after the fix”**, but the independently supplied current action record remains `open`, with no outcome/resolution.

Actual live question:

> Does the October 21 result satisfy the commitment’s five-check test, or is any further verification needed?

Actual step:

> Compare the October 21 result with the commitment’s specified five recorded checks; identify any mismatch or missing verification before deciding whether more testing is warranted.

Refs: `ev:ev-current-completion-indicated` and `cm:cm-synthetic-invoice`. This adds a reconciliation decision instead of repeating implementation. “Synthetic founder” is allowed as proposed owner because the **current** supplied commitment explicitly names that owner. No status was changed.

### Example B — correct the historical interpretation

Before: **“The previous AI concluded that invoice export was unavailable.”**

Current input says the tester successfully exported an invoice; only confirmation was absent.

Actual live summary:

> This corrects the earlier interpretation that invoice export was unavailable; the current observation points specifically to an unanswered notification question.

The generated step checks separately whether export succeeds and confirmation appears, considering a notification experiment only if those outcomes differ. Ref: `ev:ev-current-prior-ai-contradicted`. This is a current-source reinterpretation, not a claim that every prior issue has been resolved.

### Example C — expired dates need context

With only a current signup-cohort note, the expired pitch recommendation disappears entirely. The report asks what the 12-account snapshot measures; it does not infer that the pitch failed.

When a current source instead says confirmation still blocks the **October 30** reconciliation, the live question is:

> Is the issue that an invoice export did not occur, or that the reviewer cannot verify that it occurred?

The next step asks the reviewer what prevents confirmation and checks verifiability before October 30. Ref: `ev:ev-current-expired-still-important`. The old October 15 target is historical context, not a new deadline or an automatic missed-status update.

### Example D — editing a document is not completing work

Current input records a title rename/date-label correction and explicitly says no implementation result or acceptance test was added.

Actual live interpretation:

> The document edit may make the note clearer, but it does not establish whether invoice export confirmation works.

The topic also states **“Workspace document verification is unavailable”** and suggests observing whether/when/where confirmation appears, then defining a specific acceptance test if needed. Ref: `ev:ev-current-document-change-not-completion`. It cites a current submitted account, not an unseen workspace document.

## Test evidence and reproducibility

The final focused run passed **120/120** across generation, Contract v1, historical assembly, revalidation, and two-week semantic tests, including the three final reviewer regression cases. Commands and observed results are recorded in [verification.json](../../test-output/vantage-previous-context-2026-10-24/verification.json). Do not add overlapping suite counts together as independent coverage.

| Check                                        | Observed result                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Existing generation + Contract v1 regression | 59 passed (51 generation, 8 contract)                                                                     |
| Focused generation/history run               | 120 passed, including the three final reviewer cases                                                      |
| Shared structured-transport tests            | 5 passed                                                                                                  |
| Real PostgreSQL pipeline suite               | 67 passed, including 36 repository integration cases                                                      |
| Web/auth/API suite                           | 203 passed, including 21 real-database route/auth cases; session/generation doubles remain labeled        |
| V0 compatibility regression                  | 48 passed; no V0 source changes                                                                           |
| Synthetic launcher safety                    | 4 passed                                                                                                  |
| Pipelines + web typechecks                   | Passed                                                                                                    |
| Final two-week Rules harness                 | 12/12, actual Rules reports and boundary validation                                                       |
| Final two-week live harness                  | 12/12 expected modes: 11 AI, one empty Rules/no call; all accepted by unchanged output boundary validator |

The initial PostgreSQL run had 14 failures due to BigInt fingerprint serialization and an old fingerprint test assumption. Those were fixed and the complete pipeline/web launcher rerun passed; they are not omitted from the history of validation.

The first live feature run had one invalid-output fallback. An isolated expired-case rerun succeeded, but that does not establish the first failure's cause. The prompt was subsequently made explicit that historical topic IDs are not valid enhancement targets, then the **full final run** succeeded. Do not present that sequence as proof that historical enhancement targeting caused the original invalid output.

The final model was the already verified Azure `gpt-6-luna` deployment, using the credential-free local inline YAML from the baseline configuration. No production model config was edited. Final prompt version is `vantage-agenda/contract-v1.5-history.1`. The 11 successful feature calls used **26,397 input + 9,078 output = 35,475 total tokens**, including 4,977 reasoning tokens within output usage. Combined generation time was 67,758 ms; full harness command took 69,864 ms. These totals exclude earlier attempts/diagnostics and do not establish monetary billing cost.

From the feature checkout:

```powershell
pnpm --filter @launchstack/pipelines test src/vantage/generation-v1.test.ts src/vantage/contract-v1.test.ts src/vantage/previous-context-v1.test.ts src/vantage/previous-context-generation.test.ts src/vantage/revalidate-previous-v1.test.ts
pnpm --filter @launchstack/llm test src/structured-attempt.test.ts
pnpm --filter @launchstack/pipelines exec node --import tsx scripts/vantage-previous-context-harness.mjs --output <new-path>/rules.json
pnpm --filter @launchstack/pipelines exec node --import tsx scripts/vantage-previous-context-harness.mjs --live --output <new-path>/live.json
pnpm exec node scripts/dev/vantage-integration-tl-test.mjs
```

For live replay, supply existing approved `CHAT_BASE_URL`, `CHAT_API_KEY`, and an **absolute** `CHAT_MODELS_CONFIG` path through the process environment. The harness does not load dotenv or select another model. It defaults to Rules; live fallback fails its expected-mode check. Use new output filenames: creation is exclusive. Never print credentials. The PostgreSQL launcher uses its isolated synthetic database; it is not a production-database command.

## Exact implementation files

| Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Change                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [previous-context-v1.ts](../../pipelines/src/vantage/previous-context-v1.ts), [contract-v1.ts](../../pipelines/src/vantage/contract-v1.ts)                                                                                                                                                                                                                                                                                                                                           | Bounded internal history contract, assembler, source/cutoff masking, full history/action fingerprints                                             |
| [repository-v1.ts](../../pipelines/src/vantage/repository-v1.ts), [service-v1.ts](../../apps/web/src/server/vantage/service-v1.ts)                                                                                                                                                                                                                                                                                                                                                   | Previous-week canonical reader, requesting actor binding, generation fingerprint/revalidation                                                     |
| [revalidate-previous-v1.ts](../../pipelines/src/vantage/revalidate-previous-v1.ts), [evidence-v1.ts](../../pipelines/src/vantage/evidence-v1.ts)                                                                                                                                                                                                                                                                                                                                     | Conservative clue matching over current authorized evidence, bounded ranking hint, explicit document unavailability                               |
| [generation-v1.ts](../../pipelines/src/vantage/generation-v1.ts), [rules-v1.ts](../../pipelines/src/vantage/rules-v1.ts)                                                                                                                                                                                                                                                                                                                                                             | Separate skeptical history prompt, current-evidence preference, no automatic stale work renewal, unchanged generation runtime/output contract     |
| [structured-attempt.ts](../../packages/llm/src/structured-attempt.ts), [llm index](../../packages/llm/src/index.ts)                                                                                                                                                                                                                                                                                                                                                                  | Expose the exact existing schema-instruction string so caller budgeting includes real shared transport overhead; no second transport/model policy |
| [fixture](../../fixtures/vantage-previous-context/two-week.json), [two-week test](../../pipelines/src/vantage/previous-context-generation.test.ts), [assembly test](../../pipelines/src/vantage/previous-context-v1.test.ts), [revalidation test](../../pipelines/src/vantage/revalidate-previous-v1.test.ts), [repository integration test](../../pipelines/src/vantage/repository-v1.integration.test.ts), [harness](../../pipelines/scripts/vantage-previous-context-harness.mjs) | Synthetic semantics, privacy/cutoff/budget/race cases, real PostgreSQL preservation tests, replayable Rules/live artifacts                        |

## Artifacts, preservation, and limits

Local synthetic artifacts are ignored:

- [rules-final.json](../../test-output/vantage-previous-context-2026-10-24/rules-final.json)
- [live-final.json](../../test-output/vantage-previous-context-2026-10-24/live-final.json)
- [examples.md](../../test-output/vantage-previous-context-2026-10-24/examples.md)
- [verification.json](../../test-output/vantage-previous-context-2026-10-24/verification.json)

Real PostgreSQL tests verify that new-week generation and same-week regeneration leave the old report, old topic/decision records, and action records intact. Existing same-week behavior may replace only untouched generated suggestions; it does not archive every transient draft as another report version. The new feature adds no action/status mutation and no new table.

Limits remain explicit:

- No automatic actor-authorized workspace document content/diff verification was integrated. Company-only adapters are insufficient.
- Rules uses conservative lexical association, not semantic resolution classification. Its useful outcome is a source-grounded clarification; model behavior can be richer but must still be reviewed.
- Current source IDs and schema validity do not prove semantic support. The live results above were manually checked, but they are one sample per synthetic case, not a calibrated benchmark.
- The race scenario's model output is not a concurrency test; real PostgreSQL stale-snapshot tests provide that evidence.
- Historical source checks and current evidence still rely on the host's authorized Vantage scope. The new actor binding does not grant document ACLs.
- No browser acceptance, production connector, public research, Company Architecture generator, or automatic document-fetch workflow is claimed.
- Joseph/Sophia V0 contracts and implementations remain unchanged; their 48 compatibility checks passed.
