import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@launchstack/core/db";
import {
  emailCampaignApprovals,
  emailCampaigns,
  emailRecipients,
  emailSendAttempts,
  emailSends,
  emailSuppressions,
  emailTemplateVersions,
} from "@launchstack/core/db/schema";

import {
  CampaignLifecycleError,
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
  reason: "unsubscribe" | "bounce" | "manual" = "unsubscribe",
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

export async function isSuppressed(
  companyId: number,
  email: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.companyId, BigInt(companyId)),
        eq(emailSuppressions.email, email.toLowerCase()),
      ),
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
 * Load a campaign scoped to its company. Every lifecycle operation goes
 * through this — a campaign id from a request body is untrusted input, so it
 * is never resolved without the caller's company.
 */
export async function getCampaign(
  companyId: number,
  campaignId: number,
): Promise<CampaignRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailCampaigns)
    .where(
      and(
        eq(emailCampaigns.id, campaignId),
        eq(emailCampaigns.companyId, BigInt(companyId)),
      ),
    )
    .limit(1);
  return row ? toCampaign(row) : null;
}

/** Load a campaign or raise the 404 the routes surface. */
export async function requireCampaign(
  companyId: number,
  campaignId: number,
): Promise<CampaignRecord> {
  const campaign = await getCampaign(companyId, campaignId);
  if (!campaign) {
    throw new CampaignLifecycleError(
      `Campaign ${campaignId} not found`,
      "campaign_not_found",
      404,
    );
  }
  return campaign;
}

export async function setCampaignStatus(
  campaignId: number,
  status: CampaignStatus,
): Promise<void> {
  const db = getDb();
  await db
    .update(emailCampaigns)
    .set({ status, updatedAt: new Date() })
    .where(eq(emailCampaigns.id, campaignId));
}

export async function listCampaigns(
  companyId: number,
  limit = 50,
): Promise<CampaignRecord[]> {
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
 * Append a new immutable version and refresh the campaign's denormalized
 * snapshot. Version numbers are allocated inside the write, and the unique
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
    const [{ next } = { next: 1 }] = await db
      .select({
        next: sql<number>`coalesce(max(${emailTemplateVersions.version}), 0) + 1`,
      })
      .from(emailTemplateVersions)
      .where(eq(emailTemplateVersions.campaignId, args.campaignId));

    try {
      const [row] = await db
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
      if (!row) throw new Error("Failed to persist template version");

      // Snapshot the latest version onto the campaign for pre-lifecycle
      // readers. The version row above stays the source of truth.
      await db
        .update(emailCampaigns)
        .set({
          subject: args.template.subject,
          body: args.template.body,
          model: args.model ?? null,
          promptVersion: args.promptVersion ?? null,
          templateVersion: String(row.version),
          updatedAt: new Date(),
        })
        .where(eq(emailCampaigns.id, args.campaignId));

      return toVersion(row);
    } catch (err) {
      if (attempt === 2 || !isUniqueViolation(err)) throw err;
    }
  }

  throw new Error("Failed to allocate a template version number");
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export async function getTemplateVersion(
  campaignId: number,
  versionId: number,
): Promise<TemplateVersion | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailTemplateVersions)
    .where(
      and(
        eq(emailTemplateVersions.id, versionId),
        eq(emailTemplateVersions.campaignId, campaignId),
      ),
    )
    .limit(1);
  return row ? toVersion(row) : null;
}

export async function getLatestTemplateVersion(
  campaignId: number,
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

export async function listTemplateVersions(
  campaignId: number,
): Promise<TemplateVersion[]> {
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
  return db.transaction(async (tx) => {
    await tx
      .update(emailCampaignApprovals)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(emailCampaignApprovals.campaignId, args.campaignId),
          isNull(emailCampaignApprovals.revokedAt),
        ),
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

export async function listApprovals(
  campaignId: number,
): Promise<ApprovalRecord[]> {
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
export async function upsertRecipients(
  campaignId: number,
  recipients: Recipient[],
): Promise<void> {
  if (recipients.length === 0) return;
  const db = getDb();

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
      })),
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
  candidates: Recipient[],
): Promise<{ recipients: Recipient[]; alreadyFrozen: boolean }> {
  const db = getDb();
  const existing = await db
    .select({ frozenAt: emailRecipients.frozenAt })
    .from(emailRecipients)
    .where(eq(emailRecipients.campaignId, campaignId))
    .limit(1);

  const alreadyFrozen = existing.length > 0 && existing[0]?.frozenAt !== null;

  if (!alreadyFrozen) {
    await upsertRecipients(campaignId, candidates);
    await db
      .update(emailRecipients)
      .set({ frozenAt: new Date() })
      .where(
        and(
          eq(emailRecipients.campaignId, campaignId),
          isNull(emailRecipients.frozenAt),
        ),
      );
  }

  return { recipients: await listRecipients(campaignId), alreadyFrozen };
}

/** Roll each delivery outcome back onto the recipient row. */
export async function applyRecipientStatuses(
  campaignId: number,
  results: SendResult[],
): Promise<void> {
  if (results.length === 0) return;
  const db = getDb();
  await Promise.all(
    results.map((r) =>
      db
        .update(emailRecipients)
        .set({ status: r.status })
        .where(
          and(
            eq(emailRecipients.campaignId, campaignId),
            eq(emailRecipients.email, r.recipientEmail.toLowerCase()),
          ),
        ),
    ),
  );
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
    status: row.status as "running" | "completed" | "failed",
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
        eq(emailSendAttempts.idempotencyKey, args.idempotencyKey),
      ),
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
  const count = (s: SendResult["status"]) =>
    args.results.filter((r) => r.status === s).length;

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

export async function saveSends(args: {
  campaignId: number;
  attemptId: number | null;
  subject?: string | null;
  results: SendResult[];
}): Promise<void> {
  if (args.results.length === 0) return;
  const db = getDb();
  await db
    .insert(emailSends)
    .values(
      args.results.map((r) => ({
        campaignId: args.campaignId,
        attemptId: args.attemptId,
        recipientEmail: r.recipientEmail,
        subject: args.subject ?? null,
        status: r.status,
        providerMessageId: r.providerMessageId ?? null,
        error: r.error ?? null,
        sentAt: r.status === "sent" ? new Date() : null,
      })),
    )
    .onConflictDoNothing();
}

/** Replay a completed attempt's per-recipient outcomes. */
export async function attemptResults(
  attemptId: number,
): Promise<SendResult[]> {
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

  return rows.map((r) => ({
    recipientEmail: r.recipientEmail,
    status: r.status as SendResult["status"],
    ...(r.providerMessageId ? { providerMessageId: r.providerMessageId } : {}),
    ...(r.error ? { error: r.error } : {}),
  }));
}

export async function listSendAttempts(
  campaignId: number,
): Promise<SendAttemptRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(emailSendAttempts)
    .where(eq(emailSendAttempts.campaignId, campaignId))
    .orderBy(desc(emailSendAttempts.startedAt));
  return rows.map(toAttempt);
}

/** Emails already delivered for a campaign — feeds cross-attempt idempotency. */
export async function sentEmails(campaignId: number): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({
      email: emailSends.recipientEmail,
      status: emailSends.status,
    })
    .from(emailSends)
    .where(eq(emailSends.campaignId, campaignId));
  return new Set(rows.filter((r) => r.status === "sent").map((r) => r.email));
}
