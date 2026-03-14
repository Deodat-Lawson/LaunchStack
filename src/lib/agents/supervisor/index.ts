/**
 * Supervisor Agent — validates agent outputs against domain-specific rubrics
 * before returning results to the user. Uses guardrails for deterministic
 * checks and optionally an LLM call for deeper validation.
 */

import { runGuardrails, type GuardrailResult } from '~/lib/agents/guardrails';

export type AgentType = 'predictive-analysis' | 'document-qa';

export type SupervisorInput = {
    agentType: AgentType;
    output: string;
    sourceChunks?: string[];
    metadata?: Record<string, unknown>;
};

export type SupervisorResult = {
    approved: boolean;
    guardrails: GuardrailResult;
    issues: string[];
    adjustedOutput?: string;
    disclaimer?: string;
};

const AGENT_DISCLAIMERS: Partial<Record<AgentType, string>> = {
    'predictive-analysis': 'This analysis is AI-generated and may not capture all document references. Always verify critical findings manually.',
};

const AGENT_GUARDRAIL_CONFIG: Record<AgentType, {
    enableContentFilter: boolean;
    enableGroundingCheck: boolean;
    enableConfidenceGate: boolean;
    groundingThreshold: number;
}> = {
    'predictive-analysis': {
        enableContentFilter: true,
        enableGroundingCheck: true,
        enableConfidenceGate: false,
        groundingThreshold: 0.25,
    },
    'document-qa': {
        enableContentFilter: true,
        enableGroundingCheck: true,
        enableConfidenceGate: true,
        groundingThreshold: 0.3,
    },
};

/**
 * Validate an agent's output through the supervisor pipeline.
 * Runs deterministic guardrails and returns approval status with issues.
 */
export function validateAgentOutput(input: SupervisorInput): SupervisorResult {
    const { agentType, output, sourceChunks = [] } = input;
    const config = AGENT_GUARDRAIL_CONFIG[agentType];
    const issues: string[] = [];

    const guardrails = runGuardrails(output, sourceChunks, config);

    if (!guardrails.passed) {
        issues.push(...guardrails.warnings);
    }

    let adjustedOutput: string | undefined;
    if (guardrails.contentFilter.filteredOutput) {
        adjustedOutput = guardrails.contentFilter.filteredOutput;
    }

    const disclaimer = AGENT_DISCLAIMERS[agentType];

    return {
        approved: guardrails.passed,
        guardrails,
        issues,
        adjustedOutput,
        disclaimer,
    };
}

/**
 * Validate structured predictive analysis results.
 * Runs domain-specific checks beyond the generic guardrails.
 */
export function validatePredictiveAnalysis(
    result: {
        missingDocuments: Array<{ documentName: string; priority: string; reason: string }>;
        recommendations: string[];
        insights?: Array<{ title: string; category: string }>;
    },
    sourceChunks: string[],
): SupervisorResult {
    const issues: string[] = [];
    const sourceText = sourceChunks.join(' ').toLowerCase();

    for (const doc of result.missingDocuments) {
        if (doc.priority === 'high') {
            const nameWords = doc.documentName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const foundInSource = nameWords.some(w => sourceText.includes(w));
            if (!foundInSource) {
                issues.push(`High-priority "${doc.documentName}" may not be grounded in source text`);
            }
        }
    }

    const vaguePhrases = ['consider', 'you may want', 'it might be helpful', 'think about'];
    for (const rec of result.recommendations) {
        const lower = rec.toLowerCase();
        if (vaguePhrases.some(p => lower.startsWith(p))) {
            issues.push(`Recommendation is too vague: "${rec.slice(0, 60)}..."`);
        }
    }

    const serialized = JSON.stringify(result);
    const guardrails = runGuardrails(serialized, sourceChunks, {
        enableContentFilter: true,
        enableGroundingCheck: false,
        enableConfidenceGate: false,
    });

    if (!guardrails.passed) {
        issues.push(...guardrails.warnings);
    }

    return {
        approved: issues.length === 0 && guardrails.passed,
        guardrails,
        issues,
        disclaimer: AGENT_DISCLAIMERS['predictive-analysis'],
    };
}

/**
 * Validate Q&A response and optionally adjust output.
 */
export function validateQAResponse(
    response: string,
    sourceChunks: string[],
    persona?: string,
): SupervisorResult {
    const guardrails = runGuardrails(response, sourceChunks, AGENT_GUARDRAIL_CONFIG['document-qa']);
    const issues = [...guardrails.warnings];

    let disclaimer: string | undefined;
    if (persona === 'legal-expert') {
        disclaimer = 'This is AI-generated analysis, not legal advice. Consult a qualified attorney for legal matters.';
    } else if (persona === 'financial-expert') {
        disclaimer = 'This is AI-generated analysis, not financial advice. Consult a qualified financial advisor.';
    }

    let adjustedOutput: string | undefined;
    if (guardrails.contentFilter.filteredOutput) {
        adjustedOutput = guardrails.contentFilter.filteredOutput;
    }

    return {
        approved: guardrails.passed,
        guardrails,
        issues,
        adjustedOutput,
        disclaimer,
    };
}
