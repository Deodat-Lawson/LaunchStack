import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    foreignKey,
    date,
    index,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
    uuid,
    vector,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

import type { ProgramIntelligence } from "./intelligence";
import type { ApplicationResponse, PastCompany } from "./similar-companies";
import type { TrackerPriority, TrackerStatus } from "./tracker";
import type { CatalogueProgram } from "./types";

/** Installation-wide public catalogue; it must never contain company answers or credentials. */
export const acceleratorPrograms = pgTable("accelerator_programs", {
    id: varchar("id", { length: 64 }).primaryKey(),
    program: jsonb("program").$type<CatalogueProgram>().notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
});

/** Only company-scoped assessments live here; answers remain in proposal_sections.draft. */
export const acceleratorCompanyMatches = pgTable(
    "accelerator_company_matches",
    {
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        programId: varchar("program_id", { length: 64 })
            .notNull()
            .references(() => acceleratorPrograms.id, { onDelete: "cascade" }),
        /** fit-v1 assessment; rows saved before fit-v1 hold an older shape, so readers must parse. */
        assessment: jsonb("assessment").$type<unknown>().notNull(),
        profileHash: text("profile_hash").notNull(),
        programHash: varchar("program_hash", { length: 64 }).notNull(),
        /** Rubric the assessment was scored under; null for rows saved before fit-v1. */
        rubricVersion: varchar("rubric_version", { length: 32 }),
        checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    },
    table => [
        uniqueIndex("accelerator_matches_company_program_unique").on(
            table.companyId,
            table.programId
        ),
    ]
);

/**
 * Past accepted companies of a Supported accelerator, collected by an operator
 * into this installation only. Public data about other startups; never company answers.
 */
export const acceleratorPortfolioCompanies = pgTable(
    "accelerator_portfolio_companies",
    {
        id: varchar("id", { length: 160 }).primaryKey(),
        programId: varchar("program_id", { length: 64 })
            .notNull()
            .references(() => acceleratorPrograms.id, { onDelete: "cascade" }),
        company: jsonb("company").$type<PastCompany>().notNull(),
        batchStartsOn: date("batch_starts_on").notNull(),
        contentHash: varchar("content_hash", { length: 64 }).notNull(),
        /** Embedding of `companyEmbeddingText`; null until the collector embeds it. */
        embedding: vector("embedding", { dimensions: 1536 }),
        /** Hash of the embedded text and model, so a changed record is re-embedded. */
        embeddingHash: varchar("embedding_hash", { length: 64 }),
        collectedAt: timestamp("collected_at", { withTimezone: true })
            .notNull()
            .default(sql`CURRENT_TIMESTAMP`),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [index("accelerator_portfolio_program_idx").on(table.programId, table.batchStartsOn)]
);

/** Published applications of past accepted companies; local installation data only. */
export const acceleratorApplicationResponses = pgTable(
    "accelerator_application_responses",
    {
        id: varchar("id", { length: 160 }).primaryKey(),
        programId: varchar("program_id", { length: 64 })
            .notNull()
            .references(() => acceleratorPrograms.id, { onDelete: "cascade" }),
        companyId: varchar("company_id", { length: 160 }).references(
            () => acceleratorPortfolioCompanies.id,
            { onDelete: "set null" }
        ),
        response: jsonb("response").$type<ApplicationResponse>().notNull(),
        contentHash: varchar("content_hash", { length: 64 }).notNull(),
        collectedAt: timestamp("collected_at", { withTimezone: true })
            .notNull()
            .default(sql`CURRENT_TIMESTAMP`),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [index("accelerator_applications_company_idx").on(table.companyId)]
);

/** Private, manually maintained opportunities; never application answers or paid runs. */
export const acceleratorTrackerOpportunities = pgTable(
    "accelerator_tracker_opportunities",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        programId: varchar("program_id", { length: 64 })
            .notNull()
            .references(() => acceleratorPrograms.id, { onDelete: "restrict" }),
        cycleId: varchar("cycle_id", { length: 64 }),
        priority: text("priority").$type<TrackerPriority>().notNull().default("medium"),
        status: text("status").$type<TrackerStatus>().notNull().default("shortlisted"),
        notes: text("notes").notNull().default(""),
        submittedOn: date("submitted_on"),
        nextAction: text("next_action"),
        plannedDeadline: timestamp("planned_deadline", { withTimezone: true }),
        /** Set instead of plannedDeadline when the Program gave a date without a time. */
        plannedDeadlineOn: date("planned_deadline_on"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        uniqueIndex("accelerator_tracker_company_program_cycle_unique")
            .on(table.companyId, table.programId, table.cycleId)
            .where(sql`${table.cycleId} IS NOT NULL`),
        uniqueIndex("accelerator_tracker_company_program_only_unique")
            .on(table.companyId, table.programId)
            .where(sql`${table.cycleId} IS NULL`),
        uniqueIndex("accelerator_tracker_id_company_unique").on(table.id, table.companyId),
    ]
);

export const acceleratorTrackerTasks = pgTable(
    "accelerator_tracker_tasks",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        opportunityId: uuid("opportunity_id").notNull(),
        title: text("title").notNull(),
        dueOn: date("due_on"),
        priority: text("priority").$type<TrackerPriority>().notNull().default("medium"),
        done: boolean("done").notNull().default(false),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        foreignKey({
            columns: [table.opportunityId, table.companyId],
            foreignColumns: [
                acceleratorTrackerOpportunities.id,
                acceleratorTrackerOpportunities.companyId,
            ],
            name: "accelerator_tracker_tasks_opportunity_company_fk",
        }).onDelete("cascade"),
        index("accelerator_tracker_tasks_company_opportunity_idx").on(
            table.companyId,
            table.opportunityId
        ),
    ]
);

/**
 * Public program-intelligence dossier. Company fit and tracker rows do not live here.
 * The program id is the stable identity shared with Cycles, evidence, and tags.
 */
export const acceleratorProgramIntelligence = pgTable("accelerator_program_intelligence", {
    programId: varchar("program_id", { length: 64 })
        .primaryKey()
        .references(() => acceleratorPrograms.id, { onDelete: "cascade" }),
    dossier: jsonb("dossier").$type<ProgramIntelligence>().notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
});
