import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    check,
    date,
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
        operation: unique().on(t.companyId, t.ownerId, t.idempotencyKey),
        statusValid: check(
            "vantage_weekly_review_status",
            sql`${t.status} IN ('reserved','accepted','failed')`
        ),
        ciphertextValid: check(
            "vantage_weekly_review_ciphertext",
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
        runId: uuid("run_id")
            .notNull()
            .references(() => vantageWeeklyReviewRuns.id),
    },
    t => ({ pk: primaryKey({ columns: [t.companyId, t.ownerId, t.weekStart] }) })
);
export const vantageWeeklyReviewDecisions = pgTable(
    "vantage_weekly_review_decisions",
    {
        id: uuid("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        runId: uuid("run_id")
            .notNull()
            .references(() => vantageWeeklyReviewRuns.id),
        actorId: text("actor_id").notNull(),
        idempotencyKey: text("idempotency_key").notNull(),
        payloadHash: text("payload_hash").notNull(),
        ciphertext: text("ciphertext").notNull(),
        version: integer("version").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    t => ({
        operation: unique().on(t.companyId, t.runId, t.actorId, t.idempotencyKey),
        revision: unique().on(t.runId, t.version),
    })
);
export const vantageWeeklyReviewEpochs = pgTable("vantage_weekly_review_epochs", {
    companyId: bigint("company_id", { mode: "bigint" }).primaryKey(),
    version: bigint("version", { mode: "bigint" }).notNull().default(1n),
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
    t => ({ pk: primaryKey({ columns: [t.companyId, t.actorId] }) })
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
        previousRunId: uuid("previous_run_id").references(() => vantageWeeklyReviewRuns.id),
        runId: uuid("run_id")
            .notNull()
            .references(() => vantageWeeklyReviewRuns.id),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    t => ({
        operation: unique().on(t.companyId, t.ownerId, t.idempotencyKey),
        kindValid: check(
            "vantage_review_activation_kind",
            sql`${t.kind} IN ('accepted','restored')`
        ),
    })
);
