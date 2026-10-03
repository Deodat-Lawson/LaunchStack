/**
 * Drizzle schema for the grants vertical.
 *
 * Six product tables, all company-scoped with cascade delete, prefixed
 * `pdr_ai_v2_` by the shared helper. Columns added by later migrations must
 * be declared LAST (the pg_dump parity gate compares column order).
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    boolean,
    date,
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

import type {
    DraftMeta,
    Evidence,
    ExtractedRequest,
    Fit,
    Requirement,
    Review,
    RunInput,
    RunStep,
    RunSummary,
} from "./types";
import {
    APPLICATION_STATUSES,
    OPPORTUNITY_STATUSES,
    RUN_KINDS,
    RUN_STATUSES,
    SECTION_STATUSES,
} from "./types";

// ─── Opportunities ───────────────────────────────────────────────────────────

export const proposalOpportunities = pgTable(
    "proposal_opportunities",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        source: varchar("source", { length: 16, enum: ["grants_gov", "web", "manual"] }).notNull(),
        externalId: varchar("external_id", { length: 1024 }).notNull(),
        title: varchar("title", { length: 512 }).notNull(),
        funder: varchar("funder", { length: 256 }).notNull(),
        url: text("url"),
        summary: text("summary"),
        opensOn: date("opens_on", { mode: "string" }),
        closesOn: date("closes_on", { mode: "string" }),
        status: varchar("status", { length: 16, enum: OPPORTUNITY_STATUSES })
            .notNull()
            .default("candidate"),
        amountMin: bigint("amount_min", { mode: "number" }),
        amountMax: bigint("amount_max", { mode: "number" }),
        eligibility: text("eligibility"),
        categories: jsonb("categories").$type<string[]>().notNull().default([]),
        fit: jsonb("fit").$type<Fit>(),
        runId: varchar("run_id", { length: 64 }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        uniqueIndex("proposal_opportunities_company_source_external_unique").on(
            table.companyId,
            table.source,
            table.externalId
        ),
        index("proposal_opportunities_company_status_idx").on(table.companyId, table.status),
        index("proposal_opportunities_company_closes_idx").on(table.companyId, table.closesOn),
    ]
);
export type ProposalOpportunityRow = InferSelectModel<typeof proposalOpportunities>;

// ─── Applications ────────────────────────────────────────────────────────────

export const proposalApplications = pgTable(
    "proposal_applications",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        opportunityId: varchar("opportunity_id", { length: 64 }).references(
            () => proposalOpportunities.id,
            { onDelete: "set null" }
        ),
        title: varchar("title", { length: 512 }).notNull(),
        funder: varchar("funder", { length: 256 }),
        status: varchar("status", { length: 20, enum: APPLICATION_STATUSES })
            .notNull()
            .default("draft"),
        deadline: date("deadline", { mode: "string" }),
        ownerUserId: varchar("owner_user_id", { length: 256 }),
        /** The funder's request as given: pasted, fetched from a URL, or read from a Source. */
        requestText: text("request_text"),
        requestUrl: text("request_url"),
        requestDocumentId: bigint("request_document_id", { mode: "number" }),
        extracted: jsonb("extracted").$type<ExtractedRequest>(),
        requirements: jsonb("requirements").$type<Requirement[]>().notNull().default([]),
        review: jsonb("review").$type<Review>(),
        readiness: integer("readiness").notNull().default(0),
        notes: text("notes"),
        /** The Source the finished application was exported to, when it was. */
        exportedDocumentId: bigint("exported_document_id", { mode: "number" }),
        submittedAt: timestamp("submitted_at", { withTimezone: true }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("proposal_applications_company_status_idx").on(table.companyId, table.status),
        index("proposal_applications_company_deadline_idx").on(table.companyId, table.deadline),
    ]
);
export type ProposalApplicationRow = InferSelectModel<typeof proposalApplications>;

// ─── Sections ────────────────────────────────────────────────────────────────

export const proposalSections = pgTable(
    "proposal_sections",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        applicationId: varchar("application_id", { length: 64 })
            .notNull()
            .references(() => proposalApplications.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
        key: varchar("key", { length: 64 }).notNull(),
        question: text("question").notNull(),
        guidance: text("guidance"),
        wordLimit: integer("word_limit"),
        required: boolean("required").notNull().default(true),
        status: varchar("status", { length: 16, enum: SECTION_STATUSES })
            .notNull()
            .default("empty"),
        draft: text("draft"),
        draftMeta: jsonb("draft_meta").$type<DraftMeta>(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("proposal_sections_application_position_idx").on(table.applicationId, table.position),
        index("proposal_sections_company_idx").on(table.companyId),
    ]
);
export type ProposalSectionRow = InferSelectModel<typeof proposalSections>;

// ─── Library ─────────────────────────────────────────────────────────────────

export const proposalLibraryItems = pgTable(
    "proposal_library_items",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        question: text("question").notNull(),
        answer: text("answer").notNull(),
        tags: jsonb("tags").$type<string[]>().notNull().default([]),
        evidence: jsonb("evidence").$type<Evidence[]>().notNull().default([]),
        sourceApplicationId: varchar("source_application_id", { length: 64 }).references(
            () => proposalApplications.id,
            { onDelete: "set null" }
        ),
        sourceSectionKey: varchar("source_section_key", { length: 64 }),
        uses: integer("uses").notNull().default(0),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [index("proposal_library_items_company_idx").on(table.companyId)]
);
export type ProposalLibraryItemRow = InferSelectModel<typeof proposalLibraryItems>;

// ─── Runs ────────────────────────────────────────────────────────────────────

export const proposalRuns = pgTable(
    "proposal_runs",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        kind: varchar("kind", { length: 16, enum: RUN_KINDS }).notNull(),
        status: varchar("status", { length: 16, enum: RUN_STATUSES }).notNull().default("queued"),
        applicationId: varchar("application_id", { length: 64 }).references(
            () => proposalApplications.id,
            { onDelete: "cascade" }
        ),
        userId: varchar("user_id", { length: 256 }).notNull(),
        input: jsonb("input").$type<RunInput>().notNull().default({}),
        steps: jsonb("steps").$type<RunStep[]>().notNull().default([]),
        summary: jsonb("summary").$type<RunSummary>(),
        error: text("error"),
        creditsUsed: integer("credits_used").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("proposal_runs_company_created_idx").on(table.companyId, table.createdAt),
        index("proposal_runs_company_status_idx").on(table.companyId, table.status),
        index("proposal_runs_application_idx").on(table.applicationId),
    ]
);
export type ProposalRunRow = InferSelectModel<typeof proposalRuns>;
