import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import {
    emailCampaignApprovals,
    emailCampaigns,
    emailRecipients,
    emailSendAttempts,
    emailSends,
    emailSuppressions,
    emailTemplateVersions,
} from "./schema";

import {
    CampaignLifecycleError,
    DELIVERED_OR_IN_FLIGHT,
    TemplateReviewSchema,
    type ApprovalRecord,
    type CampaignRecord,
    type CampaignStatus,
    type EmailTemplate,
    type Recipient,
    type SendAttemptRecord,
    type SendMode,
    type SendResult,
    type TemplateReview,
    type TemplateSource,
    type TemplateVersion,
} from "./types";

/**
 * Persistence + safety lookups for the email pipeline.
 *
 * This module is the only place that writes campaign state. Two invariants it
 * exists to hold: template versions are append-only (never UPDATEd, because an
 * approval points at one), and a send attempt is unique per
 * (campaign, idempotency key), so a retried request replays instead of
 * delivering twice.
 */

// ────────────────────────────────────────────────────────────────────────────
// Suppression
// ────────────────────────────────────────────────────────────────────────────

/** Add an address to a company's suppression list (unsubscribe/bounce/manual). */
export async function addSuppression(
    companyId: number,
    email: string,
    reason: "unsubscribe" | "bounce" | "manual" = "unsubscribe"
): Promise<void> {
    const db = getDb();
    await db
        .insert(emailSuppressions)
        .values({
            companyId: BigInt(companyId),
            email: email.toLowerCase(),
            reason,
        })
        .onConflictDoNothing();
}

export async function isSuppressed(companyId: number, email: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
        .select({ email: emailSuppressions.email })
        .from(emailSuppressions)
        .where(
            and(
                eq(emailSuppressions.companyId, BigInt(companyId)),
                eq(emailSuppressions.email, email.toLowerCase())
            )
        )
        .limit(1);
    return rows.length > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Campaigns
// ────────────────────────────────────────────────────────────────────────────

type CampaignRow = typeof emailCampaigns.$inferSelect;

function toCampaign(row: CampaignRow): CampaignRecord {
    return {
        id: row.id,
        companyId: Number(row.companyId),
        name: row.name,
        goal: row.goal,
        status: row.status as CampaignStatus,
        approvedVersionId: row.approvedVersionId,
        automationKey: row.automationKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export async function createCampaign(args: {
    companyId: number;
    name: string;
    goal?: string | null;
    createdBy?: number | null;
}): Promise<CampaignRecord> {
    const db = getDb();
    const [row] = await db
        .insert(emailCampaigns)
        .values({
            companyId: BigInt(args.companyId),
            name: args.name,
            goal: args.goal ?? null,
            status: "draft",
            createdBy: args.createdBy ?? null,
        })
        .returning();
    if (!row) throw new Error("Failed to create email campaign");
    return toCampaign(row);
}

/**
 * Claim a company-scoped automation key BEFORE any generation happens.
 *
 * The per-campaign send key cannot make an unattended run retry-safe, because
 * a retry that creates its own campaign never collides with the first one.
 * This does: the unique (company_id, automation_key) index means the second
 * request loses the insert, reads back the original campaign, and resumes it
 * instead of generating and sending a second time.
 */
export async function claimAutomationCampaign(args: {
    companyId: number;
    name: string;
    goal?: string | null;
    automationKey: string;
    createdBy?: number | null;
}): Promise<{ campaign: CampaignRecord; created: boolean }> {
    const db = getDb();
    const [inserted] = await db
        .insert(emailCampaigns)
        .values({
            companyId: BigInt(args.companyId),
            name: args.name,
            goal: args.goal ?? null,
            status: "draft",
            automationKey: args.automationKey,
            createdBy: args.createdBy ?? null,
        })
        .onConflictDoNothing({
            target: [emailCampaigns.companyId, emailCampaigns.automationKey],
        })
        .returning();

    if (inserted) return { campaign: toCampaign(inserted), created: true };

    const [existing] = await db
        .select()
        .from(emailCampaigns)
        .where(
            and(
                eq(emailCampaigns.companyId, BigInt(args.companyId)),
                eq(emailCampaigns.automationKey, args.automationKey)
            )
        )
        .limit(1);
    if (!existing) throw new Error("Failed to claim an automation run key");
    return { campaign: toCampaign(existing), created: false };
}

/**
 * Load a campaign scoped to its company. Every lifecycle operation goes
 * through this — a campaign id from a request body is untrusted input, so it
 * is never resolved without the caller's company.
 */
export async function getCampaign(
    companyId: number,
    campaignId: number
): Promise<CampaignRecord | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(emailCampaigns)
        .where(
            and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.companyId, BigInt(companyId)))
        )
        .limit(1);
    return row ? toCampaign(row) : null;
}

