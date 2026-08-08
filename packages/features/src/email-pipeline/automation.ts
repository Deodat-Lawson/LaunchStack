import { approveEmailCampaign } from "./approve";
import { dispatchEmailCampaign } from "./dispatch";
import { prepareEmailCampaign } from "./prepare";
import type { MergeFn, SendAdapter } from "./contracts";
import type {
  ApprovalRecord,
  CampaignRecord,
  Recipient,
  SendAttemptRecord,
  SendMode,
  SendResult,
  TemplateReview,
  TemplateVersion,
} from "./types";

/**
 * Automation: prepare → policy → approve → dispatch, in one call.
 *
 * This is the ONLY place the three stages are composed automatically, and it
 * still goes through them properly — the template is persisted and the exact
 * version is locked by an approval record before anything is delivered. What
 * it removes is the human, not the audit trail.
 *
 * `/api/email-campaigns/{id}/send` must never call this.
 */

export interface AutomationPolicy {
  /**
   * Refuse to send when the AI review returned `revise`. Default true — an
   * unattended campaign should not talk its way past its own reviewer.
   */
  requireReviewPass?: boolean;
  /** Refuse to send to more than this many recipients in one run. */
  maxRecipients?: number;
  /** Reason recorded on the automated approval. */
  overrideReason?: string;
}

export interface RunAutomatedEmailCampaignArgs {
  companyId: number;
  name: string;
  goal?: string;
  recipients: Recipient[];
  mode?: SendMode;
  senderIdentity: string;
  unsubscribeBaseUrl: string;
  /** Reuse a key to make the whole run retry-safe at the delivery stage. */
  idempotencyKey?: string;
  actorUserId?: number | null;
  actorEmail?: string | null;
  policy?: AutomationPolicy;
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
}

export async function runAutomatedEmailCampaign(
  args: RunAutomatedEmailCampaignArgs,
): Promise<AutomatedEmailCampaignResult> {
  const policy = args.policy ?? {};
  const requireReviewPass = policy.requireReviewPass ?? true;

  // ── prepare ───────────────────────────────────────────────────────────────
  const prepared = await prepareEmailCampaign({
    companyId: args.companyId,
    name: args.name,
    ...(args.goal !== undefined ? { goal: args.goal } : {}),
    recipients: args.recipients,
    actorUserId: args.actorUserId ?? null,
  });

  const blocked = (reason: string): AutomatedEmailCampaignResult => ({
    campaign: prepared.campaign,
    version: prepared.version,
    review: prepared.review,
    approval: null,
    attempt: null,
    results: [],
    blockedReason: reason,
  });

  // ── policy ────────────────────────────────────────────────────────────────
  if (requireReviewPass && prepared.review?.verdict !== "pass") {
    return blocked(
      `AI review verdict was "${prepared.review?.verdict ?? "none"}" — automated sending requires a passing review.`,
    );
  }
  if (
    policy.maxRecipients !== undefined &&
    args.recipients.length > policy.maxRecipients
  ) {
    return blocked(
      `Recipient count ${args.recipients.length} exceeds the automation limit of ${policy.maxRecipients}.`,
    );
  }

  // ── approve (recorded as automation, never as a person) ───────────────────
  const approved = await approveEmailCampaign({
    companyId: args.companyId,
    campaignId: prepared.campaign.id,
    templateVersionId: prepared.version.id,
    approvedBy: args.actorUserId ?? null,
    approvedByEmail: args.actorEmail ?? null,
    approvedByKind: "automation",
    overrideReason:
      policy.overrideReason ??
      (prepared.version.reviewVerdict === "pass"
        ? null
        : "Automated run: review pass not required by policy."),
  });

  // ── dispatch ──────────────────────────────────────────────────────────────
  const dispatched = await dispatchEmailCampaign({
    companyId: args.companyId,
    campaignId: prepared.campaign.id,
    idempotencyKey: args.idempotencyKey ?? `run-${prepared.campaign.id}`,
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
    review: prepared.review,
    approval: approved.approval,
    attempt: dispatched.attempt,
    results: dispatched.results,
    blockedReason: null,
  };
}
