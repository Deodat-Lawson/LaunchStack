/**
 * Types for the agent evaluation framework.
 */

export type EvalDomain = 'predictive-analysis' | 'document-qa';

export type EvalScenario = {
    id: string;
    name: string;
    domain: EvalDomain;
    description: string;
    input: EvalInput;
    expected: EvalExpected;
};

export type EvalInput = {
    chunks: Array<{ content: string; page: number; sectionHeading?: string }>;
    question?: string;
    analysisType?: string;
};

export type EvalExpected = {
    missingDocuments?: Array<{
        documentName: string;
        priority: 'high' | 'medium' | 'low';
    }>;
    shouldContain?: string[];
    shouldNotContain?: string[];
    minInsightCount?: number;
    maxInsightCount?: number;
    expectedCategories?: string[];
};

export type EvalMetric = {
    name: string;
    score: number;
    maxScore: number;
    details?: string;
};

export type EvalResult = {
    scenarioId: string;
    scenarioName: string;
    domain: EvalDomain;
    passed: boolean;
    metrics: EvalMetric[];
    overallScore: number;
    duration: number;
    errors?: string[];
};

export type EvalReport = {
    timestamp: string;
    totalScenarios: number;
    passed: number;
    failed: number;
    overallScore: number;
    byDomain: Record<EvalDomain, {
        total: number;
        passed: number;
        score: number;
    }>;
    results: EvalResult[];
};
