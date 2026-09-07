import type { MergeFn, SendAdapter } from "./contracts.js";
import { type ApprovalRecord, type CampaignRecord, type Recipient, type SendAttemptRecord, type SendMode, type SendResult, type TemplateReview, type TemplateVersion } from "./types.js";
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
export declare function resolveAutomationPolicy(env?: Record<string, string | undefined>): AutomationPolicy;
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
export declare function runAutomatedEmailCampaign(args: RunAutomatedEmailCampaignArgs): Promise<AutomatedEmailCampaignResult>;
//# sourceMappingURL=automation.d.ts.map