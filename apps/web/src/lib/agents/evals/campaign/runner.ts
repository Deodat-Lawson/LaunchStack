/**
 * Campaign eval runner.
 *
 * Executes the deterministic criteria declared on a fixture against a
 * GeneratedOutput and aggregates the CriterionScores. Deliberately does NOT
 * call the Campaign Planner itself — generation is the caller's job, so this
 * runner stays pure and testable without API keys.
 */

import {
    toEvalMetric,
    type CriterionScore,
    type EvalContext,
    type Fixture,
    type GeneratedOutput,
    type Severity,
} from "@schema";

import { ASSERTIONS, getAssertion } from "./assertions";

export type CampaignEvalResult = {
    fixtureId: string;
    fixtureName: string;
    companyId: string;
    platform: string;
    passed: boolean;
    /** Mean of all criterion scores, 0..1. */
    overallScore: number;
    scores: CriterionScore[];
    /** Criteria that failed at `error` severity — these decide `passed`. */
    blocking: CriterionScore[];
    errors: string[];
};

export type CampaignEvalReport = {
    totalFixtures: number;
    passed: number;
    failed: number;
    overallScore: number;
    results: CampaignEvalResult[];
};

/**
 * Run one fixture's criteria. When a fixture declares no criteria, every
 * registered assertion runs — they self-skip when unconfigured, so this gives
 * broad coverage by default without per-fixture boilerplate.
 */
export function runFixture(
    fixture: Fixture,
    output: GeneratedOutput,
    context: EvalContext
): CampaignEvalResult {
    const scores: CriterionScore[] = [];
    const errors: string[] = [];

    const specs =
        fixture.criteria.length > 0
            ? fixture.criteria.filter(c => c.enabled)
            : ASSERTIONS.map(a => ({
                  assertion: a.id,
                  id: null as string | null,
                  enabled: true,
                  severity: "error" as Severity,
                  params: {} as Record<string, unknown>,
              }));

    for (const spec of specs) {
        const assertion = getAssertion(spec.assertion);
        if (!assertion) {
            errors.push(`unknown assertion "${spec.assertion}"`);
            continue;
        }
        try {
            const score = assertion.run(output, context, spec.params);
            scores.push({
                ...score,
                criterionId: spec.id ?? score.criterionId,
                severity: spec.severity,
            });
        } catch (err) {
            // An assertion that throws is a bug in the assertion, not a fixture
            // failure — record it loudly rather than silently dropping coverage.
            errors.push(
                `assertion "${spec.assertion}" threw: ${
                    err instanceof Error ? err.message : String(err)
                }`
            );
        }
    }

    const blocking = scores.filter(s => !s.passed && s.severity === "error");
    const overallScore =
        scores.length === 0
            ? 1
            : Math.round((scores.reduce((sum, s) => sum + s.score, 0) / scores.length) * 100) / 100;

    return {
        fixtureId: fixture.id,
        fixtureName: fixture.name,
        companyId: fixture.companyId,
        platform: fixture.platform,
        passed: errors.length === 0 && blocking.length === 0,
        overallScore,
        scores,
        blocking,
        errors,
    };
}

/** Aggregate several fixture results into a report. */
export function buildReport(results: CampaignEvalResult[]): CampaignEvalReport {
    const passed = results.filter(r => r.passed).length;
    const overallScore =
        results.length === 0
            ? 1
            : Math.round(
                  (results.reduce((sum, r) => sum + r.overallScore, 0) / results.length) * 100
              ) / 100;
    return {
        totalFixtures: results.length,
        passed,
        failed: results.length - passed,
        overallScore,
        results,
    };
}

/** Bridge criterion scores into the shape the pre-existing runner aggregates. */
export function toEvalMetrics(result: CampaignEvalResult) {
    return result.scores.map(toEvalMetric);
}