/** Load a campaign or raise the 404 the routes surface. */
export async function requireCampaign(
    companyId: number,
    campaignId: number
): Promise<CampaignRecord> {
    const campaign = await getCampaign(companyId, campaignId);
    if (!campaign) {
        throw new CampaignLifecycleError(
            `Campaign ${campaignId} not found`,
            "campaign_not_found",
            404
        );
    }
    return campaign;
}

export async function setCampaignStatus(campaignId: number, status: CampaignStatus): Promise<void> {
    const db = getDb();
    await db
        .update(emailCampaigns)
        .set({ status, updatedAt: new Date() })
        .where(eq(emailCampaigns.id, campaignId));
}

export async function listCampaigns(companyId: number, limit = 50): Promise<CampaignRecord[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(emailCampaigns)
        .where(eq(emailCampaigns.companyId, BigInt(companyId)))
        .orderBy(desc(emailCampaigns.createdAt))
        .limit(limit);
    return rows.map(toCampaign);
}

// ────────────────────────────────────────────────────────────────────────────
// Template versions (append-only)
// ────────────────────────────────────────────────────────────────────────────

type VersionRow = typeof emailTemplateVersions.$inferSelect;

function toVersion(row: VersionRow): TemplateVersion {
    const review = row.review ? TemplateReviewSchema.safeParse(row.review) : null;
    return {
        id: row.id,
        campaignId: row.campaignId,
        version: row.version,
        template: {
            subject: row.subject,
            body: row.body,
            variables: row.variables ?? [],
        },
        source: row.source as TemplateSource,
        goal: row.goal,
        model: row.model,
        promptVersion: row.promptVersion,
        reviewVerdict: (row.reviewVerdict as "pass" | "revise" | null) ?? null,
        review: review?.success ? review.data : null,
        createdAt: row.createdAt,
    };
}

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
export async function appendTemplateVersion(args: {
    campaignId: number;
    template: EmailTemplate;
    source: TemplateSource;
    goal?: string | null;
    model?: string | null;
    promptVersion?: string | null;
    review?: TemplateReview | null;
    createdBy?: number | null;
}): Promise<TemplateVersion> {
    const db = getDb();

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const row = await db.transaction(async tx => {
                const [{ next } = { next: 1 }] = await tx
                    .select({
                        next: sql<number>`coalesce(max(${emailTemplateVersions.version}), 0) + 1`,
                    })
                    .from(emailTemplateVersions)
                    .where(eq(emailTemplateVersions.campaignId, args.campaignId));

                const [inserted] = await tx
                    .insert(emailTemplateVersions)
                    .values({
                        campaignId: args.campaignId,
                        version: Number(next),
                        subject: args.template.subject,
                        body: args.template.body,
                        variables: args.template.variables,
                        source: args.source,
                        goal: args.goal ?? null,
                        model: args.model ?? null,
                        promptVersion: args.promptVersion ?? null,
                        reviewVerdict: args.review?.verdict ?? null,
                        review: args.review ?? null,
                        createdBy: args.createdBy ?? null,
                    })
                    .returning();
                if (!inserted) throw new Error("Failed to persist template version");

                // New content on the table ⇒ nothing is cleared for delivery.
                await tx
                    .update(emailCampaignApprovals)
                    .set({ revokedAt: new Date() })
                    .where(
                        and(
                            eq(emailCampaignApprovals.campaignId, args.campaignId),
                            isNull(emailCampaignApprovals.revokedAt)
                        )
                    );
                await tx
                    .update(emailCampaigns)
                    .set({ approvedVersionId: null, updatedAt: new Date() })
                    .where(eq(emailCampaigns.id, args.campaignId));

                return inserted;
            });

            return toVersion(row);
        } catch (err) {
            if (attempt === 2 || !isUniqueViolation(err)) throw err;
        }
    }

    throw new Error("Failed to allocate a template version number");
}

