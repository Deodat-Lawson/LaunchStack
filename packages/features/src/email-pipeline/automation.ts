import { approveEmailCampaign } from "./approve";
import { dispatchEmailCampaign } from "./dispatch";
import { prepareEmailCampaign } from "./prepare";
import {
  claimAutomationCampaign,
  getLatestTemplateVersion,
  getTemplateVersion,
  upsertRecipients,
} from "./db";
import type { MergeFn, SendAdapter } from "./contracts";
import {
  CampaignLifecycleError,
  type ApprovalRecord,
  type CampaignRecord,
  type Recipient,
  type SendAttemptRecord,
  type SendMode,
  type SendResult,
  type TemplateReview,
  type TemplateVersion,
} from "./types";

/**
 * Automation: claim → prepare → policy → approve → dispatch, in one call.
 *
 * This is the ONLY place the three stages are composed automatically, and it
 * still goes through them properly — the template is persisted and the exact
 * version is locked by an approval record before anything is delivered. What
 * it removes is the human, not the audit trail.
 *
 * The run key is claimed FIRST, before a single token is generated. Ordering
 * it that way is what makes the endpoint retry-safe: the per-campaign send key
 * cannot help if the retry creates a campaign of its own, so the key has to be
 * scoped to the company and claimed before the campaign exists.
 *
 * `/api/email-campaigns/{id}/send` must never call this.
 */

export interface AutomationPolicy {
  /**
   * Refuse to send when the AI review returned `revise`. Resolved on the
   * server — never from the request body, or the gate is decorative.
   */
  requireReviewPass: boolean;
  /** Refuse to send to more than this many recipients in one run. */
  maxRecipients: number | null;
  /** Reason recorded on the automated approval. */
  overrideReason?: string;
}

/**
 * Resolve the automation policy from server configuration.
 *
 * Deliberately takes no caller input. An automation policy that a request can
 * relax is not a policy — anyone who can reach the endpoint could post
 * `requireReviewPass: false` and walk straight past the review gate. Loosening
 * it requires deploy access, which is the point.
 *
 * - `EMAIL_AUTOMATION_ALLOW_UNREVIEWED=true` lets unattended runs send a
 *   template the reviewer asked to revise. Off unless explicitly set.
 * - `EMAIL_AUTOMATION_MAX_RECIPIENTS` caps one run's audience (default 200).
 */
export function resolveAutomationPolicy(
  env: Record<string, string | undefined> = process.env,
): AutomationPolicy {
  const rawMax = Number(env.EMAIL_AUTOMATION_MAX_RECIPIENTS);
  return {
    requireReviewPass: env.EMAIL_AUTOMATION_ALLOW_UNREVIEWED !== "true",
    maxRecipients: Number.isInteger(rawMax) && rawMax > 0 ? rawMax : 200,
  };
}

export interface RunAutomatedEmailCampaignArgs {
  companyId: number;
  name: string;
  goal?: string;
  recipients: Recipient[];
  mode?: SendMode;
  senderIdentity: string;
  unsubscribeBaseUrl: string;
  /**
   * Company-scoped run key. Required: without one, a retry after a timeout
   * would generate and send a second campaign.
   */
  idempotencyKey: string;
  actorUserId?: number | null;
  actorEmail?: string | null;
  policy: AutomationPolicy;
  adapter?: SendAdapter;
  merge?: MergeFn;
  ratePerMinute?: number;
}

export interface AutomatedEmailCampaignResult {
  campaign: CampaignRecord;
  version: TemplateVersion;
  review: TemplateReview | null;
  approval: ApprovalRecord | null;
  attempt: SendAttemptRecord | null;
  results: SendResult[];
  /** Set when the policy stopped the run before delivery. */
  blockedReason: string | null;
  /** True when this key had been seen before and the run resumed a campaign. */
  resumed: boolean;
}

