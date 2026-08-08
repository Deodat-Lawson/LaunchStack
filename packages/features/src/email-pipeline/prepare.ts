import { generateTemplate } from "./generator";
import { reviewTemplate } from "./reviewer";
import {
  appendTemplateVersion,
  createCampaign,
  requireCampaign,
  setCampaignStatus,
  upsertRecipients,
} from "./db";
import { EMAIL_PROMPT_VERSION, EMAIL_ROUTES, routeLabel } from "./models";
import {
  CampaignLifecycleError,
  EmailTemplateSchema,
  type CampaignRecord,
  type EmailTemplate,
  type Recipient,
  type TemplateReview,
  type TemplateVersion,
} from "./types";

/**
 * Stage 1 of the campaign lifecycle: produce content.
 *
 * Generates (or accepts a human edit of) a template, reviews it, and appends
 * it as an immutable version. Nothing here delivers anything — this stage is
 * probabilistic and freely repeatable, which is exactly why it is separated
 * from the irreversible one.
 */

export interface PrepareEmailCampaignArgs {
  companyId: number;
  /** Omit to create a new campaign; pass an id to append a version to one. */
  campaignId?: number;
  /** Required when creating a campaign. */
  name?: string;
  goal?: string;
  /**
   * A hand-written template. When present the LLM is not called for
   * generation and the version is recorded as `human_edited`.
   */
  template?: EmailTemplate;
  /** Audience, stored now so it can be reviewed before approval. */
  recipients?: Recipient[];
  /** Skip the review call (the review verdict is then null). Default false. */
  skipReview?: boolean;
  actorUserId?: number | null;
}

export interface PreparedEmailCampaign {
  campaign: CampaignRecord;
  version: TemplateVersion;
  template: EmailTemplate;
  review: TemplateReview | null;
}

export async function prepareEmailCampaign(
  args: PrepareEmailCampaignArgs,
): Promise<PreparedEmailCampaign> {
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
  let template: EmailTemplate;
  let companyContext: string | null = null;
  if (args.template) {
    template = EmailTemplateSchema.parse(args.template);
  } else {
    const generated = await generateTemplate({
      companyId: args.companyId,
      goal,
    });
    template = generated.template;
    companyContext = generated.companyContext;
  }

  let review: TemplateReview | null = null;
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
    model: args.template ? null : routeLabel(EMAIL_ROUTES.templateGeneration),
    promptVersion: args.template ? null : EMAIL_PROMPT_VERSION,
    review,
    createdBy: args.actorUserId ?? null,
  });

  if (args.recipients?.length) {
    await upsertRecipients(campaign.id, args.recipients);
  }

  // A new version invalidates any earlier approval implicitly: the campaign
  // moves back out of `approved`, and `approvedVersionId` still points at the
  // old version, so a dispatch would send THAT one until someone approves this.
  const status =
    review?.verdict === "revise"
      ? "needs_revision"
      : review
        ? "pending_approval"
        : "draft";
  await setCampaignStatus(campaign.id, status);

  return {
    campaign: { ...campaign, status, goal: goal ?? campaign.goal },
    version,
    template,
    review,
  };
}

function requireName(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new CampaignLifecycleError(
      "A campaign name is required to create a campaign",
      "campaign_name_required",
      400,
    );
  }
  return trimmed;
}

/**
 * Rebuild company context for a template we did not generate. Best-effort:
 * if it fails, the review still runs and simply scores grounding harshly.
 */
async function generateContextFor(
  companyId: number,
  goal?: string,
): Promise<string | null> {
  try {
    const { buildCompanyKnowledgeContext } = await import(
      "../marketing-pipeline/context"
    );
    return await buildCompanyKnowledgeContext({
      companyId,
      prompt: goal ?? "Review an outreach email template for this company.",
    });
  } catch {
    return null;
  }
}
