/**
 * Confidence gate guardrail — detects when the model expresses low confidence
 * or contradicts itself within a single response.
 */

export type ConfidenceGateResult = {
    passed: boolean;
    lowConfidenceDetected: boolean;
    contradictionDetected: boolean;
    flags: string[];
};

const LOW_CONFIDENCE_PHRASES = [
    "i'm not sure",
    "i am not sure",
    "i don't know",
    "i do not know",
    "i cannot determine",
    "unable to determine",
    "insufficient information",
    "not enough information",
    "i cannot confidently",
    "this is unclear",
    "it is unclear from",
    "i lack the context",
    "without more information",
    "i would need more",
    "cannot be determined from",
    "this is speculative",
    "purely speculative",
];

const CONTRADICTION_PAIRS: Array<[RegExp, RegExp]> = [
    [/\bis\s+required\b/i, /\bis\s+(?:not\s+required|optional)\b/i],
    [/\bmust\b/i, /\bneed\s+not\b/i],
    [/\byes[,.]?\s/i, /\bno[,.]?\s/i],
    [/\bis\s+included\b/i, /\bis\s+(?:not\s+included|missing)\b/i],
    [/\bexists?\b/i, /\bdoes\s+not\s+exist\b/i],
];

export function checkConfidence(response: string): ConfidenceGateResult {
    const lower = response.toLowerCase();
    const flags: string[] = [];

    const matchedPhrases = LOW_CONFIDENCE_PHRASES.filter(p => lower.includes(p));
    const lowConfidenceDetected = matchedPhrases.length > 0;
    if (lowConfidenceDetected) {
        flags.push(`Low confidence: "${matchedPhrases[0]}"`);
    }

    let contradictionDetected = false;
    for (const [patternA, patternB] of CONTRADICTION_PAIRS) {
        if (patternA.test(response) && patternB.test(response)) {
            contradictionDetected = true;
            flags.push(`Potential contradiction detected (${patternA.source} vs ${patternB.source})`);
            break;
        }
    }

    const excessiveHedging = (lower.match(/\b(?:maybe|perhaps|possibly|might|could)\b/g) ?? []).length;
    if (excessiveHedging > 5) {
        flags.push(`Excessive hedging (${excessiveHedging} instances)`);
    }

    return {
        passed: !lowConfidenceDetected && !contradictionDetected && excessiveHedging <= 5,
        lowConfidenceDetected,
        contradictionDetected,
        flags,
    };
}
