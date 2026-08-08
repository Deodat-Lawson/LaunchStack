import { generateTemplate } from "./generator";
import { reviewTemplate } from "./reviewer";
import { sendCampaign } from "./send";
import { createCampaign, isSuppressed, saveSends, sentEmails } from "./db";
import { EMAIL_MODELS, EMAIL_PROMPT_VERSION } from "./models";
import type {
  EmailTemplate,
  Recipient,
  SendMode,
  SendResult,
  TemplateReview,
} from "./types";

/**
 * Orchestrates the pipeline: generate a grounded template → review it with an
 * LLM → (persist) → render + send each recipient through the safety wrapper.
 * Defaults to dry-run; suppression + idempotency are DB-backed.
 */
export async function runEmailCampaign(args: {
  companyId: number;
  name: string;
  goal?: string;
  recipients: Recipient[];
  mode?: SendMode;
  senderIdentity: string;
  unsubscribeBaseUrl: string;
  /** Persist a campaign + sends (audit). Default true. */
  persist?: boolean;
}): Promise<{
  campaignId: number | null;
  template: EmailTemplate;
  review: TemplateReview;
  results: SendResult[];
}> {
  const persist = args.persist ?? true;

  const { template, companyContext } = await generateTemplate({
    companyId: args.companyId,
    goal: args.goal,
  });
  const review = await reviewTemplate({ template, companyContext });

  let campaignId: number | null = null;
  if (persist) {
    campaignId = await createCampaign({
      companyId: args.companyId,
      name: args.name,
      template,
      model: EMAIL_MODELS.templateGeneration,
      promptVersion: EMAIL_PROMPT_VERSION,
      templateVersion: EMAIL_PROMPT_VERSION,
    });
  }

  const already = campaignId ? await sentEmails(campaignId) : new Set<string>();

  const results = await sendCampaign({
    template,
    recipients: args.recipients,
    mode: args.mode ?? "dry_run",
    senderIdentity: args.senderIdentity,
    unsubscribeBaseUrl: args.unsubscribeBaseUrl,
    isSuppressed: (email) => isSuppressed(args.companyId, email),
    alreadySent: (email) => already.has(email),
  });

  if (campaignId) await saveSends(campaignId, results);

  return { campaignId, template, review, results };
}
