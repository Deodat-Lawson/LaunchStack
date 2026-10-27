/**
 * The claim gate: a campaign post whose claims the company's documents don't
 * back does not go out as the company until a person says so.
 *
 * The generator's claim check used to end in a percentage that read like
 * verification and stopped nothing. Now every claim carries a verdict
 * (claim-evidence: supported / contradicted / unsupported / unchecked), and
 * the routes that publish or schedule a campaign post call this first. The
 * text is checked as it will be posted — after the member's edits — so a
 * claim added in the editor is caught too. A check that cannot run blocks
 * the same way: unknown is not clean.
 *
 * The member can still post: the route takes `acknowledgeUnsupportedClaims`
 * after the screen has shown them what is unbacked.
 */
import {
    checkClaimSources,
    claimNeedsReview,
    type ClaimSupport,
} from "@launchstack/tools/claim-evidence";

import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

export interface ClaimGateClaim {
    claim: string;
    support: ClaimSupport;
    reason: string | null;
    sourceDoc: string | null;
}

export interface ClaimGateBlock {
    code: "unsupported_claims";
    /** The check could not run at all. */
    unavailable: boolean;
    claims: ClaimGateClaim[];
}

/** Null when every claim in `body` is backed by the workspace's documents. */
export async function claimGate(companyId: bigint, body: string): Promise<ClaimGateBlock | null> {
    let result;
    try {
        result = await withWorkspaceChatModels(companyId, "marketing", () =>
            checkClaimSources({ companyId: Number(companyId), message: body })
        );
    } catch (error) {
        console.warn("[brand] claim check failed before posting:", error);
        return { code: "unsupported_claims", unavailable: true, claims: [] };
    }
    const review = result.claims.filter(claimNeedsReview);
    if (review.length === 0) return null;
    return {
        code: "unsupported_claims",
        unavailable: false,
        claims: review.map(c => ({
            claim: c.claim,
            support: c.support,
            reason: c.reason ?? null,
            sourceDoc: c.match?.sourceDoc ?? null,
        })),
    };
}

export const CLAIM_GATE_MESSAGE =
    "Some claims in this post aren't backed by your documents. Review them, or confirm to post anyway.";
