# Vantage validation agent

Sophia's assignment is to evaluate final Vantage reports/tasks against Joseph's
scenario documents and expected findings. The new module consumes those three
inputs and returns six quality assessments, exact evidence, missed expectations,
integrity errors, a verdict, and JSON/Markdown reports. It does not generate or
rewrite the report, modify retrieval, or persist actions.

## Repository audit

Baseline: local `sophia-vantage-retrieval` at `a329960d`; downloaded leader demo
`7bf2f201` and Joseph integration `301dcfc9` were inspected for interface compatibility.

| Existing component | Finding and decision |
| --- | --- |
| `dynamic-retrieval/rag-search.ts` and `retrieve.ts` | Evidence selection, not final-output evaluation. Preserved as separate earlier work. |
| `validate-generation-v1.ts` | Structure, signal and source-consistency checks; no semantic expectation coverage, readability or action-quality evaluation. Preserved. |
| `contract-v1.ts` and `generation-v1.ts` | Existing report shape, reused through a read-only normalizer. Frozen generation contracts remain unchanged. |
| Leader `ExperimentalReportV0` | Supported by the normalizer. Canonical refs use the existing `contextSourceKeyV0` escaping; no invented V1 aliases. |
| Marketing benchmark/content scoring | Useful pattern, but marketing-specific criteria. No cross-vertical internal dependency introduced. |
| `@launchstack/llm` structured attempt | Reused for configured model selection, structured output, usage, message behavior, limits and one attempt with SDK retries disabled. |

No compatible Joseph evaluation fixture format was found. The versioned JSON
schema below is the proposed handoff. The bundled examples are hand-authored for
this implementation, not Joseph's actual data or independent human-panel labels.

## Six criteria and scoring

| Criterion | What is assessed |
| --- | --- |
| Factual grounding | All claims, including summary, rationale, owners and deadlines, are supported by the supplied sources; conflicts and uncertainty are preserved. Citation validity alone is not entailment. |
| Expected-item coverage | Joseph's important findings are met, partly met or missed; prohibited claims are absent or violated. Match meaning rather than keywords. |
| Temporal correctness | Evidence availability at the cutoff; historical questions, resolved work, plans, approvals and explicitly open issues remain distinct. |
| Relevance and prioritization | Consequential issues receive attention; filler and duplicate tasks are avoided; independent conflicts remain visible. |
| Actionability | Concrete next steps and observable outcomes supported by evidence. Unknown owners/dates are preferable to invented ones. |
| Readability | Clear, concise, organized wording and understandable uncertainty. No English-only sentence-length heuristic. |

Rubric: `vantage-quality/1.0`. Five criteria use anchored judge scores: 0 fundamentally
wrong/unusable, 1 major problems, 2 material gaps, 3 meets the criterion with minor
issues, 4 fully meets it with precise evidence. Displayed scores multiply by 25.
Coverage is computed from semantic expectation judgments: importance weights
normal=1, important=2, critical=3; met=1, partial=0.5, missed/violated=0. Uncertain
expectations leave coverage null rather than guessing.

Initial pass thresholds are 75 for judged criteria and 80 for coverage, with no
missed/partial/violated critical expectation and no integrity errors. An unassessed
criterion or explicitly excerpted context prevents an unqualified pass. The overall
score is an equal mean only when all six scores exist. A high average never overrides
a failed critical expectation. These are reviewable initial policies, not a claim
of team-approved release criteria.

Unknown/missing factual citations cap grounding at zero; future-source citations
cap temporal correctness at zero. These caps apply only to an otherwise valid
numeric judgment. Without a judge, deterministic errors remain visible and semantic
scores remain null. Failed or malformed judge responses never count as success.

## Joseph's scenario contract

Complete runnable sample: `fixtures/vantage-validation/joseph-sample.json`.
The suite wrapper is `{ "version": "vantage-evaluation-suite/v1", "inputs": [...] }`.
Each input has `version: "vantage-evaluation/v1"` and these objects:

| Object | Required fields |
| --- | --- |
| `scenario` | `id`, `version`, `title`, `asOf` timestamp, `contextCompleteness` (`complete` or `excerpted`), `documents`, `expectations` |
| Each document | Exact citation `id`, source `version`, `availableAt` timestamp, source `text` |
| Each expectation | `id`, `description`, `kind` (`must_include` or `must_not_claim`), `importance` (`normal`, `important`, `critical`), `evidence: [{sourceId, quote}]` |
| `actual` | Candidate `id`, exact `pipelineVersion`, `summary`, normalized `tasks`, optional `enhancements` |

Every expectation needs an exact quote from an available source. Invalid source
IDs, fabricated quotes and future expectation evidence are rejected before judging.
Candidate citations are allowed to be invalid so they can be assessed as failures.
Document text/version should come from the frozen generation snapshot. `availableAt`
means when that version was available, not the current date.

V1 IDs use `ev:`, `obs:` and `cm:`. V0 document/company IDs must use the exact
`contextSourceKeyV0` representation. Do not URL-encode them independently or invent
aliases. The sample uses English IDs; content and judgments may be multilingual.

