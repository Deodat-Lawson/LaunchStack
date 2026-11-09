# Retrieval and Joseph role review — November 9, 2026

## Integration and scope

Merged `origin/feat/vantage-joseph-integration` at `301dcfc9` into
`sophia-vantage-retrieval`, producing merge commit `71d01e3e`. Preserved Sophia's
authorized RAG adapter, focused filtering, validation agent, tests and exports;
added Joseph's role/provider/UI exports and the integration branch's host work.
The branch history includes the existing synthetic frontend and generation work.
This is a local merge, not a push or production rollout.

Reviewed the newer `origin/integration/vantage-grounding-m3-20261106` at
`1a3bec58`. Selectively reused its `primaryRolePreference` implementation from
`dynamic-retrieval/retrieve.ts` and `types.ts`; the full milestone branch and its
expanded role taxonomy were not merged. Added per-role calculation diagnostics
and regression tests using Joseph's actual Founder/Engineering directory.

Online search is outside this work. No public provider was called, configured or
enabled. The existing optional research module remains available. Omitting
`research` from `runDynamicContextV0` keeps this retrieval path internal-only.

## How retrieval scoring works

This is a deterministic ordering, not a single weighted score or model confidence.

1. For each role, tokenize its description, responsibilities and priorities:
   lowercase, unique letter/number sequences of at least three characters, with
   the small stop-word list in `bounds.ts` removed. There is no stemming or
   semantic equivalence: `deployment` and `deployments` differ.
2. Tokenize each source's trusted title, topics and excerpt the same way.
3. For each role, relevance is `matched unique terms / max(1, role term count)`.
   An explicit server-owned `metadata.roleIds` match overrides this to **1**.
4. Overall relevance is the **maximum** per-role relevance, not a sum or mean.
   Matching ownership makes a source eligible but does not raise its relevance.
5. Sort descending by: **older explicitly open work → confirmed primary-role
   score (when opted in) → overall relevance → trust → recent**. The canonical
   source key breaks remaining ties in ascending order. Trust comes from trusted
   metadata in `[0,1]`, default **0.5**; it is not learned or calibrated. Recency
   is a boolean reporting-window check, not time decay.
6. Deduplicate and apply source, excerpt and token budgets in rank order.
   Required company context and stars reserve capacity before optional retrieval.

For example, a role with three terms `engineering`, `reliability`, `deployment`
and a source matching the last two scores **2/3**. Repeating `deployment` does not
increase it. An explicit engineering tag scores **1** even with no text overlap.
The RAG backend's native similarity score is not used as this final score; its
exact authorized document/version hits determine candidates.

`diagnostics.scores` now records `roleScores` (matched terms, term count, explicit
tag match and score), `ownerMatch`, relevance, trust, recent, older-open and lanes.
The primary preference option also reports `primaryRoleId`, `primaryRoleScore`
and `primaryRoleMatched`. Only selected authorized sources receive these details.

```ts
await runDynamicContextV0(input, authoritativePorts, {
    retrieval: {
        search: authorizedSearch,
        selectionPolicy: "focused",
        primaryRolePreference: true,
    },
});
```

The primary preference is opt-in; default ordering is unchanged. It requires a
confirmed, non-fallback role context with the primary role in the verified role
set. It never grants access or adds a source. Secondary roles remain eligible,
but tighter budgets can change which eligible sources fit. Focused filtering
omits unrelated recent sources and explicitly resolved older sources, preserving
relevant recent resolutions and older work without an explicit resolved state.
The existing demo host does not enable the new option automatically.

## Joseph role review findings

- Controlled aliases, deterministic deduplication, multi-role resolution and
  primary-first priorities are implemented. Profile-title inference stays
  unconfirmed. Unknown or partially unknown selections retain fallback semantics.
- The merged directory contains Founder, Product, Engineering and Growth/Sales.
  Business perspective is separate from workspace authorization. Primary choice
  previously changed role ordering but not retrieval ranking; the opt-in feature
  now connects it to ranking without altering permissions.
