import { type ApprovalRecord, type CampaignRecord, type TemplateVersion } from "./types.js";
/**
 * Stage 2 of the campaign lifecycle: decide.
 *
 * Approval names one exact template version and records who cleared it, when,
 * what the AI review said at the time, and — if the review did not pass — the
 * explicit reason someone chose to send anyway. Everything a later "why did we
 * send this?" needs is captured here, before anything leaves the building.
 */
export interface ApproveEmailCampaignArgs {
    companyId: number;
    campaignId: number;
    /** The exact version being cleared. Never "the latest" — that races. */
    templateVersionId: number;
    approvedBy?: number | null;
    approvedByEmail?: string | null;
    /** `automation` is only legitimate from an explicit automation policy. */
    approvedByKind?: "human" | "automation";
    /** Required to approve a version whose review verdict is `revise`. */
    overrideReason?: string | null;
}
export interface ApprovedEmailCampaign {
    campaign: CampaignRecord;
    version: TemplateVersion;
    approval: ApprovalRecord;
}
export declare function approveEmailCampaign(args: ApproveEmailCampaignArgs): Promise<ApprovedEmailCampaign>;
//# sourceMappingURL=approve.d.ts.map