export async function runAutomatedEmailCampaign(
  args: RunAutomatedEmailCampaignArgs,
): Promise<AutomatedEmailCampaignResult> {
  const runKey = args.idempotencyKey?.trim();
  if (!runKey) {
    throw new CampaignLifecycleError(
      "An idempotency key is required to start an automated run",
      "idempotency_key_required",
      400,
    );
  }

  // ── claim (BEFORE generation) ─────────────────────────────────────────────
  const { campaign, created } = await claimAutomationCampaign({
    companyId: args.companyId,
    name: args.name,
    ...(args.goal !== undefined ? { goal: args.goal } : {}),
    automationKey: runKey,
    createdBy: args.actorUserId ?? null,
  });

  // ── prepare (skipped entirely on a resumed run) ───────────────────────────
  let version: TemplateVersion;
  let review: TemplateReview | null;

  if (created) {
    const prepared = await prepareEmailCampaign({
      companyId: args.companyId,
      campaignId: campaign.id,
      ...(args.goal !== undefined ? { goal: args.goal } : {}),
      recipients: args.recipients,
      actorUserId: args.actorUserId ?? null,
    });
    version = prepared.version;
    review = prepared.review;
  } else {
    // The first request already generated for this key. Reuse its template
    // rather than paying for — and risking — a second generation.
    const existing =
      (campaign.approvedVersionId
        ? await getTemplateVersion(campaign.id, campaign.approvedVersionId)
        : null) ?? (await getLatestTemplateVersion(campaign.id));
    if (!existing) {
      throw new CampaignLifecycleError(
        "This run key exists but its campaign has no template version; the original request failed before generating.",
        "run_incomplete",
        409,
      );
    }
    version = existing;
    review = existing.review;
    await upsertRecipients(campaign.id, args.recipients);
  }

  const blocked = (reason: string): AutomatedEmailCampaignResult => ({
    campaign,
    version,
    review,
    approval: null,
    attempt: null,
    results: [],
    blockedReason: reason,
    resumed: !created,
  });

  // ── policy ────────────────────────────────────────────────────────────────
  if (args.policy.requireReviewPass && version.reviewVerdict !== "pass") {
    return blocked(
      `AI review verdict was "${version.reviewVerdict ?? "none"}" — automated sending requires a passing review.`,
    );
  }
  if (
    args.policy.maxRecipients !== null &&
    args.recipients.length > args.policy.maxRecipients
  ) {
    return blocked(
      `Recipient count ${args.recipients.length} exceeds the automation limit of ${args.policy.maxRecipients}.`,
    );
  }

  // ── approve (recorded as automation, never as a person) ───────────────────
  const approved = await approveEmailCampaign({
    companyId: args.companyId,
    campaignId: campaign.id,
    templateVersionId: version.id,
    approvedBy: args.actorUserId ?? null,
    approvedByEmail: args.actorEmail ?? null,
    approvedByKind: "automation",
    overrideReason:
      version.reviewVerdict === "pass"
        ? null
        : (args.policy.overrideReason ??
          "Automated run: policy does not require a passing review."),
  });

  // ── dispatch (same key: the send stage is idempotent per campaign) ────────
  const dispatched = await dispatchEmailCampaign({
    companyId: args.companyId,
    campaignId: campaign.id,
    idempotencyKey: runKey,
    ...(args.mode ? { mode: args.mode } : {}),
    recipients: args.recipients,
    senderIdentity: args.senderIdentity,
    unsubscribeBaseUrl: args.unsubscribeBaseUrl,
    requestedBy: args.actorUserId ?? null,
    ...(args.adapter ? { adapter: args.adapter } : {}),
    ...(args.merge ? { merge: args.merge } : {}),
    ...(args.ratePerMinute ? { ratePerMinute: args.ratePerMinute } : {}),
  });

  return {
    campaign: dispatched.campaign,
    version: approved.version,
    review,
    approval: approved.approval,
    attempt: dispatched.attempt,
    results: dispatched.results,
    blockedReason: null,
    resumed: !created,
  };
}
