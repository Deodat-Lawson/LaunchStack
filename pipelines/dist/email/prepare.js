import { generateTemplate } from "./generator.js";
import { reviewTemplate } from "./reviewer.js";
import {
    appendTemplateVersion,
    createCampaign,
    requireCampaign,
    setCampaignStatus,
    upsertRecipients,
} from "./db.js";
import { EMAIL_PROMPT_VERSION } from "./models.js";
import { validateTemplate } from "./validators.js";
import { CampaignLifecycleError, EmailTemplateSchema } from "./types.js";
export async function prepareEmailCampaign(args) {
    const campaign = args.campaignId
        ? await requireCampaign(args.companyId, args.campaignId)
        : await createCampaign({
              companyId: args.companyId,
              name: requireName(args.name),
              goal: args.goal ?? null,
              createdBy: args.actorUserId ?? null,
          });
    const goal = args.goal ?? campaign.goal ?? undefined;
    // A human edit skips generation but is still reviewed and still versioned —
    // approval gates on a verdict regardless of who wrote the words.
    let template;
    let companyContext = null;
    let generationModelId = null;
    if (args.template) {
        template = EmailTemplateSchema.parse(args.template);
    } else {
        const generated = await generateTemplate({
            companyId: args.companyId,
            goal,
        });
        template = generated.template;
        companyContext = generated.companyContext;
        generationModelId = generated.modelId;
    }
    // Deterministic gate, independent of the LLM review: no CRLF in the subject
    // (header injection), a non-empty subject/body, and a structural
    // {{unsubscribeUrl}} so compliance never rests on the reviewer's taste.
    const templateIssues = validateTemplate(template).filter(i => i.severity === "error");
    if (templateIssues.length > 0) {
        throw new CampaignLifecycleError(
            `Template rejected: ${templateIssues.map(i => i.message).join(" ")}`,
            "template_invalid",
            422
        );
    }
    let review = null;
    if (!args.skipReview) {
        review = await reviewTemplate({
            template,
            // A human edit has no generation context of its own; review it against
            // the same company facts a generated one would be held to.
            companyContext:
                companyContext ??
                (await generateContextFor(args.companyId, goal)) ??
                "(no company context available)",
        });
    }
    const version = await appendTemplateVersion({
        campaignId: campaign.id,
        template,
        source: args.template ? "human_edited" : "ai_generated",
        goal: goal ?? null,
        model: generationModelId,
        promptVersion: args.template ? null : EMAIL_PROMPT_VERSION,
        review,
        createdBy: args.actorUserId ?? null,
    });
    if (args.recipients?.length) {
        await upsertRecipients(campaign.id, args.recipients);
    }
    // A new version invalidates any earlier approval: appendTemplateVersion
    // revoked open approvals and cleared `approvedVersionId` in the same
    // transaction, so a dispatch now refuses until someone approves this one.
    const status =
        review?.verdict === "revise" ? "needs_revision" : review ? "pending_approval" : "draft";
    await setCampaignStatus(campaign.id, status);
    return {
        campaign: { ...campaign, status, goal: goal ?? campaign.goal },
        version,
        template,
        review,
    };
}
function requireName(name) {
    const trimmed = name?.trim();
    if (!trimmed) {
        throw new CampaignLifecycleError(
            "A campaign name is required to create a campaign",
            "campaign_name_required",
            400
        );
    }
    return trimmed;
}
/**
 * Rebuild company context for a template we did not generate. Best-effort:
 * if it fails, the review still runs and simply scores grounding harshly.
 */
async function generateContextFor(companyId, goal) {
    try {
        const { buildCompanyKnowledgeContext } = await import("../marketing/context.js");
        return await buildCompanyKnowledgeContext({
            companyId,
            prompt: goal ?? "Review an outreach email template for this company.",
        });
    } catch {
        return null;
    }
}
//# sourceMappingURL=prepare.js.map
