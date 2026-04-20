/**
 * Agent guardrails — composable middleware for validating agent outputs
 * before they reach the user. Each guardrail can run independently.
 */

export { filterContent, type ContentFilterResult, type PIIDetection } from './contentFilter';
export { checkGrounding, type GroundingCheckResult } from './groundingCheck';
export { checkConfidence, type ConfidenceGateResult } from './confidenceGate';

import { filterContent, type ContentFilterResult } from './contentFilter';
import { checkGrounding, type GroundingCheckResult } from './groundingCheck';
import { checkConfidence, type ConfidenceGateResult } from './confidenceGate';

export type GuardrailResult = {
    passed: boolean;
    contentFilter: ContentFilterResult;
    grounding: GroundingCheckResult;
    confidence: ConfidenceGateResult;
    warnings: string[];
};

export type GuardrailOptions = {
    enableContentFilter?: boolean;
    enableGroundingCheck?: boolean;
    enableConfidenceGate?: boolean;
    groundingThreshold?: number;
};

const DEFAULT_OPTIONS: Required<GuardrailOptions> = {
    enableContentFilter: true,
    enableGroundingCheck: true,
    enableConfidenceGate: true,
    groundingThreshold: 0.3,
};

/**
 * Run all enabled guardrails on an agent response.
 * Returns a composite result with per-guardrail details.
 */
export function runGuardrails(
    response: string,
    sourceChunks: string[] = [],
    options: GuardrailOptions = {},
): GuardrailResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];

    const contentResult = opts.enableContentFilter
        ? filterContent(response)
        : { passed: true, piiDetected: [], toxicContentDetected: false };

    const groundingResult = opts.enableGroundingCheck
        ? checkGrounding(response, sourceChunks, opts.groundingThreshold)
        : { passed: true, overallScore: 1, ungroundedClaims: [], totalClaimsChecked: 0 };

    const confidenceResult = opts.enableConfidenceGate
        ? checkConfidence(response)
        : { passed: true, lowConfidenceDetected: false, contradictionDetected: false, flags: [] };

    if (!contentResult.passed) {
        if (contentResult.piiDetected.length > 0) {
            warnings.push(`PII detected: ${contentResult.piiDetected.map(p => p.type).join(', ')}`);
        }
        if (contentResult.toxicContentDetected) {
            warnings.push('Potentially harmful content detected');
        }
    }

    if (!groundingResult.passed) {
        warnings.push(
            `${groundingResult.ungroundedClaims.length} of ${groundingResult.totalClaimsChecked} claims lack source support (score: ${groundingResult.overallScore})`
        );
    }

    if (!confidenceResult.passed) {
        warnings.push(...confidenceResult.flags);
    }

    return {
        passed: contentResult.passed && groundingResult.passed && confidenceResult.passed,
        contentFilter: contentResult,
        grounding: groundingResult,
        confidence: confidenceResult,
        warnings,
    };
}
