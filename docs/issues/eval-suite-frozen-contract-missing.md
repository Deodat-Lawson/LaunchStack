# [Eval suite] The "frozen contract" `schema/index.ts` does not exist — reconcile the provisional one

**Parent:** Part of the Campaign Planner evaluation suite work. Link this in the parent issue.

**Assignee:** Eval suite lead (contract owner)

**Labels:** `blocker`, `evaluation`, `contract`, `needs-decision`

---

## Summary

The eval-suite brief instructed the implementation to build against `schema/index.ts`,
described as a pre-existing **frozen contract** owned by the lead, containing `Fixture`,
`CompanyFixture`, `ExpectedConstraints`, `CriterionSpec`, `CriterionScore`,
`DeterministicAssertion` and `EvalContext`.

**That file does not exist and never has.** Rather than block the whole deliverable, a
provisional contract was authored at `schema/index.ts` and everything else was built against
it. This issue records the gap and the reconciliation steps.

## Evidence the contract is absent

Confirmed against the full commit graph, not just branch tips:

```bash
# No commit in any ref's history ever added the file
git log --all --oneline -- 'schema/index.ts'          # → empty

# No commit ever introduced the type names
git log --all --oneline -S "CriterionScore"           # → empty
git log --all --oneline -S "CompanyFixtureSchema"     # → empty

# Nothing in the working tree
grep -rn "CriterionScore\|CompanyFixtureSchema\|DeterministicAssertion\|EvalContext" \
  --include="*.ts" . | grep -v node_modules          # → only the provisional file
```

All six `marketing-*` branches were checked individually, including `origin/marketing-pipeline-v2`
(the newest, 2026-07-25). None contains a top-level `schema/`, `references/` or `fixtures/`
directory. There is no `marketing-pipeline-v1` branch.

## What was found instead

An **existing** evaluation framework at `apps/web/src/lib/agents/evals/`, which the brief's Phase 2
("implement deterministic coverage in the correct existing location") almost certainly meant:

| Existing (`apps/web/src/lib/agents/evals/types.ts`) | Brief's contract |
|---|---|
| `EvalScenario` | ≈ `Fixture` |
| `EvalExpected` | ≈ `ExpectedConstraints` |
| `EvalMetric` | ≈ `CriterionScore` |
| `EvalDomain`, `EvalResult`, `EvalReport` | no counterpart in the brief |
| — | `CompanyFixture`, `CriterionSpec`, `DeterministicAssertion`, `EvalContext` (new) |

The provisional contract was therefore modelled as a forward-compatible **evolution** of that
framework rather than invented from nothing. `schema/index.ts` exports `toEvalMetric()` to
bridge a `CriterionScore` into the existing `EvalMetric` shape the current runner aggregates.

Also reused rather than reinvented, per the brief's "use existing utilities" instruction:
`checkGrounding` (`packages/core/src/guardrails/groundingCheck.ts`), which already does keyword
overlap plus `string-similarity-js` fuzzy matching. No new similarity dependency was added.

## Decision needed

Pick one:

- [ ] **A — Adopt the provisional contract.** Review `schema/index.ts`, amend as needed, drop
      the `PROVISIONAL` banner. Lowest cost; the suite is already green against it.
- [ ] **B — Replace with the real contract.** Supply the intended `schema/index.ts`. See
      migration cost below.
- [ ] **C — Fold into the existing framework.** Discard the separate `schema/` module and
      express everything as extensions to `apps/web/src/lib/agents/evals/types.ts`. Most consistent
      with current repo structure; requires renaming across fixtures and assertions.

## Migration cost if the real contract differs (option B)

Ordered cheapest to most expensive:

| Artefact | Impact |
|---|---|
| `references/evaluation.md` | **None.** Plain Markdown, contract-independent. |
| `fixtures/companies/*/company.json`, `fixtures/companies/*/docs/*.md` | **Low.** Plain data; likely field renames only. |
| `fixtures/evaluations/campaign-fixtures.json` | **Low–medium.** Field renames within `expected`. |
| `apps/web/src/lib/agents/evals/campaign/text.ts` | **None.** Pure string utilities, no contract imports. |
| `apps/web/src/lib/agents/evals/campaign/assertions.ts` | **Medium.** 24 assertion bodies are logic-only; the churn is the `DeterministicAssertion` signature and the `pass`/`fail`/`partial` helpers. |
| `apps/web/src/lib/agents/evals/campaign/loader.ts`, `runner.ts` | **Medium.** Import surface and `EvalContext` shape. |
| `apps/web/__tests__/lib/evals/*.test.ts` | **Medium.** 121 tests; assertions on `CriterionScore` shape would need updating. |
| `tsconfig.json`, `jest.config.js` | **Trivial.** One `@schema` path alias each. |

## Specific design choices to review

Made unilaterally because the contract was absent. Each is a plausible point of divergence:

1. **`CriterionScore.score` is normalised 0..1**, not the raw `score`/`maxScore` pair the
   existing `EvalMetric` uses. Rationale: criteria aggregate cleanly regardless of how many
   sub-checks each performs. `toEvalMetric()` converts back.
2. **`severity` (`error` / `warning` / `info`) decides whether a failure blocks.** Only
   `error`-severity failures set `passed: false` on a fixture result.
3. **A fixture with an empty `criteria[]` runs every registered assertion.** Assertions
   self-skip when unconfigured, so this gives broad default coverage without per-fixture
   boilerplate. All eight shipped fixtures rely on this.
4. **`ExpectedConstraints` is one flat object** rather than per-criterion parameter blocks.
   Simpler to author; less flexible if two instances of the same criterion are needed on one
   fixture.
5. **`EvalContext` carries raw document text** keyed by fixture-relative path, so provenance
   quotes can be verified by exact substring match.
6. **Assertions must never throw.** The runner catches anything that does and records it as a
   runner error rather than a fixture failure, on the grounds that a throwing assertion is a
   bug in the assertion.

## Related gap: `sourceFacts` has no production equivalent

Separate from the contract question, and worth a decision of its own.

`CompanyFixtureSchema.sourceFacts` classifies facts as `supported`, `contradictory` or
`distractor`. Production `CompanyMetadataJSON` has **no representation for a deliberately
false or deliberately irrelevant fact** — it stores only facts believed true, each with a
confidence score.

Consequence: every grounding criterion in this suite (`no-contradictory-facts`,
`no-distractor-facts`, `must-use-supported-facts`) can only run against fixtures, never
against live company data. Measuring contradiction-resistance in production would require a
schema addition, not a fixture change.

Full field-by-field comparison in `fixtures/companies/METADATA-MAPPING.md`.

## Acceptance criteria

- [ ] One of options A/B/C is chosen and recorded in this issue.
- [ ] If A: the `PROVISIONAL CONTRACT` banner is removed from `schema/index.ts`.
- [ ] If B or C: fixtures, assertions and tests are migrated and `npx jest __tests__/lib/evals`
      is green again.
- [ ] The six design choices above are either ratified or amended.
- [ ] A decision is recorded on whether `sourceFacts` needs a production counterpart.
