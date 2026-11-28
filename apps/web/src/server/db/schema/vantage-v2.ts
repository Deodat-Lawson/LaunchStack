import { sql } from "drizzle-orm";
import { bigint, integer, text, timestamp, uuid, unique, index, check } from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";
import { vantageWeeklyReviewRuns } from "./vantage-weekly-review";
export const vantageV2Settings = pgTable(
    "vantage_v2_settings",
    {
        id: uuid("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        ownerId: text("owner_id").notNull(),
        ciphertext: text("ciphertext").notNull(),
    },
    t => ({ owner: unique("vantage_v2_settings_owner").on(t.companyId, t.ownerId) })
);
export const vantageV2Plans = pgTable(
    "vantage_v2_plans",
    {
        id: uuid("id").primaryKey(),
        reviewId: uuid("review_id")
            .notNull()
            .references(() => vantageWeeklyReviewRuns.id),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        ownerId: text("owner_id").notNull(),
        version: integer("version").notNull().default(1),
        hash: text("hash").notNull(),
        approvedVersion: integer("approved_version"),
        approvedHash: text("approved_hash"),
        ciphertext: text("ciphertext").notNull(),
    },
    t => ({
        review: unique("vantage_v2_plan_review").on(t.reviewId),
        approval: check(
            "vantage_v2_plan_approval",
            sql`(${t.approvedVersion} IS NULL AND ${t.approvedHash} IS NULL) OR (${t.approvedVersion}=${t.version} AND ${t.approvedHash}=${t.hash})`
        ),
    })
);
export const vantageV2Tasks = pgTable(
    "vantage_v2_tasks",
    {
        id: uuid("id").primaryKey(),
        planId: uuid("plan_id")
            .notNull()
            .references(() => vantageV2Plans.id, { onDelete: "cascade" }),
        topicId: text("topic_id").notNull(),
        parentId: uuid("parent_id"),
        assigneeType: text("assignee_type").notNull(),
        assigneeId: text("assignee_id").notNull(),
        status: text("status").notNull().default("proposed"),
        version: integer("version").notNull().default(1),
        ciphertext: text("ciphertext").notNull(),
        claimToken: uuid("claim_token"),
        attemptId: uuid("attempt_id"),
        leaseUntil: timestamp("lease_until", { withTimezone: true }),
        attempt: integer("attempt").notNull().default(0),
        reason: text("reason"),
        resultCiphertext: text("result_ciphertext"),
    },
    t => ({
        queue: index("vantage_v2_task_queue").on(t.status, t.leaseUntil),
        status: check(
            "vantage_v2_task_status",
            sql`${t.status} IN ('proposed','queued','running','submitted','completed','cancelled','failed','blocked')`
        ),
        assignee: check("vantage_v2_task_assignee", sql`${t.assigneeType} IN ('owner','persona')`),
    })
);
