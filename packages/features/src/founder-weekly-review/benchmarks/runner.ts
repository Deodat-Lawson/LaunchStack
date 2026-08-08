import { 
  evaluateFounderWeeklyReview,
  type EvaluationFailure,
} from "../evaluation";
import { benchmarkCases } from "./cases";
import { 
  type FounderWeeklyReviewV2Payload,
} from "../contracts";
import { 
  generateFounderWeeklyReview,
  type FounderWeeklyReviewGenerateFn,
} from "@launchstack/features/founder-weekly-review";
import { writeFileSync } from "fs";
import type { LLMGraderResult } from "../llm-grader";
import path from "path";
import { evaluateGeneratedFounderWeeklyReview } from "./evaluate-generated-review";

type BenchmarkMetrics = {
  citationValidity: number;
  citationCoverage: number;
  unsupportedClaimRate: number;
  unsupportedShippedClaimRate: number;
  sourceTypeViolationRate: number;
  evidenceCoverage: number;
  duplicateClaimRate: number;
  emptySectionCorrectness: number;
};

type BenchmarkResult = {
  case: string;
  passed: boolean;
  score: number;
  hasHardFailure: boolean;
  metrics?: BenchmarkMetrics;
  failures: EvaluationFailure[];
  llmGrader?: LLMGraderResult;
};

type BenchmarkState = {
  passedCount: number;
  failedCount: number;
  hardFailureCount: number;
};

export async function runBenchmarks(
  generate: FounderWeeklyReviewGenerateFn,
  results: BenchmarkResult[],
  state: BenchmarkState
): Promise<void> {
  for (const testCase of benchmarkCases) {

    if (!testCase.generatedReport) {
      continue;
    }

    let generatedReport: FounderWeeklyReviewV2Payload;

    if(testCase.runThroughGeneration) {
      const generated = await generateFounderWeeklyReview({
        evidenceSnapshot: testCase.evidenceSnapshot,
        generate: async ({schema}) => ({
          object: schema.parse(testCase.generatedReport),
          metadata: {
            provider: "benchmark",
            model: "fixture",
            capability: "founderWeeklyReview",
            temperature: 0,
          },
        }),
      });
      
      generatedReport = generated.reviewPayload;

    } else {
      generatedReport = testCase.generatedReport;
    }

    const evaluation = await evaluateGeneratedFounderWeeklyReview(
      testCase.evidenceSnapshot,
      generatedReport,
      generate
    );

    if (evaluation.deterministic === null) {
      const passed =
        testCase.expectations.expectedFailureCategories?.includes(
          "malformed_payload"
        ) ?? false;

      results.push({
        case: testCase.id,
        passed,
        score: 0,
        hasHardFailure: true,
        failures: evaluation.failures,
      });

      state.hardFailureCount++;

      if (passed) {
        state.passedCount++;
      } else {
        state.failedCount++;
      }

      console.log(
        `${passed ? "✅" : "❌"} ${testCase.id} (schema validation failure)`
      );

      continue;
    }

    const result = evaluation.deterministic;
    const llmGrade = evaluation.llmGrader ?? undefined;

    const actualFailures = result.failures.map(f => f.category);

    const passed =
      testCase.expectations.shouldPass
        ? actualFailures.length === 0
        : testCase.expectations.expectedFailureCategories?.every(
          category => actualFailures.includes(category)
        ) ?? false;

    if (result.hasHardFailure) {
      state.hardFailureCount++;
    }

    if (passed) {
      state.passedCount++;
    } else {
      state.failedCount++;
    }

    results.push({
      case: testCase.id,
      passed,
      score: result.overallScore,
      hasHardFailure: result.hasHardFailure,
      metrics: result.deterministic,
      failures: result.failures,
      llmGrader: llmGrade,
    });

    console.log(
      `${passed ? "✅" : "❌"} ${testCase.id}`
    );

    if (!passed) {
      console.log(JSON.stringify({
        case: testCase.id,
        deterministicFailures: result.failures,
        llmGrader: llmGrade,
      }, null, 2));
    }
  }
}

export async function main(generate: FounderWeeklyReviewGenerateFn) {
  const results: BenchmarkResult[] = [];

  const state: BenchmarkState = {
    passedCount: 0,
    failedCount: 0,
    hardFailureCount: 0
  };

  await runBenchmarks(generate, results, state);

  const averageScore =
    results.length === 0
      ? 0
      : results.reduce(
          (sum, result) => sum + result.score,
          0
        ) / results.length;

  const llmScores = results
    .map(r => r.llmGrader?.overallScore)
    .filter((v): v is number => v !== undefined);

  const averageLLMScore =
    llmScores.length === 0
      ? 0
      : llmScores.reduce((sum, v) => sum + v, 0) / llmScores.length;

  const averageMetric = (key: keyof BenchmarkMetrics) => {
    const values = results
      .map(result => result.metrics?.[key])
      .filter((value): value is number => value !== undefined);

    return values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const weakestCases = [...results]
    .sort((a,b) => a.score - b.score)
    .slice(0,3)
    .map(result => ({
      case: result.case,
      score: result.score,
      failures: result.failures.map(f => f.category),
    }));

  const failureCounts = results
    .flatMap(result => result.failures)
    .reduce<Record<string, number>>((acc, failure) => {
      acc[failure.category] =
        (acc[failure.category] ?? 0) + 1;

      return acc;
    }, {});

  const benchmarkOutput = {
    summary: {
      totalCases: benchmarkCases.length,
      passed: state.passedCount,
      failed: state.failedCount,
      hardFailures: state.hardFailureCount,
      passRate: benchmarkCases.length === 0
        ? 0
        : state.passedCount / benchmarkCases.length,
      deterministicScore: averageScore,
      llmScore: averageLLMScore,
    },
    metrics: {
      citationValidity: averageMetric("citationValidity"),
      citationCoverage: averageMetric("citationCoverage"),
      unsupportedClaimRate: averageMetric("unsupportedClaimRate"),
      unsupportedShippedClaimRate: averageMetric("unsupportedShippedClaimRate"),
      sourceTypeViolationRate: averageMetric("sourceTypeViolationRate"),
      evidenceCoverage: averageMetric("evidenceCoverage"),
      emptySectionCorrectness: averageMetric("emptySectionCorrectness"),
      duplicateClaimRate: averageMetric("duplicateClaimRate"),
    },
    weakestCases,
    commonFailures: failureCounts,
    cases: results,
  };

  console.log("\n===== Benchmark Summary =====");

  console.log(JSON.stringify(benchmarkOutput, null, 2));

  const outputPath = path.resolve(
    import.meta.dirname,
    "./baseline-output.json"
  );

  writeFileSync(
    outputPath,
    JSON.stringify(benchmarkOutput, null, 2)
  );

  process.exitCode = state.failedCount > 0 ? 1 : 0;
}