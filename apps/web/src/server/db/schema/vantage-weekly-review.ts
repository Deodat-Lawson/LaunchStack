import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    check,
    date,
    foreignKey,
    index,
    integer,
    jsonb,
    primaryKey,
    text,
    timestamp,
    unique,
    uuid,
} from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";

export const vantageWeeklyReviewRuns = pgTable(
    "vantage_weekly_review_runs",
    {
        id: uuid("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        ownerId: text("owner_id").notNull(),
        weekStart: date("week_start").notNull(),
        idempotencyKey: text("idempotency_key").notNull(),
        inputHash: text("input_hash").notNull(),
        status: text("status").notNull(),
        schemaVersion: text("schema_version").notNull().default("vantage-weekly-review/v2.1"),
        dependencies: jsonb("dependencies").notNull(),
        ciphertext: text("ciphertext"),
        keyVersion: integer("key_version"),
        generationDispatched: boolean("generation_dispatched").notNull().default(false),
        judgeDispatched: boolean("judge_dispatched").notNull().default(false),
        failureCode: text("failure_code"),
        reviewVersion: integer("review_version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    },
    t => ({
        operation: unique("pdr_ai_v2_vantage_weekly_revi_company_id_owner_id_idempoten_key").on(
            t.companyId,
            t.ownerId,
            t.idempotencyKey
        ),
        statusValid: check(
            "pdr_ai_v2_vantage_weekly_review_runs_status_check",
            sql`${t.status} IN ('reserved','accepted','failed')`
        ),
        ciphertextValid: check(
            "pdr_ai_v2_vantage_weekly_review_runs_check",
            sql`(${t.status}='accepted') = (${t.ciphertext} IS NOT NULL)`
        ),
        history: index("vantage_weekly_review_owner_history").on(
            t.companyId,
            t.ownerId,
            t.weekStart
        ),
    })
);
export const vantageWeeklyReviewActive = pgTable(
    "vantage_weekly_review_active",
    {
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        ownerId: text("owner_id").notNull(),
        weekStart: date("week_start").notNull(),
        runId: uuid("run_id").notNull(),
    },
    t => ({
        pk: primaryKey({
            name: "pdr_ai_v2_vantage_weekly_review_active_pkey",
            columns: [t.companyId, t.ownerId, t.weekStart],
        }),
        run: foreignKey({
            name: "pdr_ai_v2_vantage_weekly_review_active_run_id_fkey",
            columns: [t.runId],
            foreignColumns: [vantageWeeklyReviewRuns.id],
        }),
    })
);
export const vantageWeeklyReviewDecisions = pgTable(
    "vantage_weekly_review_decisions",
    {
        id: uuid("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        runId: uuid("run_id").notNull(),
        actorId: text("actor_id").notNull(),
        idempotencyKey: text("idempotency_key").notNull(),
        payloadHash: text("payload_hash").notNull(),
        ciphertext: text("ciphertext").notNull(),
        version: integer("version").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    t => ({
        operation: unique("pdr_ai_v2_vantage_weekly_revi_company_id_run_id_actor_id_id_key").on(
            t.companyId,
            t.runId,
            t.actorId,
            t.idempotencyKey
        ),
        revision: unique("pdr_ai_v2_vantage_weekly_review_decisions_run_id_version_key").on(
            t.runId,
            t.version
        ),
        run: foreignKey({
            name: "pdr_ai_v2_vantage_weekly_review_decisions_run_id_fkey",
            columns: [t.runId],
            foreignColumns: [vantageWeeklyReviewRuns.id],
        }),
    })
);
export const vantageWeeklyReviewEpochs = pgTable("vantage_weekly_review_epochs", {
    companyId: bigint("company_id", { mode: "bigint" }).primaryKey(),
    version: bigint("version", { mode: "bigint" })
        .notNull()
        .default(sql`1`),
});
export const vantageWeeklyReviewPolicy = pgTable("vantage_weekly_review_policy", {
    companyId: bigint("company_id", { mode: "bigint" }).primaryKey(),
    architectureDocumentId: bigint("architecture_document_id", { mode: "bigint" }).notNull(),
    requiredDocumentIds: jsonb("required_document_ids")
        .notNull()
        .default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(1),
});
export const vantageWeeklyReviewPreferences = pgTable(
    "vantage_weekly_review_preferences",
    {
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        actorId: text("actor_id").notNull(),
        starDocumentIds: jsonb("star_document_ids")
            .notNull()
            .default(sql`'[]'::jsonb`),
        version: integer("version").notNull().default(1),
    },
    t => ({
        pk: primaryKey({
            name: "pdr_ai_v2_vantage_weekly_review_preferences_pkey",
            columns: [t.companyId, t.actorId],
        }),
    })
);

export const vantageWeeklyReviewActivationEvents = pgTable(
    "vantage_weekly_review_activation_events",
    {
        id: uuid("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        ownerId: text("owner_id").notNull(),
        weekStart: date("week_start").notNull(),
        actorId: text("actor_id").notNull(),
        idempotencyKey: text("idempotency_key").notNull(),
        payloadHash: text("payload_hash").notNull(),
        kind: text("kind").notNull(),
        previousRunId: uuid("previous_run_id"),
        runId: uuid("run_id").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    t => ({
        operation: unique("pdr_ai_v2_vantage_weekly_revi_company_id_owner_id_idempote_key1").on(
            t.companyId,
            t.ownerId,
            t.idempotencyKey
        ),
        run: foreignKey({
            name: "pdr_ai_v2_vantage_weekly_review_activation_events_run_id_fkey",
            columns: [t.runId],
            foreignColumns: [vantageWeeklyReviewRuns.id],
        }),
        previous: foreignKey({
            name: "pdr_ai_v2_vantage_weekly_review_activation_previous_run_id_fkey",
            columns: [t.previousRunId],
            foreignColumns: [vantageWeeklyReviewRuns.id],
        }),
        kindValid: check(
            "pdr_ai_v2_vantage_weekly_review_activation_events_kind_check",
            sql`${t.kind} IN ('accepted','restored')`
        ),
    })
);
