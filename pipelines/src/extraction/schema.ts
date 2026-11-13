/**
 * Drizzle schema for the extraction vertical: a table of fields read out of
 * many documents, one row per document.
 *
 * Two tables, company-scoped with cascade delete, prefixed `pdr_ai_v2_` by
 * the shared helper. Columns added by later migrations must be declared LAST.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
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

import { company, document } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

import type { ExtractionCells, ExtractionField, ExtractionUsage } from "./types";
import { EXTRACTION_ROW_STATUSES, EXTRACTION_TABLE_STATUSES } from "./types";

export const extractionTables = pgTable(
    "extraction_tables",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        title: varchar("title", { length: 200 }).notNull(),
        fields: jsonb("fields").$type<ExtractionField[]>().notNull(),
        status: varchar("status", { length: 16, enum: EXTRACTION_TABLE_STATUSES })
            .notNull()
            .default("queued"),
        usage: jsonb("usage").$type<ExtractionUsage>().notNull(),
        error: text("error"),
        /** Set when the creator shares the table with the whole workspace. */
        sharedAt: timestamp("shared_at", { withTimezone: true }),
        cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
        /** The in-process executor's claim; a stale lease lets a poll resume the table. */
        leaseUntil: timestamp("lease_until", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
        startedAt: timestamp("started_at", { withTimezone: true }),
        finishedAt: timestamp("finished_at", { withTimezone: true }),
    },
    table => [
        index("extraction_tables_company_creator_idx").on(
            table.companyId,
            table.createdByUserId,
            table.createdAt
        ),
        index("extraction_tables_status_idx").on(table.status),
    ]
);
export type ExtractionTableRow = InferSelectModel<typeof extractionTables>;

/** One document in a table. Deleting the document removes its row. */
export const extractionRows = pgTable(
    "extraction_rows",
    {
        id: serial("id").primaryKey(),
        tableId: integer("table_id")
            .notNull()
            .references(() => extractionTables.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "number" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        documentTitle: varchar("document_title", { length: 256 }).notNull(),
        status: varchar("status", { length: 16, enum: EXTRACTION_ROW_STATUSES })
            .notNull()
            .default("pending"),
        cells: jsonb("cells").$type<ExtractionCells>().notNull(),
        error: text("error"),
        attempts: integer("attempts").notNull().default(0),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        uniqueIndex("extraction_rows_table_document_unique").on(table.tableId, table.documentId),
        index("extraction_rows_table_status_idx").on(table.tableId, table.status),
        index("extraction_rows_company_idx").on(table.companyId),
    ]
);
export type ExtractionRowRow = InferSelectModel<typeof extractionRows>;
