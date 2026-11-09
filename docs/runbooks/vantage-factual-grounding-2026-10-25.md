# Vantage factual grounding patch — 2026-10-25

Implemented on the isolated feat/vantage-previous-context checkout starting at **83cf88c8aa77b33587632a0b352f6365275d0153**. Local commit identity is delivered with this report and in the ignored final-commit-task1.json artifact. No push/merge, production data access or model substitution.

## What changed

- generation-v1.ts adds explicit event-state attribution instructions covering requested, proposed, planned, approved/scheduled, executed/deployed, reported completed and independently verified completed. The rule applies to summary, title, facts, interpretations and question framing. Human decisions remain records of choices, not execution proof.
- New event-state-grounding-v1.ts implements a shared pure **narrow contradiction guard**. It recognizes explicit named schedule subjects plus destination dates, and versioned release/build/deployment predicates with a grammatically bound production/staging environment. It compares assertions to the same event; citations are never permission or semantic proof.
- Facts/conflicts and enhancements are checked against their cited selected source text. Summary, titles and interpretations use selected current sources. Historical reports, pending questions and human decisions cannot supply current confirmation.
- Ambiguous subjects, quoted/historical claims, questions, conditions and recognized epistemic negations abstain. Article removal preserves internal words. A production dashboard or completed build cannot confirm a production deployment. Release/build/version namespaces remain distinct.
- Normalization checks the actual prompt-visible pack before accepting an AI response. Violations throw InvalidStructuredAttemptError and use the existing attempt-two repair, then invalid-output Rules fallback. The repair reminder stays inside the existing reserve.
- validate-generation-v1.ts applies the same guard at the final host boundary, rejecting an injected contradiction before persistence. No public JSON fields change.
- New focused tests and synthetic fixtures include the exact previously saved C3 input and overconfident summary. A PostgreSQL test proves rejection preserves existing reports, pending lineage, decisions, contract state and actions.

Prompt version: **vantage-agenda/contract-v1.5-history.3-event-state**. Output schema, 2,400 output-token cap, 20-second attempt timeout, maximum two attempts, one-second transient retry wait and 45-second total budget remain unchanged. There is no new default model call. Rolling Carry-Forward, Contract v1 DTOs, V0 interfaces and retrieval algorithms are unchanged.

## Actual live before/after

The approved Azure deployment was **gpt-6-luna**; all provider responses identified **gpt-6-luna-2026-09-22**. Model YAML SHA-256 remained **2b5e377779313de1e13868b4c61f0633d15b63a3eb82e03d761f399768e02bb9**. Credentials, headers and endpoint identity are excluded from artifacts.

Nine identical synthetic input pairs ran against the preserved 83cf88c generator/validator and patched modules. Each result was a genuine validated AI result, one attempt, HTTP 200, no fallback. An additional final-code C3 replay also succeeded in one attempt: **19 provider calls total**. Live repair was not observed; repair/fallback were exercised with deterministic injected responses.

Requested-only source:

> The customer requested moving the synthetic pilot start from November 20 to November 27. No technical acceptance review was conducted in the rescheduling call.

Old live summary:

> The Pilot scheduling note says the customer moved the synthetic pilot start from November 20 to November 27…

New live summary:

> The Pilot scheduling note says the customer requested moving the synthetic pilot start from November 20 to November 27; it does not confirm that the change was accepted.

The old topic also described a “rescheduled pilot,” “later start date” and “changed pilot date” despite correct requested wording in its cited fact. New title/interpretation/rationale retain the unaccepted request. This is an observed content improvement, not a conclusion inferred from passing schema checks.

| Synthetic case | Actual old/new review |
| --- | --- |
| Request without confirmation | Old promotes request in summary and topic framing. New preserves request and asks about acceptance. |
| Separate later confirmation | Both allow the actual confirmation, cite the confirming account and distinguish technical readiness. The guard does not reject a source merely because another source contains “requested.” |
| Production plan vs staging deployment | Both preserve actual staging deployment while leaving production approval/deployment unknown after the planned date. |
| Reported successful checks vs open action | Both preserve canonical open status. New explicitly distinguishes reported checks, independent verification and recorded resolution. |
| Edited document vs implementation | Both avoid claiming implementation/deployment from a rename/date-label edit. Automatic workspace-version verification remains unavailable. |
| Explicit nonconfirmation/nonapproval | Both retain the status negation. New still overstates one time scope: see limitations. |
| Old request and new confirmation in one body | Both describe confirmed November 27 status after the request. No source-order or createdAt heuristic supplies proof; the text itself explicitly confirms it. |
| Historical AI approval contradicted by current account | Both prefer current awaited approval over the historical AI conclusion. |
| Exact previous rolling C3 | New summary, title and interpretation distinguish a request from an agreed date. Both original pending IDs are transmitted, unchanged. |

The final exact-C3 replay says:

> …the customer requested moving the synthetic pilot start from November 20 to November 27… the evidence does not say whether the date change was accepted…

