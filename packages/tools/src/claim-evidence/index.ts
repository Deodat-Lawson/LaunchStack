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
 * 2026-10: the lookup alone was being read as verification — a percentage
 * next to a claim, green when anything similar was found. A claim now also
 * carries `support`, a judgment of whether the retrieved passages actually
 * state it (one model call over every claim and its passages):
 *
 * - "supported": a passage states it;
 * - "contradicted": a passage says otherwise;
 * - "unsupported": nothing retrieved states it (including no match at all);
 * - "unchecked": the lookup or the judgment failed, so nobody knows.
 *
 * Anything but "supported" needs a human to look before it is posted
 * (`claimNeedsReview`); the publish routes enforce that.
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

export const CLAIM_EVIDENCE_PROMPT_VERSION = "2026-10-24.1";

export const CLAIM_EVIDENCE_MODELS = {
    extraction: { route: "fast" },
    judgment: { route: "fast" },
} as const satisfies Record<string, ResolveChatModelOptions>;

const DEFAULT_MAX_CLAIMS = 5;
const EXCERPT_MAX_CHARS = 200;
/** How much of each retrieved passage the judgment reads. */
const EVIDENCE_MAX_CHARS = 700;

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

export const CLAIM_SUPPORT = ["supported", "contradicted", "unsupported", "unchecked"] as const;
export type ClaimSupport = (typeof CLAIM_SUPPORT)[number];

export interface CheckedClaim {
    claim: string;
    /** The best knowledge-base match, or null when no source was found. */
    match: ClaimSourceMatch | null;
    /** True when the per-claim lookup itself failed. */
    error?: boolean;
    /** Whether the retrieved passages actually state the claim (see the header). */
    support: ClaimSupport;
    /** One sentence on why, from the judgment; absent when there was nothing to judge. */
    reason?: string;
}

/** A claim a person must look at before the post goes out. */
export function claimNeedsReview(claim: Pick<CheckedClaim, "support">): boolean {
    return claim.support !== "supported";
}

const JudgmentSchema = z.object({
    verdicts: z.array(
        z.object({
            index: z.number().int(),
            verdict: z.enum(["supported", "contradicted", "unsupported"]),
            reason: z.string(),
        })
    ),
});

interface LookedUpClaim {
    checked: Omit<CheckedClaim, "support">;
    /** The passages the judgment reads (longer than the excerpt shown). */
    evidence: string[];
}

export interface ClaimEvidenceResult {
    claims: CheckedClaim[];
    /** How many claims the extractor found (may exceed claims.length). */
    totalClaimsFound: number;
    /** The check itself could not run: no claims is "unknown", not "clean". */
    unavailable?: boolean;
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

    const looked = await Promise.all(
        allClaims.slice(0, maxClaims).map(claim => lookUpClaimEvidence(args.companyId, claim))
    );
    const claims = await judgeClaims(looked);
    return { claims, totalClaimsFound: allClaims.length };
}

/**
 * Ask whether each claim's passages state it. Claims with no passage are
 * "unsupported" without asking; claims whose lookup failed are "unchecked".
 * A failed judgment marks what it was asked about "unchecked" — never
 * "supported".
 */
export async function judgeClaims(looked: readonly LookedUpClaim[]): Promise<CheckedClaim[]> {
    const out: CheckedClaim[] = looked.map(({ checked, evidence }) =>
        checked.error
            ? { ...checked, support: "unchecked" }
            : evidence.length === 0
              ? { ...checked, support: "unsupported" }
              : { ...checked, support: "unchecked" }
    );
    const asked = looked
        .map((l, index) => ({ ...l, index }))
        .filter(l => !l.checked.error && l.evidence.length > 0);
    if (asked.length === 0) return out;

    const prompt = asked
        .map(
            l =>
                `Claim ${l.index}: ${l.checked.claim}\n` +
                l.evidence.map((e, j) => `  Passage ${l.index}.${j + 1}: ${e}`).join("\n")
        )
        .join("\n\n");
    try {
        const { result } = await invokeToolStructured(
            CLAIM_EVIDENCE_MODELS.judgment,
            JudgmentSchema,
            [
                new SystemMessage(
                    `You check marketing claims against a company's own documents. For each claim, read only its passages and answer: "supported" if a passage states the claim (the same fact, number and scope — a related or similar statement is not enough), "contradicted" if a passage states something incompatible, otherwise "unsupported". Do not use outside knowledge. Give a one-sentence reason quoting the passage when there is one. Return {"verdicts":[{"index","verdict","reason"}]} with one verdict per claim index.`
                ),
                new HumanMessage(prompt),
            ],
            "claim_judgment"
        );
        for (const verdict of result.verdicts) {
            const target = out[verdict.index];
            if (!target || !asked.some(a => a.index === verdict.index)) continue;
            out[verdict.index] = {
                ...target,
                support: verdict.verdict,
                reason: verdict.reason.trim() || undefined,
            };
        }
    } catch {
        // Leave them "unchecked": a failed judgment must never read as support.
    }
    return out;
}

/** Look up the best knowledge-base source for a single claim. */
export async function lookUpClaim(
    companyId: number,
    claim: string
): Promise<Omit<CheckedClaim, "support">> {
    return (await lookUpClaimEvidence(companyId, claim)).checked;
}

async function lookUpClaimEvidence(companyId: number, claim: string): Promise<LookedUpClaim> {
    try {
        const { results } = await retrieveCompanySnippets({
            companyId,
            query: claim,
            policy: SNIPPET_POLICIES.pinpoint,
            onError: "throw",
        });
        const topResult = results[0];
        if (!topResult) return { checked: { claim, match: null }, evidence: [] };

        return {
            checked: {
                claim,
                match: {
                    sourceDoc: topResult.metadata?.documentTitle ?? "Unknown document",
                    excerpt: topResult.pageContent.slice(0, EXCERPT_MAX_CHARS),
                    relevance: topResult.metadata?.confidence ?? null,
                },
            },
            evidence: results.map(r => r.pageContent.slice(0, EVIDENCE_MAX_CHARS)),
        };
    } catch {
        return { checked: { claim, match: null, error: true }, evidence: [] };
    }
}
