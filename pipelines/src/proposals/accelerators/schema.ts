import { sql } from "drizzle-orm";
import { bigint, jsonb, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

import type { CatalogueProgram, FitAssessment } from "./types";

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
        assessment: jsonb("assessment").$type<FitAssessment>().notNull(),
        profileHash: text("profile_hash").notNull(),
        programHash: varchar("program_hash", { length: 64 }).notNull(),
        checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    },
    table => [
        uniqueIndex("accelerator_matches_company_program_unique").on(
            table.companyId,
            table.programId
        ),
    ]
);