It also says earlier CSV and deletion-dry-run questions receive no current update and their progress remains unknown. No Commitment or human review state is changed by these read-only model runs.

The saved earlier C3 failure is now rejected specifically at summary with source ev:d86c5d37-89f3-4d24-a38e-06b3604d8786. The exact paragraph contains an unrelated uncertainty after a dash; regression coverage ensures that cannot hide its preceding scheduling assertion. A genuine suffix condition still abstains.

## Artifacts and reproducibility

All raw artifacts are synthetic-only and ignored under **test-output/factual-grounding/20261025T173456Z/**:

- [Full actual paired reports](../../test-output/factual-grounding/20261025T173456Z/before-after.md).
- [Independent semantic evaluation](../../test-output/factual-grounding/20261025T173456Z/evaluation.md).
- [Pair identity, token usage and saved-failure check](../../test-output/factual-grounding/20261025T173456Z/comparison.json).
- [Final guard over all 18 captured results](../../test-output/factual-grounding/20261025T173456Z/final-guard-revalidation.json).
- [Old run](../../test-output/factual-grounding/20261025T173456Z/old-01/run-summary.json), [new run](../../test-output/factual-grounding/20261025T173456Z/new-01/run-summary.json), [final C3 replay](../../test-output/factual-grounding/20261025T173456Z/new-final-c3/run-summary.json).
- Per-case input, actual request and response files include every provider attempt. The old modules, original Git contents, rewritten import paths and hashes are preserved in baseline-import-manifest.json.
- Exact commands/durations/exit codes are in logs/*.json and each live attempt's command JSON.

Old paired usage: **22,433 input + 8,017 output = 30,450 tokens**. New paired usage: **24,449 input + 8,124 output = 32,573 tokens**. This includes reasoning output and is not a billing estimate or controlled performance benchmark. The final C3 replay is additional. Model outputs remain stochastic; the original old C3 retry did not repeat its exact old summary error but still presupposed an agreed revised date elsewhere.

All nine per-case input hashes match both captures. After the paired run, the fixture gained the exact observedPriorFailure summary as test metadata; this changed the whole fixture-file hash but none of its nine GenerationInput values. Final guard tightening occurred after the paired run; all captured new outputs were then revalidated and final C3 was called again with the final code.

~~~powershell
# Run from the isolated source root; use the repository's pnpm 10.15.1.
pnpm --filter @launchstack/pipelines test src/vantage/event-state-grounding-v1.test.ts src/vantage/event-state-generation.test.ts
pnpm --filter @launchstack/pipelines typecheck
pnpm --filter @launchstack/web typecheck
pnpm exec node scripts/dev/vantage-integration-tl-test.mjs

# New unique labels; launcher loads the existing approved credentials locally.
node test-output/factual-grounding/20261025T173456Z/run.cjs live old-02 old
node test-output/factual-grounding/20261025T173456Z/run.cjs live new-02 new
node test-output/factual-grounding/20261025T173456Z/run.cjs live c3-02 new original-rolling-c3
~~~

## Validation

- **274/274** targeted generation, Contract v1, historical continuity and V0 tests, 16 files. This includes 48 pure guard tests and 11 repair/boundary integration cases.
- **85/85** fixed pipeline PostgreSQL/regression tests, including **54 real PostgreSQL repository cases**.
- **203/203** fixed API/auth/history tests, including actual isolated PostgreSQL route/auth cases with session/model doubles.
- Pipeline and web TypeScript passed. Scoped Prettier and Git whitespace checks passed.
- New PostgreSQL case checks rejection before save and unchanged current/original report, pending ledger, decisions and action state.
- Existing synthetic database/volume is retained. No production connector or data was used.

These suite counts overlap and should not be added as unique test totals. The adapter proposal below was design-only at this commit; no Company Architecture source was activated.

## Remaining semantic limits

This guard is deliberately incomplete. It can reject specific matched status contradictions; it cannot prove arbitrary semantic entailment, resolve all event aliases/pronouns, establish source truth, authenticate a source, understand every temporal relation or validate all nominal presuppositions such as “revised date.” Unrecognized grammar, quoted current assertions, ambiguous shortened subjects and unmatched events can pass by abstention. Deployment binding uses version/environment, not a general multi-attempt event model. Month/day dates use the reporting year when no year is supplied. A successful check means only that no supported narrow contradiction was found.

The prompts cover document changes, reported test success and human decisions, but those general distinctions are not all hard-rejected by this parser. Human review and exact provenance remain necessary.

Actual remaining quality issues: the new negation example expands “no review during the November 13 scheduling call” into “no review … on November 13” in its summary, while its facts preserve the call scope. Some decision questions assume a future review; a document rename still receives an implementation/acceptance investigation without a supplied business need. These are recorded limitations, not silently declared correct because the validator passed.

The [Company Architecture integration proposal](../design/vantage-company-architecture-adapter-v0.md) identifies canonical profile reuse, all-contributing-source ACL checks, review receipts, provenance/version fingerprints and missing production dependencies. A separately committed follow-up may implement that seam; this grounding commit does not activate it.
