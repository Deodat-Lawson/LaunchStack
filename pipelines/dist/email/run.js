import { generateTemplate } from "./generator.js";
import { reviewTemplate } from "./reviewer.js";
import { sendCampaign } from "./send.js";
import { prepareEmailCampaign } from "./prepare.js";
import { isSuppressed } from "./db.js";
import { createUnsubscribeToken } from "./unsubscribe-token.js";
import { CampaignLifecycleError } from "./types.js";
/**
 * Legacy one-shot pipeline: generate → review → render a PREVIEW.
 *
 * It no longer delivers. Generation and delivery in one request cannot be made
 * retry-safe — a client that retries after a timeout gets a fresh template and
 * a fresh campaign, and a campaign-scoped idempotency key has nothing to
 * collide with. Rather than pretend otherwise, this path stops at the dry run.
 *
 * Real sending lives in the staged lifecycle, where the content a reviewer
 * approved is the content that ships:
 *
 *   POST /api/email-campaigns              → prepareEmailCampaign
 *   POST /api/email-campaigns/{id}/approve → approveEmailCampaign
 *   POST /api/email-campaigns/{id}/send    → dispatchEmailCampaign
 *
 * or `runAutomatedEmailCampaign` for unattended runs.
 */
export async function runEmailCampaign(args) {
    if (args.mode === "send") {
        throw new CampaignLifecycleError(
            "Real sending has moved to the staged campaign API. Create a campaign, " +
                "approve a template version, then POST /api/email-campaigns/{id}/send " +
                "with an Idempotency-Key.",
            "one_shot_send_removed",
            410
        );
    }
    const persist = args.persist ?? true;
    // A persisted preview still produces a real, reviewable template version —
    // the campaign simply stays unapproved, so nothing can be dispatched from it
    // until someone goes through the staged flow.
    if (persist) {
        const prepared = await prepareEmailCampaign({
            companyId: args.companyId,
            name: args.name,
            ...(args.goal !== undefined ? { goal: args.goal } : {}),
            recipients: args.recipients,
            actorUserId: args.actorUserId ?? null,
        });
        if (!prepared.review) throw new Error("Template review did not run");
        return {
            campaignId: prepared.campaign.id,
            template: prepared.template,
            review: prepared.review,
            results: await previewResults(args, prepared.template),
        };
    }
    const { template, companyContext } = await generateTemplate({
        companyId: args.companyId,
        ...(args.goal !== undefined ? { goal: args.goal } : {}),
    });
    const review = await reviewTemplate({ template, companyContext });
    return {
        campaignId: null,
        template,
        review,
        results: await previewResults(args, template),
    };
}
/**
 * Render every recipient without delivering. The company suppression list is
 * still honoured; that check is never optional, even in a preview.
 */
function previewResults(args, template) {
    return sendCampaign({
        template,
        recipients: args.recipients,
        mode: "dry_run",
        senderIdentity: args.senderIdentity,
        unsubscribeUrl: email =>
            `${args.unsubscribeBaseUrl.replace(/\/+$/, "")}/${createUnsubscribeToken({ companyId: args.companyId, email })}`,
        isSuppressed: email => isSuppressed(args.companyId, email),
    });
}
//# sourceMappingURL=run.js.map
