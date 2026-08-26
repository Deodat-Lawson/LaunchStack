import { type ApprovalRecord, type CampaignRecord, type CampaignStatus, type EmailTemplate, type Recipient, type SendAttemptRecord, type SendMode, type SendResult, type TemplateReview, type TemplateSource, type TemplateVersion } from "./types.js";
/**
 * Persistence + safety lookups for the email pipeline.
 *
 * This module is the only place that writes campaign state. Two invariants it
 * exists to hold: template versions are append-only (never UPDATEd, because an
 * approval points at one), and a send attempt is unique per
 * (campaign, idempotency key), so a retried request replays instead of
 * delivering twice.
 */
/** Add an address to a company's suppression list (unsubscribe/bounce/manual). */
export declare function addSuppression(companyId: number, email: string, reason?: "unsubscribe" | "bounce" | "manual"): Promise<void>;
export declare function isSuppressed(companyId: number, email: string): Promise<boolean>;
export declare function createCampaign(args: {
    companyId: number;
    name: string;
    goal?: string | null;
    createdBy?: number | null;
}): Promise<CampaignRecord>;
/**
 * Claim a company-scoped automation key BEFORE any generation happens.
 *
 * The per-campaign send key cannot make an unattended run retry-safe, because
 * a retry that creates its own campaign never collides with the first one.
 * This does: the unique (company_id, automation_key) index means the second
 * request loses the insert, reads back the original campaign, and resumes it
 * instead of generating and sending a second time.
 */
export declare function claimAutomationCampaign(args: {
    companyId: number;
    name: string;
    goal?: string | null;
    automationKey: string;
    createdBy?: number | null;
}): Promise<{
    campaign: CampaignRecord;
    created: boolean;
}>;
/**
 * Load a campaign scoped to its company. Every lifecycle operation goes
 * through this — a campaign id from a request body is untrusted input, so it
 * is never resolved without the caller's company.
 */
export declare function getCampaign(companyId: number, campaignId: number): Promise<CampaignRecord | null>;
/** Load a campaign or raise the 404 the routes surface. */
export declare function requireCampaign(companyId: number, campaignId: number): Promise<CampaignRecord>;
export declare function setCampaignStatus(campaignId: number, status: CampaignStatus): Promise<void>;
export declare function listCampaigns(companyId: number, limit?: number): Promise<CampaignRecord[]>;
/**
 * Append a new immutable version and INVALIDATE any standing approval.
 *
 * The invalidation is the point. An approval clears one exact version; once
 * the campaign has different content on offer, that decision no longer
 * describes anything a human agreed to send. Leaving `approvedVersionId` in
 * place would let a later dispatch quietly ship the older approved version
 * while the UI shows the new draft — so the pointer is cleared and the live
 * approval revoked in the same transaction that adds the version.
 *
 * Version numbers are allocated inside the write, and the unique
 * (campaign, version) index is the arbiter if two generations race — the
 * loser retries with the next number rather than overwriting.
 */
export declare function appendTemplateVersion(args: {
    campaignId: number;
    template: EmailTemplate;
    source: TemplateSource;
    goal?: string | null;
    model?: string | null;
    promptVersion?: string | null;
    review?: TemplateReview | null;
    createdBy?: number | null;
}): Promise<TemplateVersion>;
export declare function getTemplateVersion(campaignId: number, versionId: number): Promise<TemplateVersion | null>;
export declare function getLatestTemplateVersion(campaignId: number): Promise<TemplateVersion | null>;
export declare function listTemplateVersions(campaignId: number): Promise<TemplateVersion[]>;
/**
 * Record an approval and point the campaign at that exact version. Any prior
 * live approval is revoked rather than deleted, so the audit trail keeps every
 * decision that was ever made.
 */
export declare function recordApproval(args: {
    campaignId: number;
    templateVersionId: number;
    approvedBy?: number | null;
    approvedByEmail?: string | null;
    approvedByKind: "human" | "automation";
    reviewVerdict?: string | null;
    overrideReason?: string | null;
}): Promise<ApprovalRecord>;
export declare function listApprovals(campaignId: number): Promise<ApprovalRecord[]>;
export declare function listRecipients(campaignId: number): Promise<Recipient[]>;
/**
 * Persist the campaign's audience. Idempotent on (campaign, email): calling it
 * again with the same list is a no-op, so a retried dispatch cannot duplicate
 * the audience.
 */
