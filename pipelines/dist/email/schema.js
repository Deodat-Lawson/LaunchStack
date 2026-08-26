import { sql } from "drizzle-orm";
import {
    bigint,
    index,
    integer,
    jsonb,
    serial,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";
/**
 * Email outreach pipeline tables — a staged campaign lifecycle.
 *
 *   campaign ──┬── template versions (immutable, append-only)
 *              ├── approvals        (which version, by whom, when, why)
 *              ├── recipients       (frozen at first dispatch)
 *              └── send attempts ── sends (one row per recipient per attempt)
 *
 * The rule the schema exists to enforce: **sending never generates content**.
 * A dispatch loads one already-approved, immutable template version. Because
 * generation and delivery are separate transitions, retrying a send can never
 * produce different content, and suppressions are per-company so an
 * unsubscribe/bounce is honored across all future campaigns.
 */
export const emailCampaigns = pgTable(
    "email_campaigns",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        name: varchar("name", { length: 256 }).notNull(),
        /** The generation goal, kept so regenerating a version is reproducible. */
        goal: text("goal"),
        /** draft | needs_revision | pending_approval | approved | sending | sent | failed */
        status: varchar("status", { length: 20 }).notNull().default("draft"),
        /**
         * The version cleared for delivery. NULL until a human (or an explicit
         * automation policy) approves one — `/send` refuses while it is NULL, and
         * appending a new version clears it again.
         */
        approvedVersionId: integer("approved_version_id").references(
            () => emailTemplateVersions.id,
            { onDelete: "set null" }
        ),
        /**
         * Idempotency key for unattended runs, claimed BEFORE any generation.
         * Unique per company, so retrying `/api/email-campaign-runs` with the same
         * key resumes this campaign instead of generating a second one — the
         * per-campaign send key cannot help when the retry would create a new
         * campaign in the first place.
         */
        automationKey: varchar("automation_key", { length: 200 }),
        createdBy: integer("created_by"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    t => [
        index("email_campaigns_company_idx").on(t.companyId),
        index("email_campaigns_company_status_idx").on(t.companyId, t.status),
        uniqueIndex("email_campaigns_company_automation_key_uq").on(t.companyId, t.automationKey),
    ]
);
/**
 * Every generation and every human edit appends a row here. Rows are NEVER
 * updated or deleted — an approval points at one, so mutating it would
 * retroactively change what was approved and what was sent.
 */
export const emailTemplateVersions = pgTable(
    "email_template_versions",
    {
        id: serial("id").primaryKey(),
        campaignId: integer("campaign_id")
            .notNull()
            .references(() => emailCampaigns.id, { onDelete: "cascade" }),
        /** 1-based, contiguous per campaign. */
        version: integer("version").notNull(),
        subject: text("subject").notNull(),
        body: text("body").notNull(),
        variables: jsonb("variables").$type(),
        /** ai_generated | human_edited */
        source: varchar("source", { length: 20 }).notNull().default("ai_generated"),
        /** The goal this version was generated from (NULL for human edits). */
        goal: text("goal"),
        model: varchar("model", { length: 64 }),
        promptVersion: varchar("prompt_version", { length: 32 }),
        /** pass | revise — NULL when the version was not reviewed. */
        reviewVerdict: varchar("review_verdict", { length: 16 }),
        /** Full TemplateReview payload (scores, issues, summary). */
        review: jsonb("review"),
        createdBy: integer("created_by"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    t => [
        index("email_template_versions_campaign_idx").on(t.campaignId),
        uniqueIndex("email_template_versions_campaign_version_uq").on(t.campaignId, t.version),
    ]
);
/**
 * Approval audit. Append-only: approving a different version revokes the
 * previous row (`revoked_at`) rather than overwriting it, so "what was
 * approved when, and who decided" survives every later change.
 */
export const emailCampaignApprovals = pgTable(
    "email_campaign_approvals",
    {
        id: serial("id").primaryKey(),
        campaignId: integer("campaign_id")
            .notNull()
            .references(() => emailCampaigns.id, { onDelete: "cascade" }),
        templateVersionId: integer("template_version_id")
            .notNull()
            .references(() => emailTemplateVersions.id, { onDelete: "cascade" }),
        approvedBy: integer("approved_by"),
        /** Durable label — survives the user row being deleted. */
        approvedByEmail: varchar("approved_by_email", { length: 320 }),
        /** human | automation */
        approvedByKind: varchar("approved_by_kind", { length: 16 }).notNull().default("human"),
        /** The review verdict at approval time. */
        reviewVerdict: varchar("review_verdict", { length: 16 }),
        /** Required when approving a version whose review did not pass. */
        overrideReason: text("override_reason"),
        revokedAt: timestamp("revoked_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    t => [
        index("email_campaign_approvals_campaign_idx").on(t.campaignId),
        index("email_campaign_approvals_version_idx").on(t.templateVersionId),
    ]
);
/**
 * The campaign's audience, frozen at first dispatch. Unique per (campaign,
 * email) so re-freezing is idempotent and a list can never contain the same
 * address twice.
 */
export const emailRecipients = pgTable(
    "email_recipients",
    {
        id: serial("id").primaryKey(),
        campaignId: integer("campaign_id")
            .notNull()
            .references(() => emailCampaigns.id, { onDelete: "cascade" }),
        email: varchar("email", { length: 320 }).notNull(),
        name: varchar("name", { length: 256 }),
        company: varchar("company", { length: 256 }),
        contextNotes: text("context_notes"),
        /** Per-recipient merge variables. */
        vars: jsonb("vars").$type(),
        /** pending | dry_run | sent | failed | suppressed | skipped */
        status: varchar("status", { length: 20 }).notNull().default("pending"),
        /** Set when a dispatch freezes the list; NULL while still editable. */
        frozenAt: timestamp("frozen_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    t => [
        index("email_recipients_campaign_idx").on(t.campaignId),
        uniqueIndex("email_recipients_campaign_email_uq").on(t.campaignId, t.email),
    ]
);
/**
 * One row per `/send` call. `idempotency_key` is unique per campaign, so a
 * client retry after a timeout resolves to the SAME attempt and replays its
 * recorded results instead of delivering a second time.
 */
export const emailSendAttempts = pgTable(
    "email_send_attempts",
    {
        id: serial("id").primaryKey(),
        campaignId: integer("campaign_id")
            .notNull()
            .references(() => emailCampaigns.id, { onDelete: "cascade" }),
        /** The exact version delivered — resolved before any recipient is touched. */
        templateVersionId: integer("template_version_id")
            .notNull()
            .references(() => emailTemplateVersions.id, { onDelete: "cascade" }),
        idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
        /** dry_run | send */
        mode: varchar("mode", { length: 16 }).notNull().default("dry_run"),
        /** running | completed | failed | abandoned */
        status: varchar("status", { length: 16 }).notNull().default("running"),
        requestedBy: integer("requested_by"),
        /**
         * Bumped as the attempt progresses. A `running` attempt whose heartbeat has
         * gone stale is one whose process died mid-delivery; recovery marks it
         * `abandoned` so the campaign is not wedged forever, while its per-recipient
         * claim rows keep those addresses from being delivered to a second time.
         */
        heartbeatAt: timestamp("heartbeat_at").defaultNow().notNull(),
        recipientCount: integer("recipient_count").notNull().default(0),
        sentCount: integer("sent_count").notNull().default(0),
        failedCount: integer("failed_count").notNull().default(0),
        suppressedCount: integer("suppressed_count").notNull().default(0),
        skippedCount: integer("skipped_count").notNull().default(0),
        error: text("error"),
        startedAt: timestamp("started_at").defaultNow().notNull(),
        completedAt: timestamp("completed_at"),
    },
    t => [
        index("email_send_attempts_campaign_idx").on(t.campaignId),
        uniqueIndex("email_send_attempts_campaign_key_uq").on(t.campaignId, t.idempotencyKey),
    ]
);
/**
 * One row per recipient per attempt — both the delivery audit trail and the
 * delivery CLAIM.
 *
 * A row is inserted with status `queued` BEFORE the provider is called, and
 * updated with the outcome after. That ordering is what makes delivery
 * crash-safe: if the process dies between the two, the row survives as
 * `queued`, which every later attempt reads as "may already have been
 * delivered" and refuses to send again. Losing a duplicate is recoverable;
 * sending one is not.
 */
export const emailSends = pgTable(
    "email_sends",
    {
        id: serial("id").primaryKey(),
        campaignId: integer("campaign_id")
            .notNull()
            .references(() => emailCampaigns.id, { onDelete: "cascade" }),
        attemptId: integer("attempt_id")
            .notNull()
            .references(() => emailSendAttempts.id, { onDelete: "cascade" }),
        recipientId: integer("recipient_id").references(() => emailRecipients.id, {
            onDelete: "set null",
        }),
        recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
        subject: text("subject"),
        /** queued | dry_run | sent | failed | suppressed | skipped */
        status: varchar("status", { length: 20 }).notNull().default("queued"),
        providerMessageId: varchar("provider_message_id", { length: 256 }),
        /**
         * The key handed to the provider so its own dedup catches anything ours
         * misses — the last line of defence against a double delivery.
         */
        providerIdempotencyKey: varchar("provider_idempotency_key", { length: 256 }),
        error: text("error"),
        sentAt: timestamp("sent_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    t => [
        index("email_sends_campaign_idx").on(t.campaignId),
        uniqueIndex("email_sends_attempt_recipient_uq").on(t.attemptId, t.recipientEmail),
        // Campaign-level delivery claim: at most one in-flight-or-delivered row per
        // address per campaign, regardless of attempt. This is what stops two
        // concurrent sends under *different* idempotency keys from both claiming
        // the same recipient — the attempt-scoped index above cannot arbitrate
        // across attempts.
        uniqueIndex("email_sends_campaign_recipient_delivery_uq")
            .on(t.campaignId, t.recipientEmail)
            .where(sql`status IN ('queued', 'sent')`),
    ]
);
export const emailSuppressions = pgTable(
    "email_suppressions",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        email: varchar("email", { length: 320 }).notNull(),
        reason: varchar("reason", { length: 20 }).notNull().default("unsubscribe"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    t => [uniqueIndex("email_suppressions_company_email_uq").on(t.companyId, t.email)]
);
//# sourceMappingURL=schema.js.map
