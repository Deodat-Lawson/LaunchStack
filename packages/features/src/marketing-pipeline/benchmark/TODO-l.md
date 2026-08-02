# Campaign Planner Eval Suite — Team Lead Implementation Plan

**Your charter:** own everything that must be *trusted and stable* — the judge,
the runner, the reproducibility manifest, and the CI regression gate. You build
against the same frozen [`schema/`](./schema/index.ts) the member does. Your track
is the **critical path** (judge → runner → gates); the member's dataset +
deterministic assertions run alongside and plug into your scorer registry.

**Requirements you own (from the ticket):** capture (raw outputs, per-criterion +
aggregate scores, latency, failure states); reproducibility manifest (model,
prompt, config, fixture versions); machine-readable results; candidate-vs-baseline
comparison; CI fails only on defined thresholds; judge stability (no flaky tests);
no real publishing / no production data. You expose the callable that the member's
`pnpm eval:campaign` wraps.

**Reuse, don't reinvent:** the disabled [`validatePostQuality`](../generator.ts)
(structured 1–10 rubric) is the seed of the judge; [`MARKETING_MODELS`](../models.ts)
is the swap point for the multi-config frontier; [`generateVariants` /
`generateCampaignOutput`](../generator.ts) is the Mode-A seam;
[`runMarketingPipeline`](../run.ts) is the Mode-B seam.

---

## Phase 0 — Freeze the contract (do first; blocks the member)
- [x] Three schemas written: [`enums`](./schema/enums.ts),
      [`fixture`](./schema/fixture.ts), [`result`](./schema/result.ts),
      [`contracts`](./schema/contracts.ts).
- [ ] Define the **scorer registry** interface: `Map<CriterionId, Scorer>`, plus
      how a fixture's `CriterionSpec.method` selects deterministic vs judge.
- [ ] Define the **run config** type: which pipeline models (a `MARKETING_MODELS`
      override), prompt version, judge config, mode (A/B), thresholds. This is the
      object that gets hashed into `RunManifest.configHash`.
- [ ] Fix normalization conventions: all scores `[0..1]`; `passed` = `score ≥
      minScore` (or `true` when `minScore` is null); document rounding.
- **DoD:** member has signed off; registry + config interfaces committed under
      `benchmark/runner/types.ts`.

## Phase 1 — Judge engine + calibration (trust foundation; critical path)
Location: `benchmark/judges/`.
- [ ] **Rubrics** (`rubrics.ts`): one fixed, versioned rubric per subjective
      criterion — `brand_voice`, `audience_relevance`, `goal_alignment`,
      `hook_strength`, plus the judge half of `groundedness`, `specificity`,
      `cta_quality`, `variant_quality`. Each rubric has an explicit 0–1 scale
      anchored with descriptions. Bump `RUBRIC_VERSION` on any wording change.
- [ ] **Judge** (`judge.ts`): structured-output (Zod) scorer that takes an
      `EvalContext`, injects the rubric + the `## anchors` few-shot exemplars from
      `references/evaluation.md`, and returns a `CriterionScore`. Reference-anchored
      and, where useful, **pairwise vs a gold post** (win/lose/tie → score).
- [ ] **Stability:** temperature 0, **N-sample + median** aggregation, record
      `stdDev` on each `CriterionScore`; keep N and temperature in the manifest.
- [ ] **Versioning:** record judge model + `RUBRIC_VERSION` in `RunManifest.judge`.
- [ ] **Calibration test** (`__tests__/marketing-pipeline/judge-calibration.test.ts`):
      grade the member's `## held-out` exemplars, assert good > bad ordering and
      threshold separation. **Gate behind `process.env.RUN_LLM_BENCHMARK`** so
      default CI doesn't pay for API calls.
- **DoD:** calibration passes on the seed exemplars; judge scores are stable across
      repeated runs (report variance). *Nothing downstream is trustworthy until this
      holds.*

