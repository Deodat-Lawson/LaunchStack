/**
 * Product schema: in-app feedback — bug reports and feature requests.
 *
 * One table holds both kinds (`~/lib/feedback/contract`). A `bug` is private
 * to the person who filed it and the instance's triagers; an `idea` is on the
 * shared board, where everyone signed in can read it and vote for it.
 * Reports are instance-wide: triagers are the instance's operators
 * (`FEEDBACK_ADMIN_EMAILS`), not a workspace role, so `company_id` only
 * records where the reporter was when they filed it — nullable (the
 * workspace picker has no active workspace) and set null when that workspace
 * is deleted, because the report still belongs to the operator.
 *
 * People are auth subject ids (`varchar(256)`), the id every other "who did
 * it" column stores. Screenshots are re-encoded and kept in the row like
 * profile photos (`profile_images`), not in object storage: they are small,
 * few, and must never be reachable without the report's access check.
 *
 * `vote_count` is maintained in the transaction that adds or removes a vote
 * (an increment re-reads the row under its lock, so concurrent votes do not
 * lose one). `last_activity_at` is the newest of created / last reply / last
 * status change — the `updatedAt` the Feedback tab shows and sorts by.
 */
import { sql, type InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    customType,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

// Types only: drizzle-kit loads this file on its own, and the contract's
// values pull zod and the tool-tab helpers in with them.
import type {
    BugSeverity,
    FeedbackKind,
    FeedbackStatus,
    StoredFeedbackContext,
} from "~/lib/feedback/contract";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "bytea",
});

export const feedbackReports = pgTable(
    "feedback_reports",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        kind: varchar("kind", { length: 16 }).$type<FeedbackKind>().notNull(),
        title: varchar("title", { length: 200 }).notNull(),
        body: text("body").default("").notNull(),
        /** Bugs only; null for ideas and for a bug nobody rated. */
        severity: varchar("severity", { length: 16 }).$type<BugSeverity>(),
        status: varchar("status", { length: 16 }).$type<FeedbackStatus>().default("new").notNull(),
        /** Auth subject id of the person who filed it. */
        reporterUserId: varchar("reporter_user_id", { length: 256 }).notNull(),
        /** The reporter's active workspace when they filed it, if they had one. */
        companyId: bigint("company_id", { mode: "bigint" }).references(() => company.id, {
            onDelete: "set null",
        }),
        /** What the browser sent, plus the server's `appVersion` and `workspaceName`. */
        context: jsonb("context")
            .$type<StoredFeedbackContext>()
            .default(sql`'{}'::jsonb`)
            .notNull(),
        voteCount: integer("vote_count").default(0).notNull(),
        statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
        lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("feedback_reports_kind_status_created_idx").on(
            table.kind,
            table.status,
            table.createdAt
        ),
        index("feedback_reports_reporter_idx").on(table.reporterUserId, table.createdAt),
        index("feedback_reports_activity_idx").on(table.lastActivityAt),
        index("feedback_reports_company_idx").on(table.companyId),
    ]
);
export type FeedbackReportRow = InferSelectModel<typeof feedbackReports>;

/** A screenshot, re-encoded to WebP with its metadata stripped. */
export const feedbackAttachments = pgTable(
    "feedback_attachments",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        reportId: bigint("report_id", { mode: "number" })
            .notNull()
            .references(() => feedbackReports.id, { onDelete: "cascade" }),
        contentType: varchar("content_type", { length: 32 }).notNull(),
        width: integer("width"),
        height: integer("height"),
        byteSize: integer("byte_size").notNull(),
        data: bytea("data").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [index("feedback_attachments_report_idx").on(table.reportId)]
);
export type FeedbackAttachmentRow = InferSelectModel<typeof feedbackAttachments>;

/** One vote per person per idea. */
export const feedbackVotes = pgTable(
    "feedback_votes",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        reportId: bigint("report_id", { mode: "number" })
            .notNull()
            .references(() => feedbackReports.id, { onDelete: "cascade" }),
        /** Auth subject id of the voter. */
        userId: varchar("user_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [
        uniqueIndex("feedback_votes_report_user_unique").on(table.reportId, table.userId),
        index("feedback_votes_user_idx").on(table.userId),
    ]
);
export type FeedbackVoteRow = InferSelectModel<typeof feedbackVotes>;

/** The conversation under a report: the reporter and the triagers. */
export const feedbackReplies = pgTable(
    "feedback_replies",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        reportId: bigint("report_id", { mode: "number" })
            .notNull()
            .references(() => feedbackReports.id, { onDelete: "cascade" }),
        /** Auth subject id of the person who wrote it. */
        authorUserId: varchar("author_user_id", { length: 256 }).notNull(),
        /** Written by a triager — the tab labels it as the team's. */
        fromTeam: boolean("from_team").default(false).notNull(),
        body: text("body").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [index("feedback_replies_report_created_idx").on(table.reportId, table.createdAt)]
);
export type FeedbackReplyRow = InferSelectModel<typeof feedbackReplies>;
