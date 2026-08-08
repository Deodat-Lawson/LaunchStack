/**
 * Drizzle schema for the Founder Weekly Review feature.
 *
 * Product-side tables: they reference the engine `company` table, never the
 * reverse. They live here rather than in apps/web because a package cannot
 * import from an app, and the vertical that queries them owns them. Applied by
 * the product migration set (apps/web/drizzle).
 */

import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    date,
    index,
    integer,
    jsonb,
    uniqueIndex,
    varchar,
    timestamp,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/core/db/schema";
import { pgTable } from "@launchstack/core/db/schema/helpers";

export const founderWeeklyReviewRunStatusEnum = [
    "queued",
    "generating",
    "draft",
    "published",
    "failed",
] as const;

export const founderWeeklyReviewOperationTypeEnum = ["retry"] as const;

export const founderWeeklyReviewRuns = pgTable(
    "founder_weekly_review_runs",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        requestKey: varchar("request_key", { length: 128 }).notNull(),
        reportingPeriodStart: date("reporting_period_start").notNull(),
        reportingPeriodEnd: date("reporting_period_end").notNull(),
        status: varchar("status", {
            length: 32,
            enum: founderWeeklyReviewRunStatusEnum,
        })
            .notNull()
            .default("queued"),
        reviewPayload: jsonb("review_payload").$type<Record<string, unknown> | null>(),
        reviewSchemaVersion: varchar("review_schema_version", { length: 64 }).notNull(),
        evidenceSnapshot: jsonb("evidence_snapshot")
            .$type<Record<string, unknown>>()
            .notNull(),
        evidenceSchemaVersion: varchar("evidence_schema_version", { length: 64 }).notNull(),
        modelMetadata: jsonb("model_metadata").$type<Record<string, unknown> | null>(),
        createdByActorId: varchar("created_by_actor_id", { length: 256 }).notNull(),
        retryCount: integer("retry_count").notNull().default(0),
        failureSequence: integer("failure_sequence").notNull().default(0),
        generationAttempt: integer("generation_attempt").notNull().default(0),
        generationClaimId: varchar("generation_claim_id", { length: 128 }),
        generationJobId: varchar("generation_job_id", { length: 256 }),
        queuedAt: timestamp("queued_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        claimedAt: timestamp("claimed_at", { withTimezone: true }),
        generationStartedAt: timestamp("generation_started_at", { withTimezone: true }),
        generatedAt: timestamp("generated_at", { withTimezone: true }),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        errorCode: varchar("error_code", { length: 128 }),
        errorMessage: varchar("error_message", { length: 1024 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        requestKeyUnique: uniqueIndex(
            "founder_weekly_review_runs_company_request_key_unique"
        ).on(table.companyId, table.requestKey),
        companyCreatedIdx: index("founder_weekly_review_runs_company_created_at_idx").on(
            table.companyId,
            table.createdAt
        ),
        companyStatusCreatedIdx: index(
            "founder_weekly_review_runs_company_status_created_at_idx"
        ).on(table.companyId, table.status, table.createdAt),
        companyPeriodIdx: index("founder_weekly_review_runs_company_period_idx").on(
            table.companyId,
            table.reportingPeriodStart,
            table.reportingPeriodEnd
        ),
        claimIdx: index("founder_weekly_review_runs_claim_idx").on(
            table.companyId,
            table.id,
            table.status,
            table.generationClaimId
        ),
    })
);

export const founderWeeklyReviewOperations = pgTable(
    "founder_weekly_review_operations",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        runId: varchar("run_id", { length: 64 })
            .notNull()
            .references(() => founderWeeklyReviewRuns.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        operationType: varchar("operation_type", {
            length: 32,
            enum: founderWeeklyReviewOperationTypeEnum,
        }).notNull(),
        requestKey: varchar("request_key", { length: 128 }).notNull(),
        sourceFailureSequence: integer("source_failure_sequence").notNull(),
        actorId: varchar("actor_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        runOperationRequestKeyUnique: uniqueIndex(
            "founder_weekly_review_operations_run_type_request_key_unique"
        ).on(table.runId, table.operationType, table.requestKey),
        companyRunCreatedIdx: index(
            "founder_weekly_review_operations_company_run_created_at_idx"
        ).on(table.companyId, table.runId, table.createdAt),
        runTypeCreatedIdx: index("founder_weekly_review_operations_run_type_created_at_idx").on(
            table.runId,
            table.operationType,
            table.createdAt
        ),
    })
);

export type FounderWeeklyReviewRunRow = InferSelectModel<typeof founderWeeklyReviewRuns>;
export type FounderWeeklyReviewOperationRow = InferSelectModel<
    typeof founderWeeklyReviewOperations
>;