The normalizer accepts a V1 GenerationResult with `draft`, an AgendaDraft, the
leader's ExperimentalReportV0, or a wrapper with `report`, including the committed
leader replay's string citations and relative `proposedDueInDays`. It retains all topic
facts/conflicts, rationale, unknowns, owner, due date, help requests and generation
enhancements and unsupported-fact flags. Relative deadlines stay relative; no
absolute due date is invented. Signals, execution metadata and UI state are not scored as prose.
Select the intended native/experimental report explicitly from compound outputs.

```ts
import {
    normalizeVantageOutput, evaluateVantage, createModelValidationJudge,
} from "@launchstack/pipelines/vantage/validation";

const input = {
    version: "vantage-evaluation/v1",
    scenario: josephScenario,
    actual: normalizeVantageOutput(savedVantageResult, {
        id: "run-123", pipelineVersion: "exact-generation-commit",
    }),
};
const result = await evaluateVantage(input, {
    judge: createModelValidationJudge(approvedResolvedModel, {
        configurationId: "reviewed-config-fingerprint",
    }),
});
```

## Run and inspect results

From the repository root with the existing dependencies:

```sh
pnpm --filter @launchstack/pipelines test:validation
pnpm --filter @launchstack/pipelines demo:validation
pnpm --filter @launchstack/pipelines demo:validation --output-dir /tmp/vantage-demo-1
```

The demo replays pinned, hand-authored reference judgments for two good reports,
two flawed reports and one empty output. Each record is bound to the exact input
fingerprint and rubric. Its success means the evaluator reproduces expected
discrimination, not that a model independently scored those examples. Reports
identify `fixture-replay`; no live model or production quality claim is implied.

Integrity-only evaluation without a model:

```sh
pnpm --filter @launchstack/pipelines evaluate:vantage \
  --input /absolute/path/to/joseph-suite.json --checks-only \
  --output-dir /tmp/vantage-checks-1
```

For semantic judging, explicitly configure `CHAT_BASE_URL`, `CHAT_API_KEY` and
`CHAT_MODELS_CONFIG` for an approved model, then run:

```sh
pnpm --filter @launchstack/pipelines evaluate:vantage \
  --scenario /absolute/path/to/joseph-scenario.json \
  --actual /absolute/path/to/saved-report.json \
  --candidate-id run-123 --pipeline-version exact-commit \
  --live --output-dir /tmp/vantage-live-1
```

`--scenario` reads just the scenario object, and `--actual` normalizes saved Vantage
output. Alternatively use `--input` with a normalized suite and `--live`.
No `.env` is loaded automatically, and no alternative model is selected on failure.
Results contain criterion scores, expectations, evidence quotes, errors, judge/model
identity, input/scenario fingerprints, elapsed time and reported token usage.

Exit 0 means all evaluated cases passed; 1 means any failed; 2 means review or a
judge is still required. The demo deliberately contains failing candidates and
exits 0 when it reproduces all five intended verdicts. New output directories
contain `results.json` and `report.md`; existing results are never overwritten.

## Bounds and failure handling

All inputs are validated before any paid call. Limits are 14,000 serialized input
bytes per case, 20 cases per invocation and 1 MiB per input file. Required evidence
is never silently truncated; prepare explicit excerpts and mark their scope.
One structured attempt per case uses a 20-second provider timeout, 25-second assessor
deadline and 4,096 output tokens. The shared transport separately enforces its
24,000-byte prepared-prompt bound; oversize returns `judge-setup` without fallback.

Numeric ratings require exact output quotes, plus source quotes for grounding and
temporal assessment. Every expectation must occur exactly once and quote supporting
source evidence; claimed matches/violations also require output evidence. Unknown
IDs, invented quotes, duplicate/missing criteria and malformed scores invalidate
the judgment. Raw provider errors are not included in reports. Usage unavailable
after a transport/parsing failure is null, not zero. Cancellation stops further
cases and aborts the active call. There are no web tools or database writes.

## Aggregate, compare and calibrate

`aggregateEvaluations(reports)` returns means with assessed/total denominators,
verdict counts and an overall mean only when every case has all scores. It rejects
duplicate scenario/candidate pairs and mixed pipeline versions or judge/rubric identities.
`compareEvaluations(baseline, candidate)` returns criterion deltas for paired
scenarios and rejects changed evidence, expectations, rubrics, judges or unmatched
cases. Null scores remain null. Judge identity must include a stable model/config
or reviewer-batch identifier; the CLI fingerprints the supplied configuration.

All scenario content is untrusted data in the judge prompt. Embedded instructions
do not authorize tool use or change the rubric. Tests verify prompt separation and
response validation, not proof that a live model resists every injection. Exact
quotes establish traceability, not correctness of semantic judgment. Grounding
means support in supplied documents, not independent real-world verification.

Before using the evaluator as a release gate, Joseph/TL should review criteria and
thresholds, supply real scenarios, independently label a representative subset,
compare judge decisions with human judgments, and repeat runs to measure stability.
The current synthetic tests do not establish reviewer agreement or live-model quality.