export declare function upsertRecipients(campaignId: number, recipients: Recipient[]): Promise<void>;
/**
 * Freeze the audience for delivery. The first dispatch locks the list; later
 * dispatches reuse it and ignore whatever the request supplied, so the
 * approved template and the audience it was approved for stay together.
 */
export declare function freezeRecipients(campaignId: number, candidates: Recipient[]): Promise<{
    recipients: Recipient[];
    alreadyFrozen: boolean;
}>;
/**
 * Roll each delivery outcome back onto the recipient row.
 *
 * One UPDATE per status group (≤6 statuses) instead of one per recipient — a
 * 500-recipient campaign previously fired 500 concurrent UPDATEs through the
 * pool. A `sent` row is never downgraded: a later attempt legitimately reports
 * `skipped`/`suppressed` for an address an earlier attempt delivered to, and
 * the recipient's denormalized status should keep saying it was sent.
 */
export declare function applyRecipientStatuses(campaignId: number, results: SendResult[]): Promise<void>;
/**
 * Claim a send attempt for an idempotency key. `created: false` means this key
 * has been seen before — the caller must replay the existing attempt instead of
 * delivering again. The unique index does the arbitration, so two concurrent
 * retries cannot both win.
 */
export declare function claimSendAttempt(args: {
    campaignId: number;
    templateVersionId: number;
    idempotencyKey: string;
    mode: SendMode;
    requestedBy?: number | null;
    recipientCount: number;
}): Promise<{
    attempt: SendAttemptRecord;
    created: boolean;
}>;
export declare function completeSendAttempt(args: {
    attemptId: number;
    status: "completed" | "failed";
    results: SendResult[];
    error?: string | null;
}): Promise<void>;
/**
 * Reserve one recipient of one attempt BEFORE the provider is called.
 *
 * Returns false when a row already exists, which means some earlier pass over
 * this attempt already reached this address — possibly delivering to it. The
 * caller must then skip rather than retry: a lost duplicate is recoverable,
 * a duplicate delivery is not.
 */
export declare function claimRecipientSend(args: {
    campaignId: number;
    attemptId: number;
    recipientEmail: string;
    subject?: string | null;
    providerIdempotencyKey?: string | null;
}): Promise<boolean>;
/**
 * Write one outcome. Upserts because only real deliveries are claimed first —
 * a suppressed, skipped or dry-run recipient has no reservation to update, but
 * still belongs in the audit trail.
 */
export declare function recordSendOutcome(args: {
    campaignId: number;
    attemptId: number;
    subject?: string | null;
    result: SendResult;
}): Promise<void>;
/**
 * Bulk variant of {@link recordSendOutcome} for outcomes with no delivery
 * reservation to protect (dry runs): one multi-row upsert per chunk instead of
 * one round-trip per recipient. Chunked so a 500-recipient campaign does not
 * build a single statement with thousands of parameters.
 */
export declare function recordSendOutcomes(args: {
    campaignId: number;
    attemptId: number;
    outcomes: Array<{
        subject?: string | null;
        result: SendResult;
    }>;
}): Promise<void>;
/** Keep a long-running attempt visibly alive so recovery leaves it alone. */
export declare function touchSendAttempt(attemptId: number): Promise<void>;
/**
 * Reclaim attempts whose process died mid-delivery.
 *
 * Without this a crashed attempt stays `running` forever and its idempotency
 * key answers every retry with "already in progress" — the campaign is wedged.
 * Reclaiming marks it `abandoned` and leaves its `queued` rows exactly as they
 * are, so those addresses stay blocked from re-delivery while the rest of the
 * audience can still be sent to under a new key.
 */
export declare function reclaimAbandonedAttempts(campaignId: number, staleAfterMs: number): Promise<number>;
/** Replay a completed attempt's per-recipient outcomes. */
export declare function attemptResults(attemptId: number): Promise<SendResult[]>;
export declare function listSendAttempts(campaignId: number): Promise<SendAttemptRecord[]>;
/**
 * Addresses this campaign must never deliver to again — feeds cross-attempt
 * idempotency.
 *
 * Includes `queued` as well as `sent`: a claim row with no outcome is one the
 * provider may or may not have accepted before the process died, and the only
 * safe reading of "may have been sent" is "do not send again".
 */
export declare function sentEmails(campaignId: number): Promise<Set<string>>;
/**
 * The subset of `emails` that is suppressed for this company, lower-cased —
 * one query for the whole audience instead of one per recipient.
 */
export declare function suppressedEmails(companyId: number, emails: string[]): Promise<Set<string>>;
//# sourceMappingURL=db.d.ts.map