function isUniqueViolation(err: unknown): boolean {
    // drizzle-orm ≥0.45 wraps driver errors in DrizzleQueryError with the
    // original error on `cause`, so check both levels.
    let current: unknown = err;
    for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
        if ((current as { code?: unknown }).code === "23505") return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

export async function getTemplateVersion(
    campaignId: number,
    versionId: number
): Promise<TemplateVersion | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(emailTemplateVersions)
        .where(
            and(
                eq(emailTemplateVersions.id, versionId),
                eq(emailTemplateVersions.campaignId, campaignId)
            )
        )
        .limit(1);
    return row ? toVersion(row) : null;
}

export async function getLatestTemplateVersion(
    campaignId: number
): Promise<TemplateVersion | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(emailTemplateVersions)
        .where(eq(emailTemplateVersions.campaignId, campaignId))
        .orderBy(desc(emailTemplateVersions.version))
        .limit(1);
    return row ? toVersion(row) : null;
}

export async function listTemplateVersions(campaignId: number): Promise<TemplateVersion[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(emailTemplateVersions)
        .where(eq(emailTemplateVersions.campaignId, campaignId))
        .orderBy(asc(emailTemplateVersions.version));
    return rows.map(toVersion);
}

// ────────────────────────────────────────────────────────────────────────────
// Approvals
// ────────────────────────────────────────────────────────────────────────────

type ApprovalRow = typeof emailCampaignApprovals.$inferSelect;

function toApproval(row: ApprovalRow): ApprovalRecord {
    return {
        id: row.id,
        campaignId: row.campaignId,
        templateVersionId: row.templateVersionId,
        approvedBy: row.approvedBy,
        approvedByEmail: row.approvedByEmail,
        approvedByKind: row.approvedByKind as "human" | "automation",
        reviewVerdict: row.reviewVerdict,
        overrideReason: row.overrideReason,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
    };
}

/**
 * Record an approval and point the campaign at that exact version. Any prior
 * live approval is revoked rather than deleted, so the audit trail keeps every
 * decision that was ever made.
 */
export async function recordApproval(args: {
    campaignId: number;
    templateVersionId: number;
    approvedBy?: number | null;
    approvedByEmail?: string | null;
    approvedByKind: "human" | "automation";
    reviewVerdict?: string | null;
    overrideReason?: string | null;
}): Promise<ApprovalRecord> {
    const db = getDb();
    return db.transaction(async tx => {
        await tx
            .update(emailCampaignApprovals)
            .set({ revokedAt: new Date() })
            .where(
                and(
                    eq(emailCampaignApprovals.campaignId, args.campaignId),
                    isNull(emailCampaignApprovals.revokedAt)
                )
            );

        const [row] = await tx
            .insert(emailCampaignApprovals)
            .values({
                campaignId: args.campaignId,
                templateVersionId: args.templateVersionId,
                approvedBy: args.approvedBy ?? null,
                approvedByEmail: args.approvedByEmail ?? null,
                approvedByKind: args.approvedByKind,
                reviewVerdict: args.reviewVerdict ?? null,
                overrideReason: args.overrideReason ?? null,
            })
            .returning();
        if (!row) throw new Error("Failed to record campaign approval");

        await tx
            .update(emailCampaigns)
            .set({
                approvedVersionId: args.templateVersionId,
                status: "approved",
                updatedAt: new Date(),
            })
            .where(eq(emailCampaigns.id, args.campaignId));

        return toApproval(row);
    });
}

