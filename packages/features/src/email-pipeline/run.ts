import { randomUUID } from "node:crypto";

import { generateTemplate } from "./generator";
import { reviewTemplate } from "./reviewer";
import { sendCampaign } from "./send";
import { runAutomatedEmailCampaign } from "./automation";
import { isSuppressed } from "./db";
import type {
  EmailTemplate,
  Recipient,
  SendMode,
  SendResult,
  TemplateReview,
} from "./types";

/**
 * One-shot pipeline: generate → review → persist → send.
 *
 * Kept for the existing `POST /api/email-pipeline/send` endpoint and for
 * unattended automation. Its contract is unchanged, but it no longer owns the
 * orchestration — it delegates to {@link runAutomatedEmailCampaign}, so a
 * one-call run produces the same persisted template version, approval record
 * and send attempt that the staged lifecycle does.
 *
 * Prefer the staged endpoints when a human is in the loop:
 * `prepareEmailCampaign` → `approveEmailCampaign` → `dispatchEmailCampaign`.
 * Only that path guarantees the bytes a reviewer saw are the bytes that ship;
 * here, generation and delivery still share one request, so a client retry
 * generates a fresh template and a fresh campaign.
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

  if (!persist) return runWithoutPersistence(args);

  const run = await runAutomatedEmailCampaign({
    companyId: args.companyId,
    name: args.name,
    ...(args.goal !== undefined ? { goal: args.goal } : {}),
    recipients: args.recipients,
    ...(args.mode ? { mode: args.mode } : {}),
    senderIdentity: args.senderIdentity,
    unsubscribeBaseUrl: args.unsubscribeBaseUrl,
    // Each call is its own campaign, so a fresh key per call preserves the
    // historical behaviour of this endpoint exactly.
    idempotencyKey: randomUUID(),
    policy: {
      // This entry point has always sent regardless of the review verdict;
      // the staged endpoints and `/api/email-campaign-runs` are where the
      // stricter default lives.
      requireReviewPass: false,
      overrideReason: "One-shot pipeline run (runEmailCampaign).",
    },
  });

  if (!run.review) throw new Error("Template review did not run");

  return {
    campaignId: run.campaign.id,
    template: run.version.template,
    review: run.review,
    results: run.results,
  };
}

/**
 * `persist: false` — generate, review and render without writing a campaign.
 * No version and no audit trail, so it cannot go through the lifecycle stages
 * and per-campaign idempotency is unavailable. The company suppression list is
 * still honoured; that check is never optional.
 */
async function runWithoutPersistence(args: {
  companyId: number;
  goal?: string;
  recipients: Recipient[];
  mode?: SendMode;
  senderIdentity: string;
  unsubscribeBaseUrl: string;
}): Promise<{
  campaignId: null;
  template: EmailTemplate;
  review: TemplateReview;
  results: SendResult[];
}> {
  const { template, companyContext } = await generateTemplate({
    companyId: args.companyId,
    ...(args.goal !== undefined ? { goal: args.goal } : {}),
  });
  const review = await reviewTemplate({ template, companyContext });

  const results = await sendCampaign({
    template,
    recipients: args.recipients,
    mode: args.mode ?? "dry_run",
    senderIdentity: args.senderIdentity,
    unsubscribeBaseUrl: args.unsubscribeBaseUrl,
    isSuppressed: (email) => isSuppressed(args.companyId, email),
  });

  return { campaignId: null, template, review, results };
}
