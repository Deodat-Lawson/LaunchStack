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

import { company } from "./base";
import { pgTable } from "./helpers";

export const founderWeeklyReviewRunStatusEnum = [
    "queued",
    "generating",
    "draft",
    "published",
    "failed",
] as const;

export const founderWeeklyReviewOperationTypeEnum = ["retry"] as const;
export const founderWeeklyReviewDispatchOperationTypeEnum = ["create", "retry"] as const;
export const founderWeeklyReviewDispatchStatusEnum = [
    "pending", "dispatching", "dispatched", "failed",
] as const;

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

/** Durable handoff from LAU-5 lifecycle writes to the Inngest event bus. */
export const founderWeeklyReviewDispatches = pgTable(
    "founder_weekly_review_dispatches",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        runId: varchar("run_id", { length: 64 }).notNull()
            .references(() => founderWeeklyReviewRuns.id, { onDelete: "cascade" }),
        operationType: varchar("operation_type", {
            length: 16,
            enum: founderWeeklyReviewDispatchOperationTypeEnum,
        }).notNull(),
        operationKey: varchar("operation_key", { length: 128 }).notNull(),
        eventId: varchar("event_id", { length: 128 }).notNull(),
        generationJobId: varchar("generation_job_id", { length: 128 }).notNull(),
        generationClaimId: varchar("generation_claim_id", { length: 128 }).notNull(),
        status: varchar("status", { length: 16, enum: founderWeeklyReviewDispatchStatusEnum })
            .notNull().default("pending"),
        attemptCount: integer("attempt_count").notNull().default(0),
        availableAt: timestamp("available_at", { withTimezone: true }).notNull()
            .default(sql`CURRENT_TIMESTAMP`),
        dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
        lastErrorCode: varchar("last_error_code", { length: 128 }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull()
            .default(sql`CURRENT_TIMESTAMP`),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    (table) => ({
        operationUnique: uniqueIndex("founder_weekly_review_dispatches_run_operation_key_unique")
            .on(table.runId, table.operationType, table.operationKey),
        eventUnique: uniqueIndex("founder_weekly_review_dispatches_event_id_unique").on(table.eventId),
        pendingIdx: index("founder_weekly_review_dispatches_pending_idx")
            .on(table.status, table.availableAt, table.createdAt),
        companyRunIdx: index("founder_weekly_review_dispatches_company_run_idx")
            .on(table.companyId, table.runId),
    })
);

export type FounderWeeklyReviewRunRow = InferSelectModel<typeof founderWeeklyReviewRuns>;
export type FounderWeeklyReviewOperationRow = InferSelectModel<
    typeof founderWeeklyReviewOperations
>;
export type FounderWeeklyReviewDispatchRow = InferSelectModel<typeof founderWeeklyReviewDispatches>;