export async function listApprovals(campaignId: number): Promise<ApprovalRecord[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(emailCampaignApprovals)
        .where(eq(emailCampaignApprovals.campaignId, campaignId))
        .orderBy(desc(emailCampaignApprovals.createdAt));
    return rows.map(toApproval);
}

// ────────────────────────────────────────────────────────────────────────────
// Recipients
// ────────────────────────────────────────────────────────────────────────────

type RecipientRow = typeof emailRecipients.$inferSelect;

function toRecipient(row: RecipientRow): Recipient {
    return {
        email: row.email,
        name: row.name,
        company: row.company,
        contextNotes: row.contextNotes,
        vars: row.vars ?? {},
    };
}

export async function listRecipients(campaignId: number): Promise<Recipient[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(emailRecipients)
        .where(eq(emailRecipients.campaignId, campaignId))
        .orderBy(asc(emailRecipients.id));
    return rows.map(toRecipient);
}

/**
 * Persist the campaign's audience. Idempotent on (campaign, email): calling it
 * again with the same list is a no-op, so a retried dispatch cannot duplicate
 * the audience.
 */
export async function upsertRecipients(campaignId: number, recipients: Recipient[]): Promise<void> {
    if (recipients.length === 0) return;
    const db = getDb();

    // Once the audience is frozen, additions are ignored: the approved template
    // and the audience it was approved for stay together. Retries re-sending
    // the same list are unaffected (they conflict-no-op anyway); only NEW
    // addresses smuggled in after the freeze are refused.
    const [frozen] = await db
        .select({ id: emailRecipients.id })
        .from(emailRecipients)
        .where(and(eq(emailRecipients.campaignId, campaignId), isNotNull(emailRecipients.frozenAt)))
        .limit(1);
    if (frozen) return;

    // Dedup in-memory first: ON CONFLICT cannot resolve two conflicting rows
    // inside the same INSERT.
    const byEmail = new Map<string, Recipient>();
    for (const r of recipients) byEmail.set(r.email.toLowerCase(), r);

    await db
        .insert(emailRecipients)
        .values(
            [...byEmail.entries()].map(([email, r]) => ({
                campaignId,
                email,
                name: r.name,
                company: r.company,
                contextNotes: r.contextNotes,
                vars: r.vars,
            }))
        )
        .onConflictDoNothing();
}

/**
 * Freeze the audience for delivery. The first dispatch locks the list; later
 * dispatches reuse it and ignore whatever the request supplied, so the
 * approved template and the audience it was approved for stay together.
 */
export async function freezeRecipients(
    campaignId: number,
    candidates: Recipient[]
): Promise<{ recipients: Recipient[]; alreadyFrozen: boolean }> {
    const db = getDb();
    // Probe for a FROZEN row specifically — an arbitrary row could be an
    // unfrozen straggler and would make the answer nondeterministic.
    const [frozenRow] = await db
        .select({ id: emailRecipients.id })
        .from(emailRecipients)
        .where(and(eq(emailRecipients.campaignId, campaignId), isNotNull(emailRecipients.frozenAt)))
        .limit(1);

    const alreadyFrozen = Boolean(frozenRow);

    if (!alreadyFrozen) {
        await upsertRecipients(campaignId, candidates);
        await db
            .update(emailRecipients)
            .set({ frozenAt: new Date() })
            .where(
                and(eq(emailRecipients.campaignId, campaignId), isNull(emailRecipients.frozenAt))
            );
    }

    // Return only the frozen audience: rows added after the freeze (by any
    // path) are never part of what an approved dispatch delivers to.
    const rows = await db
        .select()
        .from(emailRecipients)
        .where(and(eq(emailRecipients.campaignId, campaignId), isNotNull(emailRecipients.frozenAt)))
        .orderBy(asc(emailRecipients.id));
    return { recipients: rows.map(toRecipient), alreadyFrozen };
}

