/** Draft contract for claim verification; not yet wired into the proposals stages. */
export type ClaimVerdict = "supported" | "unsupported" | "stale" | "conflict" | "unverified";

export interface Claim {
    id: string;
    text: string;
    /** Sentence hash for edit invalidation. */
    textHash: string;
    /** Indexes in this draft's evidence list. */
    cites: number[];
    needsEvidence: boolean;
    verdict: ClaimVerdict;
    detail: string | null;
    verifiedAt: string | null;
}
