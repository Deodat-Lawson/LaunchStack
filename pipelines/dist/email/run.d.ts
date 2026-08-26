import { type EmailTemplate, type Recipient, type SendResult, type TemplateReview } from "./types.js";
/**
 * Legacy one-shot pipeline: generate → review → render a PREVIEW.
 *
 * It no longer delivers. Generation and delivery in one request cannot be made
 * retry-safe — a client that retries after a timeout gets a fresh template and
 * a fresh campaign, and a campaign-scoped idempotency key has nothing to
 * collide with. Rather than pretend otherwise, this path stops at the dry run.
 *
 * Real sending lives in the staged lifecycle, where the content a reviewer
 * approved is the content that ships:
 *
 *   POST /api/email-campaigns              → prepareEmailCampaign
 *   POST /api/email-campaigns/{id}/approve → approveEmailCampaign
 *   POST /api/email-campaigns/{id}/send    → dispatchEmailCampaign
 *
 * or `runAutomatedEmailCampaign` for unattended runs.
 */
export declare function runEmailCampaign(args: {
    companyId: number;
    name: string;
    goal?: string;
    recipients: Recipient[];
    /** Only "dry_run" is accepted; "send" raises a 410. */
    mode?: "dry_run";
    senderIdentity: string;
    unsubscribeBaseUrl: string;
    /** Persist a campaign + template version (audit). Default true. */
    persist?: boolean;
    actorUserId?: number | null;
}): Promise<{
    campaignId: number | null;
    template: EmailTemplate;
    review: TemplateReview;
    results: SendResult[];
}>;
//# sourceMappingURL=run.d.ts.map