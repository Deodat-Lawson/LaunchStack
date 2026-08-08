import { createHash } from "node:crypto";

import { createUnsubscribeToken } from "./unsubscribe-token";

import type { MergeFn, SendAdapter } from "./contracts";
import { sendCampaign } from "./send";
import {
  applyRecipientStatuses,
  attemptResults,
  claimRecipientSend,
  claimSendAttempt,
  completeSendAttempt,
  freezeRecipients,
  getTemplateVersion,
  isSuppressed,
  reclaimAbandonedAttempts,
  recordSendOutcome,
  requireCampaign,
  sentEmails,
  setCampaignStatus,
  touchSendAttempt,
} from "./db";
import {
  CampaignLifecycleError,
  type CampaignRecord,
  type CampaignStatus,
  type Recipient,
  type SendAttemptRecord,
  type SendMode,
  type SendResult,
  type TemplateVersion,
} from "./types";

/**
 * Stage 3 of the campaign lifecycle: deliver.
 *
 * This is the irreversible half, and it is deliberately dull. It loads the
 * template version that was already approved, freezes the audience, and hands
 * every recipient to the send wrapper.
 *
 * It NEVER calls an LLM and never writes a template. That is the whole point
 * of the split: retrying a timed-out send re-runs this function and can only
 * reproduce the same content, and the idempotency key means it will usually
 * not re-send at all.
 */

/**
 * How long a `running` attempt may go without a heartbeat before recovery
 * treats it as dead. Generous, because the cost of reclaiming a live attempt
 * is higher than the cost of waiting.
 */
const STALE_ATTEMPT_MS = 15 * 60 * 1000;

/** Statuses from which delivery has not yet been cleared by a human. */
const PRE_APPROVAL_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>(
  ["draft", "needs_revision", "pending_approval"],
);

export interface DispatchEmailCampaignArgs {
  companyId: number;
  campaignId: number;
  /**
   * Deduplicates retries. Two requests with the same key against the same
   * campaign resolve to one attempt; the second replays the first's results.
   */
  idempotencyKey: string;
  /** Default "dry_run": render + record everything, deliver nothing. */
  mode?: SendMode;
  /** Audience for the FIRST dispatch. Ignored once the list is frozen. */
  recipients?: Recipient[];
  senderIdentity: string;
  /** Origin-qualified base for unsubscribe links; the signed token is appended. */
  unsubscribeBaseUrl: string;
  requestedBy?: number | null;
  adapter?: SendAdapter;
  merge?: MergeFn;
  ratePerMinute?: number;
}

export interface DispatchedEmailCampaign {
  campaign: CampaignRecord;
  version: TemplateVersion;
  attempt: SendAttemptRecord;
  results: SendResult[];
  /** True when this key had already been used — nothing was delivered now. */
  replayed: boolean;
  /** True when the audience came from a previously frozen list. */
  recipientsFrozen: boolean;
}

