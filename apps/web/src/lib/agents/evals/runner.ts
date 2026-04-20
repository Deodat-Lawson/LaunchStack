/**
 * Eval runner — executes test scenarios against agent outputs
 * using deterministic checks (no LLM required for basic evals).
 */

import { extractDeterministicInsights } from '~/app/api/agents/predictive-document-analysis/utils/insightExtractors';
import { runGuardrails } from '~/lib/agents/guardrails';
import type { EvalScenario, EvalResult, EvalMetric, EvalReport, EvalDomain } from './types';
import type { PdfChunk } from '~/app/api/agents/predictive-document-analysis/types';

/**
 * Run deterministic eval for a predictive analysis scenario.
 * Tests the insight extractors and guardrails without making LLM calls.
 */
function evalPredictiveAnalysis(scenario: EvalScenario): EvalResult {
    const start = Date.now();
    const metrics: EvalMetric[] = [];
    const errors: string[] = [];

    try {
        const chunks: PdfChunk[] = scenario.input.chunks.map((c, i) => ({
            id: i,
            content: c.content,
            page: c.page,
            sectionHeading: c.sectionHeading ?? null,
        }));

        const insights = extractDeterministicInsights(chunks);

        if (scenario.expected.minInsightCount !== undefined) {
            const met = insights.length >= scenario.expected.minInsightCount;
            metrics.push({
                name: 'Min Insight Count',
                score: met ? 1 : 0,
                maxScore: 1,
                details: `Expected >= ${scenario.expected.minInsightCount}, got ${insights.length}`,
            });
        }

        if (scenario.expected.maxInsightCount !== undefined) {
            const met = insights.length <= scenario.expected.maxInsightCount;
            metrics.push({
                name: 'Max Insight Count',
                score: met ? 1 : 0,
                maxScore: 1,
                details: `Expected <= ${scenario.expected.maxInsightCount}, got ${insights.length}`,
            });
        }

        if (scenario.expected.expectedCategories) {
            const foundCategories = new Set(insights.map(i => i.category));
            let catScore = 0;
            for (const cat of scenario.expected.expectedCategories) {
                if (foundCategories.has(cat as never)) catScore++;
            }
            metrics.push({
                name: 'Category Coverage',
                score: catScore,
                maxScore: scenario.expected.expectedCategories.length,
                details: `Found: ${[...foundCategories].join(', ')}`,
            });
        }

        const sourceTexts = chunks.map(c => c.content);
        const guardrailResult = runGuardrails(
            insights.map(i => `${i.title}: ${i.detail}`).join('\n'),
            sourceTexts,
        );
        metrics.push({
            name: 'Guardrails Pass',
            score: guardrailResult.passed ? 1 : 0,
            maxScore: 1,
            details: guardrailResult.warnings.join('; ') || 'All passed',
        });

        if (scenario.expected.shouldContain) {
            const fullText = chunks.map(c => c.content).join(' ').toLowerCase();
            let containScore = 0;
            for (const term of scenario.expected.shouldContain) {
                if (fullText.includes(term.toLowerCase())) containScore++;
            }
            metrics.push({
                name: 'Source Contains Expected Terms',
                score: containScore,
                maxScore: scenario.expected.shouldContain.length,
                details: `Checked: ${scenario.expected.shouldContain.join(', ')}`,
            });
        }

    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
    }

    const totalScore = metrics.reduce((s, m) => s + m.score, 0);
    const maxScore = metrics.reduce((s, m) => s + m.maxScore, 0);

    return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        domain: scenario.domain,
        passed: errors.length === 0 && (maxScore === 0 || totalScore / maxScore >= 0.7),
        metrics,
        overallScore: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) / 100 : 1,
        duration: Date.now() - start,
        errors: errors.length > 0 ? errors : undefined,
    };
}

/**
 * Run deterministic eval for a Q&A scenario (checks guardrails only; 
 * full LLM-based eval requires the runner script with API keys).
 */
function evalDocumentQA(scenario: EvalScenario): EvalResult {
    const start = Date.now();
    const metrics: EvalMetric[] = [];
    const errors: string[] = [];

    try {
        const sourceTexts = scenario.input.chunks.map(c => c.content);

        const guardrailResult = runGuardrails(
            sourceTexts.join('\n'),
            sourceTexts,
        );
        metrics.push({
            name: 'Source Guardrails',
            score: guardrailResult.passed ? 1 : 0,
            maxScore: 1,
        });

        if (scenario.expected.shouldContain) {
            const fullText = sourceTexts.join(' ').toLowerCase();
            let containScore = 0;
            for (const term of scenario.expected.shouldContain) {
                if (fullText.includes(term.toLowerCase())) containScore++;
            }
            metrics.push({
                name: 'Source Contains Expected Answer',
                score: containScore,
                maxScore: scenario.expected.shouldContain.length,
                details: `Checked: ${scenario.expected.shouldContain.join(', ')}`,
            });
        }
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
    }

    const totalScore = metrics.reduce((s, m) => s + m.score, 0);
    const maxScore = metrics.reduce((s, m) => s + m.maxScore, 0);

    return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        domain: scenario.domain,
        passed: errors.length === 0 && (maxScore === 0 || totalScore / maxScore >= 0.7),
        metrics,
        overallScore: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) / 100 : 1,
        duration: Date.now() - start,
        errors: errors.length > 0 ? errors : undefined,
    };
}

const DOMAIN_RUNNERS: Record<EvalDomain, (s: EvalScenario) => EvalResult> = {
    'predictive-analysis': evalPredictiveAnalysis,
    'document-qa': evalDocumentQA,
};

/**
 * Run all eval scenarios and produce a report.
 */
export function runEvals(scenarios: EvalScenario[]): EvalReport {
    const results: EvalResult[] = [];

    for (const scenario of scenarios) {
        const runner = DOMAIN_RUNNERS[scenario.domain];
        results.push(runner(scenario));
    }

    const passed = results.filter(r => r.passed).length;
    const totalScore = results.reduce((s, r) => s + r.overallScore, 0);

    const byDomain: EvalReport['byDomain'] = {
        'predictive-analysis': { total: 0, passed: 0, score: 0 },
        'document-qa': { total: 0, passed: 0, score: 0 },
    };

    for (const r of results) {
        const d = byDomain[r.domain];
        d.total++;
        if (r.passed) d.passed++;
        d.score += r.overallScore;
    }

    for (const d of Object.values(byDomain)) {
        if (d.total > 0) d.score = Math.round((d.score / d.total) * 100) / 100;
    }

    return {
        timestamp: new Date().toISOString(),
        totalScenarios: scenarios.length,
        passed,
        failed: scenarios.length - passed,
        overallScore: scenarios.length > 0 ? Math.round((totalScore / scenarios.length) * 100) / 100 : 1,
        byDomain,
        results,
    };
}
