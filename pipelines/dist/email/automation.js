import { approveEmailCampaign } from "./approve.js";
import { dispatchEmailCampaign } from "./dispatch.js";
import { prepareEmailCampaign } from "./prepare.js";
import { claimAutomationCampaign, getLatestTemplateVersion, getTemplateVersion, listRecipients, upsertRecipients, } from "./db.js";
import { CampaignLifecycleError, } from "./types.js";
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
export function resolveAutomationPolicy(env = process.env) {
    const rawMax = Number(env.EMAIL_AUTOMATION_MAX_RECIPIENTS);
    return {
        requireReviewPass: env.EMAIL_AUTOMATION_ALLOW_UNREVIEWED !== "true",
        maxRecipients: Number.isInteger(rawMax) && rawMax > 0 ? rawMax : 200,
    };
}
export async function runAutomatedEmailCampaign(args) {
    const runKey = args.idempotencyKey?.trim();
    if (!runKey) {
        throw new CampaignLifecycleError("An idempotency key is required to start an automated run", "idempotency_key_required", 400);
    }
    // ── claim (BEFORE generation) ─────────────────────────────────────────────
    const { campaign, created } = await claimAutomationCampaign({
        companyId: args.companyId,
        name: args.name,
        ...(args.goal !== undefined ? { goal: args.goal } : {}),
        automationKey: runKey,
        createdBy: args.actorUserId ?? null,
    });
    // ── prepare (skipped on a resumed run that already generated) ────────────
    let version;
    let review;
    // A resumed run reuses the first request's template rather than paying for —
    // and risking — a second generation. When the original request died BEFORE
    // generating, there is nothing to reuse and nothing was sent, so generating
    // now is exactly what a retry should do (not a permanent 409).
    const existing = created
        ? null
        : ((campaign.approvedVersionId
            ? await getTemplateVersion(campaign.id, campaign.approvedVersionId)
            : null) ?? (await getLatestTemplateVersion(campaign.id)));
    if (existing) {
        version = existing;
        review = existing.review;
        await upsertRecipients(campaign.id, args.recipients);
    }
    else {
        const prepared = await prepareEmailCampaign({
            companyId: args.companyId,
            campaignId: campaign.id,
            ...(args.goal !== undefined ? { goal: args.goal } : {}),
            recipients: args.recipients,
            actorUserId: args.actorUserId ?? null,
        });
        version = prepared.version;
        review = prepared.review;
    }
    const blocked = (reason) => ({
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
        return blocked(`AI review verdict was "${version.reviewVerdict ?? "none"}" — automated sending requires a passing review.`);
    }
    if (args.policy.maxRecipients !== null) {
        // Enforce against the STORED audience, not this request's batch: resumed
        // runs accumulate recipients across retries, so checking only
        // `args.recipients.length` would let successive batches step past the cap.
        const audience = await listRecipients(campaign.id);
        if (audience.length > args.policy.maxRecipients) {
            return blocked(`Stored recipient count ${audience.length} exceeds the automation limit of ${args.policy.maxRecipients}.`);
        }
    }
    // ── approve (recorded as automation, never as a person) ───────────────────
    const approved = await approveEmailCampaign({
        companyId: args.companyId,
        campaignId: campaign.id,
        templateVersionId: version.id,
        approvedBy: args.actorUserId ?? null,
        approvedByEmail: args.actorEmail ?? null,
        approvedByKind: "automation",
        overrideReason: version.reviewVerdict === "pass"
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
//# sourceMappingURL=automation.js.map