/**
 * Stage 7 — score. A deterministic rubric produces the number (design
 * §4.1 stage 7); the LLM writes the rationale from the rubric's inputs and
 * may not change it. Competitors of the seller, the seller itself and
 * excluded organisations score zero by rule.
 */
import type { Dossier, FitBreakdown, PartnerKind, PartnerOrgRecord, ProgramRecord, Territory } from "./types.js";
export interface ScoreInput {
    program: ProgramRecord;
    org: PartnerOrgRecord;
    kind: PartnerKind;
    territory: Territory | null;
    dossier: Dossier | null;
    evidenceCount: number;
    /** Newest evidence capture time, if any. */
    newestEvidenceAt: Date | null;
    /** Organisation is known from the tenant's own documents. */
    knownEntity: boolean;
    /** The seller's own name and known competitor names (lowercased). */
    sellerName: string;
    competitorNames?: string[];
    now?: Date;
}
export declare function computeFit(input: ScoreInput): FitBreakdown;
/** Risk flags derived from the dossier and the rubric — deterministic strings the UI can render. */
export declare function deriveRiskFlags(input: {
    dossier: Dossier | null;
    breakdown: FitBreakdown;
    evidenceCount: number;
    budgetExhausted: boolean;
}): string[];
/** The rationale prompt body — the model sees only rubric inputs and the summary. */
export declare function buildRationaleInput(args: {
    breakdown: FitBreakdown;
    dossierSummary: string | null;
    kind: PartnerKind;
    territory: Territory | null;
    orgName: string;
}): string;
/** Fallback rationale when no model is available or the call fails: still true, just plainer. */
export declare function templateRationale(args: {
    breakdown: FitBreakdown;
    orgName: string;
    kind: PartnerKind;
}): string;
export declare const FIT_WEIGHTS: {
    readonly categoryOverlap: 25;
    readonly territoryMatch: 20;
    readonly roleMatch: 20;
    readonly evidenceDepth: 15;
    readonly freshness: 5;
    readonly sizeFit: 5;
    readonly knownSignal: 10;
};
//# sourceMappingURL=score.d.ts.map