- Role/star edits use revision checks and compare-and-swap. The synthetic host
  stores personal state in process memory: restart loses selections, and this
  is not durable multi-process production storage.
- **Generation remains blocked on an unreviewed canonical company profile.**
  Joseph accepts only `reviewed` or `unknowns-marked`; the actual company adapter
  returns `unreviewed`. No review status was fabricated or bypassed. A genuine
  review workflow or an agreed policy change is still needed.
- The authorized RAG adapter remains opt-in. Production host wiring, corpus
  bounds, backend cancellation and measured real-data retrieval quality are
  still outstanding; fixture improvements do not establish production quality.

## Separate final-output evaluation score

The existing validation agent's score is different from retrieval ranking:

- Coverage = rounded `100 × sum(importance × verdict credit) / sum(importance)`.
  Importance is normal **1**, important **2**, critical **3**; credit is met **1**,
  partial **0.5**, missed/violated **0**. An uncertain verdict makes coverage null.
- Grounding, temporal accuracy, relevance, actionability and readability are
  evidence-backed judge ratings **0–4**, multiplied by **25**. Deterministic
  citation errors can cap grounding or temporal accuracy at zero.
- Overall = rounded arithmetic mean of all **six** metrics, only when none is
  null. A high average alone does not pass: integrity errors, critical misses,
  coverage below **80**, or any other metric below **75** fail. Incomplete context
  cannot pass and returns needs-review unless a failure condition applies.

See `pipelines/src/vantage/validation/evaluate.ts` and `rubric.ts` for the exact
implementation. This merge did not change the evaluation formula.

## Validation

The merged baseline passed **532 pipeline tests**, **440 web tests**, and both
pipeline and web TypeScript checks. **54 pipeline and 80 web database tests were
skipped** because no isolated test database was configured. These are offline
tests, not browser, database, live-model or production acceptance.

After the ranking and diagnostics change: **226 focused tests passed**, including
seven new role/scoring cases; all six existing synthetic retrieval demos passed.
Pipeline and web TypeScript checks, scoped ESLint, changed-code formatting and
diff whitespace checks passed. ESLint emitted the existing root React/Next
configuration notices. The synthetic public-search demo uses an in-memory stub;
it makes no online search call.

The regression covers a primary-role flip, neutral default/unconfirmed/fallback
behavior, older-open priority under a source cap, exact score arithmetic,
ownership, foreign-hit rejection and revoked-source exclusion. One initial test
fixture incorrectly retained a revoked excerpt; the contract correctly rejected
it, and the fixture was corrected to redact that excerpt before the final run.

## PR CI follow-up

The first full CI run for PR #602 exposed failures beyond the focused local suite:

- The inherited Contract v1 migration had no snapshot, and schema-generated
  foreign-key names differed from its existing SQL. Reused upstream commit
  `1b552a29` from `fork/vantage/backend-ai-pipeline`, preserving attribution,
  restoring the snapshot and explicitly declaring the existing constraint names.
  No applied migration SQL was edited and no new database migration was added.
- Vantage's company architecture adapter imported sibling implementation files.
  It now uses the existing public `@launchstack/pipelines/company-metadata` API;
  the architecture boundary test remains unchanged.
- The mindmap live embedding evaluation interpreted CI's placeholder API key as
  permission to call a provider. It now requires `RUN_MINDMAP_EMBEDDING_EVAL=1`
  plus a key. The three live quality assertions remain available for an explicit
  evaluation; regular CI makes no embedding call from this suite.

Local checks for this repair: both migration journals pass, `drizzle-kit check`
passes, both schema generators report no changes, 62 pipeline tests and 26 web
tests pass, and the three live embedding tests skip with CI's placeholder key.
Pipeline TypeScript, scoped ESLint and changed-code formatting pass. Docker is
not running locally, so physical schema equivalence is verified by the next
GitHub CI run rather than claimed from these local checks.
