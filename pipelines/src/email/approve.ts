import { getTemplateVersion, recordApproval, requireCampaign } from "./db";
import {
    CampaignLifecycleError,
    type ApprovalRecord,
    type CampaignRecord,
    type TemplateVersion,
} from "./types";

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

export async function approveEmailCampaign(
    args: ApproveEmailCampaignArgs
): Promise<ApprovedEmailCampaign> {
    const campaign = await requireCampaign(args.companyId, args.campaignId);

    const version = await getTemplateVersion(campaign.id, args.templateVersionId);
    if (!version) {
        throw new CampaignLifecycleError(
            `Template version ${args.templateVersionId} does not belong to campaign ${campaign.id}`,
            "template_version_not_found",
            404
        );
    }

    // A failed review is not a hard block — it is a decision that has to be
    // named. Approving anyway is allowed, but only on the record.
    const overrideReason = args.overrideReason?.trim() ?? "";
    if (version.reviewVerdict !== "pass" && !overrideReason) {
        throw new CampaignLifecycleError(
            version.reviewVerdict === "revise"
                ? "The AI review asked for revisions. Approving anyway requires an overrideReason."
                : "This version has not been reviewed. Approving it requires an overrideReason.",
            "review_not_passed",
            422
        );
    }

    const approval = await recordApproval({
        campaignId: campaign.id,
        templateVersionId: version.id,
        approvedBy: args.approvedBy ?? null,
        approvedByEmail: args.approvedByEmail ?? null,
        approvedByKind: args.approvedByKind ?? "human",
        reviewVerdict: version.reviewVerdict,
        overrideReason: overrideReason || null,
    });

    return {
        campaign: {
            ...campaign,
            status: "approved",
            approvedVersionId: version.id,
        },
        version,
        approval,
    };
}
