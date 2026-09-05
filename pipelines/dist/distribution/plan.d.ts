import type { DiscoveryPlan, PartnerKind, ProgramRecord, Territory } from "./types.js";
export declare const PLAN_PROMPT_VERSION = "distribution-plan/2026-09-03.1";
export interface SellerProfile {
    companyName: string;
    industry: string;
    identity: string;
    /** KB snippets about products, pricing, certifications, current partners. */
    knowledgeContext: string;
}
export interface PlanInput {
    program: ProgramRecord;
    profile: SellerProfile;
    territories: Territory[];
    partnerKinds: PartnerKind[];
    sources: {
        web: boolean;
        place: boolean;
        trade: boolean;
    };
}
export declare function buildPlanPrompt(input: PlanInput): string;
export declare function planDiscovery(input: PlanInput): Promise<{
    plan: DiscoveryPlan;
    modelId?: string;
    playbookHash: string;
}>;
/**
 * Deterministic clean-up of a model-produced plan: drop queries for sources
 * that are not available, for territories or kinds outside the run, and
 * queries that name the seller (they find the seller, not its channels).
 */
export declare function sanitizePlan(plan: DiscoveryPlan, input: PlanInput): DiscoveryPlan;
//# sourceMappingURL=plan.d.ts.map