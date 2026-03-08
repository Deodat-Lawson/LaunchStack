/**
 * Agent Eval Runner
 *
 * Runs all golden test scenarios against the agent guardrails and
 * deterministic extractors. Outputs a summary report to stdout.
 *
 * Usage:
 *   npx tsx scripts/run-evals.ts
 */

import { EVAL_SCENARIOS, runEvals } from '~/lib/agents/evals';

function main() {
    console.log('=== PDR AI Agent Eval Suite ===\n');
    console.log(`Running ${EVAL_SCENARIOS.length} scenarios...\n`);

    const report = runEvals(EVAL_SCENARIOS);

    console.log('--- Results ---\n');

    for (const result of report.results) {
        const status = result.passed ? 'PASS' : 'FAIL';
        const icon = result.passed ? '✓' : '✗';
        console.log(`  ${icon} [${status}] ${result.scenarioName} (${result.domain}) — score: ${result.overallScore}, ${result.duration}ms`);

        for (const metric of result.metrics) {
            console.log(`      ${metric.name}: ${metric.score}/${metric.maxScore}${metric.details ? ` (${metric.details})` : ''}`);
        }

        if (result.errors) {
            for (const err of result.errors) {
                console.log(`      ERROR: ${err}`);
            }
        }
        console.log();
    }

    console.log('--- Summary ---\n');
    console.log(`  Total:  ${report.totalScenarios}`);
    console.log(`  Passed: ${report.passed}`);
    console.log(`  Failed: ${report.failed}`);
    console.log(`  Score:  ${report.overallScore}\n`);

    console.log('  By Domain:');
    for (const [domain, stats] of Object.entries(report.byDomain)) {
        if (stats.total === 0) continue;
        console.log(`    ${domain}: ${stats.passed}/${stats.total} passed (score: ${stats.score})`);
    }

    console.log(`\n  Timestamp: ${report.timestamp}\n`);

    process.exit(report.failed > 0 ? 1 : 0);
}

main();
