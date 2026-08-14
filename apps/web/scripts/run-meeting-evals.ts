#!/usr/bin/env tsx
/**
 * Runs the meeting evaluation suite and prints a report.
 *
 *   pnpm --filter @launchstack/web evals:meetings
 *
 * Exits non-zero when a scenario stops behaving the way it is documented to,
 * or when the separation between good and bad meetings collapses — either is a
 * regression in the orchestrator or in the scorer, and both should fail CI.
 *
 * `--json` prints the machine-readable report instead, for trend tracking.
 */

import { formatMeetingEvalRun, runMeetingEvals } from "~/lib/agents/evals/meeting-runner";

/** The separation the suite is expected to maintain between good and bad. */
const MIN_SEPARATION = 0.2;
const MIN_POSITIVE_MEAN = 0.8;

async function main(): Promise<void> {
  const run = await runMeetingEvals();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    console.log(formatMeetingEvalRun(run));
  }

  const separation = run.positiveMeanScore - run.negativeMeanScore;
  const problems: string[] = [];

  if (run.violations.length > 0) {
    problems.push(
      `${run.violations.length} scenario(s) no longer behave as documented: ` +
        run.violations.map((v) => v.scenarioId).join(", "),
    );
  }
  if (run.positiveMeanScore < MIN_POSITIVE_MEAN) {
    problems.push(`good meetings averaged ${run.positiveMeanScore} (floor ${MIN_POSITIVE_MEAN})`);
  }
  if (separation < MIN_SEPARATION) {
    problems.push(
      `only ${Math.round(separation * 1000) / 1000} separates good from bad meetings (floor ${MIN_SEPARATION})`,
    );
  }

  if (problems.length > 0) {
    console.error(`\nEvaluation failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }

  console.log("\nEvaluation passed.");
}

main().catch((err: unknown) => {
  console.error(`[evals] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