## Phase 2 — Runner + capture (Mode A) + cost instrumentation
Location: `benchmark/runner/`.
- [ ] **Usage/cost collector** (`usage.ts`): wrap model calls to accumulate
      `usage_metadata` (prompt/completion/total tokens) → `TokenUsage`; map to
      `costUsd` via a per-model price table. Pipeline has none today — this is the
      prerequisite for the cost/token axis.
- [ ] **Mode-A generator** (`generate/modeA.ts`, satisfies `GenerateFn`): build the
      company-context string from the fixture company's `docs`, call
      `generateVariants` directly — **no DB, no web, no publishing**. Honor
      `simulateNoResearch` / `simulateNoPerformanceHistory` by passing empty inputs.
- [ ] **Scorer registry** (`registry.ts`): register the lead's judges and the
      member's deterministic assertions under one `CriterionId → Scorer` map.
- [ ] **Runner** (`run-benchmark.ts`): for each fixture → generate → dispatch each
      `CriterionSpec` to its scorer → fold into `CaseResult` (raw variants,
      per-criterion + weighted aggregate, latency, tokenUsage, cost, failure).
      Compare actual vs `expectedFailureMode`.
- [ ] **Emit** `BenchmarkRun` JSON + `RunManifest` (pipeline models snapshot,
      prompt version, configHash, fixtureSetVersion, gitSha) to
      `docs/pipeline/benchmarks/<runId>/results.json`.
- [ ] Expose a clean entrypoint the member's `pnpm eval:campaign` calls.
- **DoD:** one command runs all seed fixtures end-to-end and writes a valid
      `BenchmarkRun` (parses `BenchmarkRunSchema`) with real token/cost/latency.

## Phase 3 — Baseline, regression gate, and the frontier chart
- [ ] **Baseline store:** promote an approved `BenchmarkRun` to
      `docs/pipeline/benchmarks/baseline.json` via a documented promotion step.
- [ ] **Comparison** (`compare.ts`): candidate vs baseline → `BaselineComparison`
      (meanScoreDelta, per-fixture/criterion regressions, newFailures) against
      `RegressionThresholds`. Set `regressed` only when a defined threshold breaks.
- [ ] **CI wiring:** a job that runs the suite and **fails only on
      `regressed === true`**; gate the paid LLM run behind an env flag / label so
      normal PRs stay free. Deterministic-only structural tests stay always-on.
- [ ] **Config sweep + frontier chart:** run N configs (vary
      `contentGeneration` model in `MARKETING_MODELS`, e.g. gpt-4o / gpt-5-mini /
      gpt-5-nano) and emit a self-contained Score-vs-cost SVG/HTML — the appraisal
      chart (like the GPT/Perplexity frontiers) into the run folder.
- **DoD:** a regressing candidate fails CI on a defined threshold and *only* then;
      a green candidate can be promoted to baseline; the frontier chart renders.

## Phase 4 — Mode B, true end-to-end (opt-in, after A is trusted)
- [ ] **Mode-B generator** (`generate/modeB.ts`, same `GenerateFn`): seed a fixture
      company + docs into a test Postgres + RAG index, run `runMarketingPipeline`,
      capture the same fields. Gate behind an env flag; never touch prod data.
- **DoD:** the same fixtures run through the full pipeline and produce comparable
      `CaseResult`s; retrieval-quality gaps A can't see become visible.

---

## Dependencies on the member
- **Phase 1 calibration** needs `references/evaluation.md` with the
      `## anchors` / `## held-out` split (member Phase 1a).
- **Phase 2 registry** needs the deterministic assertions (member Phase 2) — until
      then, register judge-only scorers and stub deterministic ones.
- **Phase 2 baseline** needs the seed fixtures + mock companies (member Phase 1b/1c).

## Hard rules
- Judge is version-pinned (model + `RUBRIC_VERSION`) and calibrated before use.
- Every run is reproducible from its `RunManifest` alone.
- Deterministic structural tests: always-on, no API cost. Paid LLM runs: gated.
- No real publishing, no production data — Mode A is offline; Mode B uses a test DB.
- CI fails **only** on explicitly defined regression thresholds — never on raw
      score noise.