export async function dispatchEmailCampaign(
  args: DispatchEmailCampaignArgs,
): Promise<DispatchedEmailCampaign> {
  const mode = args.mode ?? "dry_run";
  const campaign = await requireCampaign(args.companyId, args.campaignId);

  const key = args.idempotencyKey?.trim();
  if (!key) {
    throw new CampaignLifecycleError(
      "An idempotency key is required to send a campaign",
      "idempotency_key_required",
      400,
    );
  }

  // 0) Free up attempts whose process died, so one crash cannot wedge the
  // campaign behind a permanent "already in progress".
  await reclaimAbandonedAttempts(campaign.id, STALE_ATTEMPT_MS);

  // 1) Refuse unless a version is currently approved. Appending a version
  // clears this pointer, so an edited campaign lands here, not at the
  // provider — the approval a reviewer gave does not carry to new content.
  if (!campaign.approvedVersionId || PRE_APPROVAL_STATUSES.has(campaign.status)) {
    throw new CampaignLifecycleError(
      campaign.approvedVersionId
        ? `This campaign is ${campaign.status}; approve the current template version before sending.`
        : "This campaign has no approved template version. Approve one before sending.",
      "campaign_not_approved",
      409,
    );
  }

  // 2) Load the exact approved version — the only content this stage may use.
  const version = await getTemplateVersion(
    campaign.id,
    campaign.approvedVersionId,
  );
  if (!version) {
    throw new CampaignLifecycleError(
      "The approved template version is missing.",
      "approved_version_missing",
      409,
    );
  }

  // 3) Freeze the audience against the approved template.
  const { recipients, alreadyFrozen } = await freezeRecipients(
    campaign.id,
    args.recipients ?? [],
  );
  if (recipients.length === 0) {
    throw new CampaignLifecycleError(
      "This campaign has no recipients.",
      "no_recipients",
      422,
    );
  }

  // 4) Claim the attempt. A duplicate key never reaches the provider.
  const { attempt, created } = await claimSendAttempt({
    campaignId: campaign.id,
    templateVersionId: version.id,
    idempotencyKey: key,
    mode,
    requestedBy: args.requestedBy ?? null,
    recipientCount: recipients.length,
  });

  if (!created) {
    if (attempt.status === "running") {
      throw new CampaignLifecycleError(
        "A send with this idempotency key is already in progress.",
        "send_in_progress",
        409,
      );
    }
    return {
      campaign,
      version,
      attempt,
      results: await attemptResults(attempt.id),
      replayed: true,
      recipientsFrozen: alreadyFrozen,
    };
  }

  await setCampaignStatus(campaign.id, "sending");

  // 5) Cross-attempt guard: an address already delivered to — or left
  // in-flight by a crashed attempt — is skipped even under a fresh key.
  const already = await sentEmails(campaign.id);

  let results: SendResult[];
  try {
    results = await sendCampaign({
      template: version.template,
      recipients,
      mode,
      senderIdentity: args.senderIdentity,
      unsubscribeUrl: (email) =>
        `${args.unsubscribeBaseUrl.replace(/\/+$/, "")}/${createUnsubscribeToken({ companyId: args.companyId, email })}`,
      isSuppressed: (email) => isSuppressed(args.companyId, email),
      alreadySent: (email) => already.has(email),
      claim: (email) =>
        claimRecipientSend({
          campaignId: campaign.id,
          attemptId: attempt.id,
          recipientEmail: email,
          subject: version.template.subject,
          providerIdempotencyKey: providerKey(attempt.id, email),
        }),
      record: (result) =>
        recordSendOutcome({
          campaignId: campaign.id,
          attemptId: attempt.id,
          subject: version.template.subject,
          result,
        }),
      providerIdempotencyKey: (email) => providerKey(attempt.id, email),
      heartbeat: () => touchSendAttempt(attempt.id),
      ...(args.adapter ? { adapter: args.adapter } : {}),
      ...(args.merge ? { merge: args.merge } : {}),
      ...(args.ratePerMinute ? { ratePerMinute: args.ratePerMinute } : {}),
    });
  } catch (err) {
    await completeSendAttempt({
      attemptId: attempt.id,
      status: "failed",
      results: [],
      error: err instanceof Error ? err.message : "send failed",
    });
    await setCampaignStatus(campaign.id, "failed");
    throw err;
  }

  // 6) Outcomes were persisted as they happened; close the attempt out.
  await applyRecipientStatuses(campaign.id, results);
  await completeSendAttempt({
    attemptId: attempt.id,
    status: "completed",
    results,
  });

  const failed = results.filter((r) => r.status === "failed").length;
  const sent = results.filter((r) => r.status === "sent").length;
  const status =
    mode === "dry_run"
      ? "approved" // a dry run leaves the campaign ready to actually send
      : failed > 0 && sent === 0
        ? "failed"
        : "sent";
  await setCampaignStatus(campaign.id, status);

  return {
    campaign: { ...campaign, status },
    version,
    attempt: {
      ...attempt,
      status: "completed",
      sentCount: sent,
      failedCount: failed,
      suppressedCount: results.filter((r) => r.status === "suppressed").length,
      skippedCount: results.filter((r) => r.status === "skipped").length,
    },
    results,
    replayed: false,
    recipientsFrozen: alreadyFrozen,
  };
}

/**
 * Deterministic per-(attempt, recipient) key. Stable across retries of the
 * same attempt, distinct across attempts, and short enough for provider
 * headers that cap key length.
 */
function providerKey(attemptId: number, email: string): string {
  return createHash("sha256")
    .update(`${attemptId}:${email.toLowerCase()}`)
    .digest("hex")
    .slice(0, 48);
}
