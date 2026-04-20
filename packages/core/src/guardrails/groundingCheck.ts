/**
 * Grounding check guardrail — verifies that agent claims are traceable
 * to source chunks using keyword overlap and structural matching.
 */

import stringSimilarity from 'string-similarity-js';

export type GroundingCheckResult = {
    passed: boolean;
    overallScore: number;
    ungroundedClaims: string[];
    totalClaimsChecked: number;
};

const CLAIM_SPLITTER = /(?<=[.!?])\s+(?=[A-Z])/;

const HEDGING_PHRASES = [
    'it is possible',
    'it appears',
    'this may',
    'this might',
    'potentially',
    'it seems',
    'could be',
    'likely',
];

const META_PHRASES = [
    'based on the document',
    'according to the provided',
    'the document states',
    'as mentioned in',
    'the content indicates',
    'from the source',
];

function isMetaOrHedging(claim: string): boolean {
    const lower = claim.toLowerCase();
    return META_PHRASES.some(p => lower.includes(p)) ||
           HEDGING_PHRASES.some(p => lower.includes(p));
}

function extractKeyTerms(text: string): Set<string> {
    return new Set(
        text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3)
    );
}

/**
 * Check whether an agent response is grounded in the provided source chunks.
 * Uses keyword overlap plus string similarity — no LLM call required.
 */
export function checkGrounding(
    response: string,
    sourceChunks: string[],
    threshold = 0.3,
): GroundingCheckResult {
    if (!response || sourceChunks.length === 0) {
        return { passed: true, overallScore: 1, ungroundedClaims: [], totalClaimsChecked: 0 };
    }

    const fullSource = sourceChunks.join(' ').toLowerCase();
    const sourceTerms = extractKeyTerms(fullSource);
    const claims = response.split(CLAIM_SPLITTER).filter(c => c.trim().length > 20);

    if (claims.length === 0) {
        return { passed: true, overallScore: 1, ungroundedClaims: [], totalClaimsChecked: 0 };
    }

    const ungroundedClaims: string[] = [];
    let totalScore = 0;

    for (const claim of claims) {
        if (isMetaOrHedging(claim)) {
            totalScore += 1;
            continue;
        }

        const claimTerms = extractKeyTerms(claim);
        let overlap = 0;
        for (const term of claimTerms) {
            if (sourceTerms.has(term)) overlap++;
        }
        const keywordScore = claimTerms.size > 0 ? overlap / claimTerms.size : 0;

        let bestSimilarity = 0;
        for (const chunk of sourceChunks) {
            const sim = stringSimilarity(claim.toLowerCase().slice(0, 200), chunk.toLowerCase().slice(0, 500));
            if (sim > bestSimilarity) bestSimilarity = sim;
        }

        const combinedScore = keywordScore * 0.6 + bestSimilarity * 0.4;
        totalScore += combinedScore;

        if (combinedScore < threshold) {
            ungroundedClaims.push(claim.trim().slice(0, 120));
        }
    }

    const overallScore = totalScore / claims.length;

    return {
        passed: ungroundedClaims.length <= Math.ceil(claims.length * 0.3),
        overallScore: Math.round(overallScore * 100) / 100,
        ungroundedClaims,
        totalClaimsChecked: claims.length,
    };
}
