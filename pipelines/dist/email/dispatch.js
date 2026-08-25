import { createHash } from "node:crypto";
import { createUnsubscribeToken } from "./unsubscribe-token.js";
import { sendCampaign } from "./send.js";
import {
    applyRecipientStatuses,
    attemptResults,
    claimRecipientSend,
    claimSendAttempt,
    completeSendAttempt,
    freezeRecipients,
    getTemplateVersion,
    reclaimAbandonedAttempts,
    recordSendOutcome,
    recordSendOutcomes,
    requireCampaign,
    sentEmails,
    setCampaignStatus,
    suppressedEmails,
    touchSendAttempt,
} from "./db.js";
import { CampaignLifecycleError } from "./types.js";
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
const PRE_APPROVAL_STATUSES = new Set(["draft", "needs_revision", "pending_approval"]);
export async function dispatchEmailCampaign(args) {
    const mode = args.mode ?? "dry_run";
    const campaign = await requireCampaign(args.companyId, args.campaignId);
    const key = args.idempotencyKey?.trim();
    if (!key) {
        throw new CampaignLifecycleError(
            "An idempotency key is required to send a campaign",
            "idempotency_key_required",
            400
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
            409
        );
    }
    // 2) Load the exact approved version — the only content this stage may use.
    const version = await getTemplateVersion(campaign.id, campaign.approvedVersionId);
    if (!version) {
        throw new CampaignLifecycleError(
            "The approved template version is missing.",
            "approved_version_missing",
            409
        );
    }
    // 3) Freeze the audience against the approved template.
    const { recipients, alreadyFrozen } = await freezeRecipients(
        campaign.id,
        args.recipients ?? []
    );
    if (recipients.length === 0) {
        throw new CampaignLifecycleError("This campaign has no recipients.", "no_recipients", 422);
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
                409
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
    // in-flight by a crashed attempt — is skipped even under a fresh key. The
    // suppression list is prefetched for the whole audience in one query; both
    // sets are point-in-time snapshots, same as the per-recipient lookups were.
    const [already, suppressed] = await Promise.all([
        sentEmails(campaign.id),
        suppressedEmails(
            args.companyId,
            recipients.map(r => r.email)
        ),
    ]);
    // A dry run delivers nothing, so its audit rows have no reservation to
    // protect — buffer them and write in bulk instead of one INSERT per
    // recipient. Real sends keep the write-as-it-happens bracket.
    const dryRunOutcomes = [];
    const flushDryRunOutcomes = () =>
        recordSendOutcomes({
            campaignId: campaign.id,
            attemptId: attempt.id,
            outcomes: dryRunOutcomes.splice(0),
        });
    let results;
    try {
        results = await sendCampaign({
            template: version.template,
            recipients,
            mode,
            senderIdentity: args.senderIdentity,
            unsubscribeUrl: email =>
                `${args.unsubscribeBaseUrl.replace(/\/+$/, "")}/${createUnsubscribeToken({ companyId: args.companyId, email })}`,
            isSuppressed: email => suppressed.has(email.toLowerCase()),
            alreadySent: email => already.has(email),
            claim: email =>
                claimRecipientSend({
                    campaignId: campaign.id,
                    attemptId: attempt.id,
                    recipientEmail: email,
                    subject: version.template.subject,
                    providerIdempotencyKey: providerKey(attempt.id, email),
                }),
            // Prefer the subject this recipient actually received. The template's
            // own subject still holds unrendered {{tokens}}, so recording it would
            // make every audit row read "Hello {{firstName}}". Falls back to the
            // template for rows settled before rendering.
            record:
                mode === "dry_run"
                    ? result => {
                          dryRunOutcomes.push({
                              subject: result.subject ?? version.template.subject,
                              result,
                          });
                      }
                    : result =>
                          recordSendOutcome({
                              campaignId: campaign.id,
                              attemptId: attempt.id,
                              subject: result.subject ?? version.template.subject,
                              result,
                          }),
            providerIdempotencyKey: email => providerKey(attempt.id, email),
            heartbeat: () => touchSendAttempt(attempt.id),
            ...(args.adapter ? { adapter: args.adapter } : {}),
            ...(args.merge ? { merge: args.merge } : {}),
            ...(args.ratePerMinute ? { ratePerMinute: args.ratePerMinute } : {}),
        });
        await flushDryRunOutcomes();
    } catch (err) {
        // Best-effort: keep whatever dry-run audit rows were buffered, and close
        // the attempt with the outcomes that WERE persisted rather than zeroed
        // counters — per-recipient results recorded before the crash are real.
        await flushDryRunOutcomes().catch(() => undefined);
        const persisted = await attemptResults(attempt.id).catch(() => []);
        await completeSendAttempt({
            attemptId: attempt.id,
            status: "failed",
            results: persisted,
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
    const failed = results.filter(r => r.status === "failed").length;
    const sent = results.filter(r => r.status === "sent").length;
    const status =
        mode === "dry_run"
            ? campaign.status === "sent"
                ? "sent" // a later dry run must not un-send a delivered campaign
                : "approved" // a dry run leaves the campaign ready to actually send
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
            suppressedCount: results.filter(r => r.status === "suppressed").length,
            skippedCount: results.filter(r => r.status === "skipped").length,
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
function providerKey(attemptId, email) {
    return createHash("sha256")
        .update(`${attemptId}:${email.toLowerCase()}`)
        .digest("hex")
        .slice(0, 48);
}
//# sourceMappingURL=dispatch.js.map
