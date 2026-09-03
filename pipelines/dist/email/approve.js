import { getTemplateVersion, recordApproval, requireCampaign } from "./db.js";
import { CampaignLifecycleError, } from "./types.js";
export async function approveEmailCampaign(args) {
    const campaign = await requireCampaign(args.companyId, args.campaignId);
    const version = await getTemplateVersion(campaign.id, args.templateVersionId);
    if (!version) {
        throw new CampaignLifecycleError(`Template version ${args.templateVersionId} does not belong to campaign ${campaign.id}`, "template_version_not_found", 404);
    }
    // A failed review is not a hard block — it is a decision that has to be
    // named. Approving anyway is allowed, but only on the record.
    const overrideReason = args.overrideReason?.trim() ?? "";
    if (version.reviewVerdict !== "pass" && !overrideReason) {
        throw new CampaignLifecycleError(version.reviewVerdict === "revise"
            ? "The AI review asked for revisions. Approving anyway requires an overrideReason."
            : "This version has not been reviewed. Approving it requires an overrideReason.", "review_not_passed", 422);
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
//# sourceMappingURL=approve.js.map