import {
    getCampaign,
    listApprovals,
    listRecipients,
    listSendAttempts,
    listTemplateVersions,
} from "@launchstack/pipelines/email";

import { fail, handleRouteError, ok, parseCampaignId, resolveActor } from "../_lib/context";
import { requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";

/**
 * GET /api/email-campaigns/{campaignId}
 * The campaign's full lifecycle state: every template version, every approval
 * (including revoked ones), the frozen audience, and every send attempt.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ campaignId: string }> }
) {
    try {
        const actor = await resolveActor();
        if (!actor.ok) return actor.response;

        const campaignId = parseCampaignId((await params).campaignId);
        if (campaignId === null)
            return fail(
                requestTranslator(request, "growth.server.email")("invalidCampaignId"),
                400
            );

        const campaign = await getCampaign(actor.actor.companyId, campaignId);
        if (!campaign)
            return fail(requestTranslator(request, "growth.server.email")("campaignNotFound"), 404);

        const [versions, approvals, recipients, attempts] = await Promise.all([
            listTemplateVersions(campaign.id),
            listApprovals(campaign.id),
            listRecipients(campaign.id),
            listSendAttempts(campaign.id),
        ]);

        return ok({
            campaign,
            versions,
            approvals,
            recipients,
            attempts,
            approvedVersion: versions.find(v => v.id === campaign.approvedVersionId) ?? null,
        });
    } catch (error) {
        return handleRouteError("email-campaigns/get", error, request);
    }
}