/**
 * Roll each delivery outcome back onto the recipient row.
 *
 * One UPDATE per status group (≤6 statuses) instead of one per recipient — a
 * 500-recipient campaign previously fired 500 concurrent UPDATEs through the
 * pool. A `sent` row is never downgraded: a later attempt legitimately reports
 * `skipped`/`suppressed` for an address an earlier attempt delivered to, and
 * the recipient's denormalized status should keep saying it was sent.
 */
export async function applyRecipientStatuses(
    campaignId: number,
    results: SendResult[]
): Promise<void> {
    if (results.length === 0) return;
    const db = getDb();

    const byStatus = new Map<SendResult["status"], string[]>();
    for (const r of results) {
        const emails = byStatus.get(r.status) ?? [];
        emails.push(r.recipientEmail.toLowerCase());
        byStatus.set(r.status, emails);
    }

    for (const [status, emails] of byStatus) {
        await db
            .update(emailRecipients)
            .set({ status })
            .where(
                and(
                    eq(emailRecipients.campaignId, campaignId),
                    inArray(emailRecipients.email, emails),
                    ...(status === "sent" ? [] : [sql`${emailRecipients.status} <> 'sent'`])
                )
            );
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Send attempts + sends
// ────────────────────────────────────────────────────────────────────────────

type AttemptRow = typeof emailSendAttempts.$inferSelect;

function toAttempt(row: AttemptRow): SendAttemptRecord {
    return {
        id: row.id,
        campaignId: row.campaignId,
        templateVersionId: row.templateVersionId,
        idempotencyKey: row.idempotencyKey,
        mode: row.mode as SendMode,
        status: row.status as SendAttemptRecord["status"],
        recipientCount: row.recipientCount,
        sentCount: row.sentCount,
        failedCount: row.failedCount,
        suppressedCount: row.suppressedCount,
        skippedCount: row.skippedCount,
        error: row.error,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
    };
}

/**
 * Claim a send attempt for an idempotency key. `created: false` means this key
 * has been seen before — the caller must replay the existing attempt instead of
 * delivering again. The unique index does the arbitration, so two concurrent
 * retries cannot both win.
 */
export async function claimSendAttempt(args: {
    campaignId: number;
    templateVersionId: number;
    idempotencyKey: string;
    mode: SendMode;
    requestedBy?: number | null;
    recipientCount: number;
}): Promise<{ attempt: SendAttemptRecord; created: boolean }> {
    const db = getDb();
    const [inserted] = await db
        .insert(emailSendAttempts)
        .values({
            campaignId: args.campaignId,
            templateVersionId: args.templateVersionId,
            idempotencyKey: args.idempotencyKey,
            mode: args.mode,
            status: "running",
            requestedBy: args.requestedBy ?? null,
            recipientCount: args.recipientCount,
        })
        .onConflictDoNothing({
            target: [emailSendAttempts.campaignId, emailSendAttempts.idempotencyKey],
        })
        .returning();

    if (inserted) return { attempt: toAttempt(inserted), created: true };

    const [existing] = await db
        .select()
        .from(emailSendAttempts)
        .where(
            and(
                eq(emailSendAttempts.campaignId, args.campaignId),
                eq(emailSendAttempts.idempotencyKey, args.idempotencyKey)
            )
        )
        .limit(1);
    if (!existing) throw new Error("Failed to claim a send attempt");
    return { attempt: toAttempt(existing), created: false };
}

export async function completeSendAttempt(args: {
    attemptId: number;
    status: "completed" | "failed";
    results: SendResult[];
    error?: string | null;
}): Promise<void> {
    const db = getDb();
    const count = (s: SendResult["status"]) => args.results.filter(r => r.status === s).length;

    await db
        .update(emailSendAttempts)
        .set({
            status: args.status,
            sentCount: count("sent"),
            failedCount: count("failed"),
            suppressedCount: count("suppressed"),
            skippedCount: count("skipped"),
            error: args.error ?? null,
            completedAt: new Date(),
        })
        .where(eq(emailSendAttempts.id, args.attemptId));
}

/**
 * Reserve one recipient of one attempt BEFORE the provider is called.
 *
 * Returns false when a row already exists, which means some earlier pass over
 * this attempt already reached this address — possibly delivering to it. The
 * caller must then skip rather than retry: a lost duplicate is recoverable,
 * a duplicate delivery is not.
 */
export async function claimRecipientSend(args: {
    campaignId: number;
    attemptId: number;
    recipientEmail: string;
    subject?: string | null;
    providerIdempotencyKey?: string | null;
}): Promise<boolean> {
    const db = getDb();
    const [row] = await db
        .insert(emailSends)
        .values({
            campaignId: args.campaignId,
            attemptId: args.attemptId,
            recipientEmail: args.recipientEmail,
            subject: args.subject ?? null,
            status: "queued",
            providerIdempotencyKey: args.providerIdempotencyKey ?? null,
        })
        // No conflict target: a clash with EITHER unique index refuses the claim —
        // the per-attempt one (this attempt already claimed the address) or the
        // campaign-level partial one (a concurrent attempt under a different
        // idempotency key holds it in `queued`/`sent`). Both mean "may already
        // have been delivered", so the caller must skip, never retry.
        .onConflictDoNothing()
        .returning({ id: emailSends.id });
    return Boolean(row);
}

/**
 * Write one outcome. Upserts because only real deliveries are claimed first —
 * a suppressed, skipped or dry-run recipient has no reservation to update, but
 * still belongs in the audit trail.
 */
export async function recordSendOutcome(args: {
    campaignId: number;
    attemptId: number;
    subject?: string | null;
    result: SendResult;
}): Promise<void> {
    const db = getDb();
    await db
        .insert(emailSends)
        .values({
            campaignId: args.campaignId,
            attemptId: args.attemptId,
            recipientEmail: args.result.recipientEmail,
            subject: args.subject ?? null,
            status: args.result.status,
            providerMessageId: args.result.providerMessageId ?? null,
            error: args.result.error ?? null,
            sentAt: args.result.status === "sent" ? new Date() : null,
        })
        .onConflictDoUpdate({
            target: [emailSends.attemptId, emailSends.recipientEmail],
            set: {
                status: args.result.status,
                providerMessageId: args.result.providerMessageId ?? null,
                error: args.result.error ?? null,
                sentAt: args.result.status === "sent" ? new Date() : null,
            },
        });
}

/**
 * Bulk variant of {@link recordSendOutcome} for outcomes with no delivery
 * reservation to protect (dry runs): one multi-row upsert per chunk instead of
 * one round-trip per recipient. Chunked so a 500-recipient campaign does not
 * build a single statement with thousands of parameters.
 */
export async function recordSendOutcomes(args: {
    campaignId: number;
    attemptId: number;
    outcomes: Array<{ subject?: string | null; result: SendResult }>;
}): Promise<void> {
    if (args.outcomes.length === 0) return;
    const db = getDb();
    const CHUNK = 100;
    for (let i = 0; i < args.outcomes.length; i += CHUNK) {
        const chunk = args.outcomes.slice(i, i + CHUNK);
        await db
            .insert(emailSends)
            .values(
                chunk.map(({ subject, result }) => ({
                    campaignId: args.campaignId,
                    attemptId: args.attemptId,
                    recipientEmail: result.recipientEmail,
                    subject: subject ?? null,
                    status: result.status,
                    providerMessageId: result.providerMessageId ?? null,
                    error: result.error ?? null,
                    sentAt: result.status === "sent" ? new Date() : null,
                }))
            )
            .onConflictDoUpdate({
                target: [emailSends.attemptId, emailSends.recipientEmail],
                set: {
                    status: sql`excluded.status`,
                    providerMessageId: sql`excluded.provider_message_id`,
                    error: sql`excluded.error`,
                    sentAt: sql`excluded.sent_at`,
                },
            });
    }
}

/** Keep a long-running attempt visibly alive so recovery leaves it alone. */
export async function touchSendAttempt(attemptId: number): Promise<void> {
    const db = getDb();
    await db
        .update(emailSendAttempts)
        .set({ heartbeatAt: new Date() })
        .where(eq(emailSendAttempts.id, attemptId));
}

/**
 * Reclaim attempts whose process died mid-delivery.
 *
 * Without this a crashed attempt stays `running` forever and its idempotency
 * key answers every retry with "already in progress" — the campaign is wedged.
 * Reclaiming marks it `abandoned` and leaves its `queued` rows exactly as they
 * are, so those addresses stay blocked from re-delivery while the rest of the
 * audience can still be sent to under a new key.
 */
export async function reclaimAbandonedAttempts(
    campaignId: number,
    staleAfterMs: number
): Promise<number> {
    const db = getDb();
    const cutoff = new Date(Date.now() - staleAfterMs);
    const rows = await db
        .update(emailSendAttempts)
        .set({
            status: "abandoned",
            error: "Attempt was interrupted; recipients left in-flight are not retried.",
            completedAt: new Date(),
        })
        .where(
            and(
                eq(emailSendAttempts.campaignId, campaignId),
                eq(emailSendAttempts.status, "running"),
                lt(emailSendAttempts.heartbeatAt, cutoff)
            )
        )
        .returning({ id: emailSendAttempts.id });
    return rows.length;
}

/** Replay a completed attempt's per-recipient outcomes. */
export async function attemptResults(attemptId: number): Promise<SendResult[]> {
    const db = getDb();
    const rows = await db
        .select({
            recipientEmail: emailSends.recipientEmail,
            status: emailSends.status,
            providerMessageId: emailSends.providerMessageId,
            error: emailSends.error,
        })
        .from(emailSends)
        .where(eq(emailSends.attemptId, attemptId))
        .orderBy(asc(emailSends.id));

    return rows.map(r => ({
        recipientEmail: r.recipientEmail,
        status: r.status as SendResult["status"],
        ...(r.providerMessageId ? { providerMessageId: r.providerMessageId } : {}),
        ...(r.error ? { error: r.error } : {}),
    }));
}

export async function listSendAttempts(campaignId: number): Promise<SendAttemptRecord[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(emailSendAttempts)
        .where(eq(emailSendAttempts.campaignId, campaignId))
        .orderBy(desc(emailSendAttempts.startedAt));
    return rows.map(toAttempt);
}

/**
 * Addresses this campaign must never deliver to again — feeds cross-attempt
 * idempotency.
 *
 * Includes `queued` as well as `sent`: a claim row with no outcome is one the
 * provider may or may not have accepted before the process died, and the only
 * safe reading of "may have been sent" is "do not send again".
 */
export async function sentEmails(campaignId: number): Promise<Set<string>> {
    const db = getDb();
    // Filter in SQL: this table grows by recipients × attempts, and only the
    // delivered-or-in-flight rows matter here.
    const rows = await db
        .selectDistinct({ email: emailSends.recipientEmail })
        .from(emailSends)
        .where(
            and(
                eq(emailSends.campaignId, campaignId),
                inArray(emailSends.status, [...DELIVERED_OR_IN_FLIGHT])
            )
        );
    return new Set(rows.map(r => r.email));
}

/**
 * The subset of `emails` that is suppressed for this company, lower-cased —
 * one query for the whole audience instead of one per recipient.
 */
export async function suppressedEmails(companyId: number, emails: string[]): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    const db = getDb();
    const rows = await db
        .select({ email: emailSuppressions.email })
        .from(emailSuppressions)
        .where(
            and(
                eq(emailSuppressions.companyId, BigInt(companyId)),
                inArray(
                    emailSuppressions.email,
                    emails.map(e => e.toLowerCase())
                )
            )
        );
    return new Set(rows.map(r => r.email));
}
