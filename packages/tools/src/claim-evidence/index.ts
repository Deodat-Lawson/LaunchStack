/**
 * claim-evidence — extract factual claims from generated content and look up
 * their sources in the company knowledge base.
 *
 * Extracted from packages/features/src/marketing-pipeline/claim-verifier.ts
 * (unification PR-4), with the semantics fixed per design D4:
 *
 * - The score is named `relevance` — it is the retrieval/rerank score of the
 *   best-matching chunk, NOT a judgment that the claim is true. (The same
 *   discipline as packages/application/src/citations.ts.)
 * - "No source found" is `match: null`, no longer indistinguishable from a
 *   zero score; a failed lookup is `error: true`, no longer a magic string.
 * - `totalClaimsFound` reports how many claims the extractor saw, so callers
 *   can surface truncation instead of silently checking the first few.
 *
 * Citation anchors (packages/evidence) are deliberately not emitted yet: RAG
 * results carry a document title but no document/version ids (OQ-3). When the
 * RAG metadata gains them, `match` grows a CitationAnchor.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ResolveChatModelOptions } from "@launchstack/llm";

import { retrieveCompanySnippets, SNIPPET_POLICIES } from "../grounded-retrieval";
import { invokeToolStructured } from "../llm";

export const CLAIM_EVIDENCE_PROMPT_VERSION = "2026-08-22.1";

export const CLAIM_EVIDENCE_MODELS = {
    extraction: { route: "fast" },
} as const satisfies Record<string, ResolveChatModelOptions>;

const DEFAULT_MAX_CLAIMS = 5;
const EXCERPT_MAX_CHARS = 200;

const ClaimListSchema = z.object({
    claims: z.array(z.string()),
});

export interface ClaimSourceMatch {
    sourceDoc: string;
    /** Leading text of the best-matching chunk. */
    excerpt: string;
    /** Retrieval/rerank score of the match; null when the index reported none. */
    relevance: number | null;
}

export interface CheckedClaim {
    claim: string;
    /** The best knowledge-base match, or null when no source was found. */
    match: ClaimSourceMatch | null;
    /** True when the per-claim lookup itself failed. */
    error?: boolean;
}

export interface ClaimEvidenceResult {
    claims: CheckedClaim[];
    /** How many claims the extractor found (may exceed claims.length). */
    totalClaimsFound: number;
}

export async function checkClaimSources(args: {
    companyId: number;
    message: string;
    maxClaims?: number;
}): Promise<ClaimEvidenceResult> {
    const maxClaims = args.maxClaims ?? DEFAULT_MAX_CLAIMS;

    const { result } = await invokeToolStructured(
        CLAIM_EVIDENCE_MODELS.extraction,
        ClaimListSchema,
        [
            new SystemMessage(
                `Extract all factual claims from this marketing message. A "claim" is any specific statement about the company, product, capability, metric, or outcome. Return a JSON object with a "claims" array of strings. If no factual claims, return an empty array.`
            ),
            new HumanMessage(args.message),
        ],
        "claim_list"
    );

    const allClaims = result.claims;
    if (allClaims.length === 0) return { claims: [], totalClaimsFound: 0 };

    const claims: CheckedClaim[] = await Promise.all(
        allClaims.slice(0, maxClaims).map(claim => lookUpClaim(args.companyId, claim))
    );

    return { claims, totalClaimsFound: allClaims.length };
}

/** Look up the best knowledge-base source for a single claim. */
export async function lookUpClaim(companyId: number, claim: string): Promise<CheckedClaim> {
    try {
        const { results } = await retrieveCompanySnippets({
            companyId,
            query: claim,
            policy: SNIPPET_POLICIES.pinpoint,
            onError: "throw",
        });
        const topResult = results[0];
        if (!topResult) return { claim, match: null };

        return {
            claim,
            match: {
                sourceDoc: topResult.metadata?.documentTitle ?? "Unknown document",
                excerpt: topResult.pageContent.slice(0, EXCERPT_MAX_CHARS),
                relevance: topResult.metadata?.confidence ?? null,
            },
        };
    } catch {
        return { claim, match: null, error: true };
    }
}
