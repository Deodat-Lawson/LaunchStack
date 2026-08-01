import { 
  evaluateFounderWeeklyReview,
  type EvaluationFailure,
} from "../evaluation";
import { benchmarkCases } from "./cases";
import { 
  FounderWeeklyReviewV2PayloadSchema,
  type FounderWeeklyReviewV2Payload,
} from "../contracts";
import { generateFounderWeeklyReview } from "@launchstack/features/founder-weekly-review";
import { writeFileSync } from "fs";

let passedCount = 0;
let failedCount = 0;

let hardFailureCount = 0;

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
};

const results: BenchmarkResult[] = [];

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

  const schemaResult = FounderWeeklyReviewV2PayloadSchema.safeParse(
    generatedReport
  );

  if (!schemaResult.success) {
    
    const passed =
      testCase.expectations.expectedFailureCategories?.includes(
        "malformed_payload"
      ) ?? false;

    console.log(
      `${passed ? "✅" : "❌"} ${testCase.id} (schema validation failure)`
    );

    if (!passed) {
      console.log(JSON.stringify({
        case: testCase.id,
        expected: testCase.expectations.expectedFailureCategories,
        actual: "malformed_payload",
        zodErrors: schemaResult.error.issues,
      }, null, 2));
    }

    results.push({
      case: testCase.id,
      passed,
      score: 0,
      hasHardFailure: true,
      failures: [
        {
          category: "malformed_payload",
          explanation: "Report failed schema validation.",
        },
      ],
    });

    // Malformed payload cases are expected failures, but still count as hard failures.
    hardFailureCount++;

    if (passed) {
      passedCount++;
    } else {
      failedCount++;
    }

    continue;
  }

  const result = evaluateFounderWeeklyReview(
    testCase.evidenceSnapshot,
    generatedReport
  );

  const actualFailures = result.failures.map(f => f.category);

  const passed =
    testCase.expectations.shouldPass
      ? actualFailures.length === 0
      : testCase.expectations.expectedFailureCategories?.every(
        category => actualFailures.includes(category)
      ) ?? false;

  if (result.hasHardFailure) {
    hardFailureCount++;
  }

  if (passed) {
    passedCount++;
  } else {
    failedCount++;
  }

  results.push({
    case: testCase.id,
    passed,
    score: result.overallScore,
    hasHardFailure: result.hasHardFailure,
    metrics: result.deterministic,
    failures: result.failures,
  });

  console.log(
    `${passed ? "✅" : "❌"} ${testCase.id}`
  );

  if (!passed) {
    console.log(JSON.stringify({
      case:testCase.id,
      passed: passed,
      score:result.overallScore,
      failures:result.failures
    },null,2));
  }
}

const averageScore =
  results.length === 0
    ? 0
    : results.reduce(
        (sum, result) => sum + result.score,
        0
      ) / results.length;

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
    passed: passedCount,
    failed: failedCount,
    hardFailures: hardFailureCount,
    passRate: benchmarkCases.length === 0
      ? 0
      : passedCount / benchmarkCases.length,
    overallScore: averageScore,
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

writeFileSync("packages/features/src/founder-weekly-review/benchmarks/baseline-output.json", JSON.stringify(benchmarkOutput, null, 2));

process.exitCode = failedCount > 0 ? 1 : 0;