import { z } from "zod";

import { approveEmailCampaign } from "@launchstack/pipelines/email";

import {
    fail,
    handleRouteError,
    ok,
    parseCampaignId,
    readJson,
    resolveManagementActor,
} from "../../_lib/context";

export const runtime = "nodejs";

const ApproveSchema = z.object({
    /**
     * The exact version being cleared. Required — approving "the latest" would
     * race a regeneration and could clear text nobody read.
     */
    templateVersionId: z.number().int().positive(),
    /** Required when the version's AI review did not pass. */
    overrideReason: z.string().min(1).max(1000).optional(),
});

/**
 * POST /api/email-campaigns/{campaignId}/approve
 * Stage 2 — record that a named human cleared one exact template version, the
 * review verdict at that moment, and any reason for overriding it. This is
 * what `/send` later loads; without it, sending is refused.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ campaignId: string }> }
) {
    try {
        // Approval is the accountability record delivery relies on — a
        // workspace-management action, like every other company-wide mutation.
        const actor = await resolveManagementActor();
        if (!actor.ok) return actor.response;

        const campaignId = parseCampaignId((await params).campaignId);
        if (campaignId === null) return fail("Invalid campaign ID", 400);

        const parsed = ApproveSchema.safeParse(await readJson(request));
        if (!parsed.success) {
            return fail("Invalid input", 400, { errors: parsed.error.flatten() });
        }

        const approved = await approveEmailCampaign({
            companyId: actor.actor.companyId,
            campaignId,
            templateVersionId: parsed.data.templateVersionId,
            approvedBy: actor.actor.userId,
            approvedByEmail: actor.actor.email,
            approvedByKind: "human",
            ...(parsed.data.overrideReason !== undefined
                ? { overrideReason: parsed.data.overrideReason }
                : {}),
        });

        return ok({
            campaignId: approved.campaign.id,
            status: approved.campaign.status,
            approvedVersionId: approved.version.id,
            version: approved.version.version,
            approval: approved.approval,
        });
    } catch (error) {
        return handleRouteError("email-campaigns/approve", error);
    }
}
