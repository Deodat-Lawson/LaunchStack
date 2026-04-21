import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { index, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { pgTable } from "./helpers";

export const documentNotes = pgTable(
    "document_notes",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: varchar("company_id", { length: 256 }),
        documentId: varchar("document_id", { length: 256 }),
        title: text("title"),
        content: text("content"),
        tags: text("tags").array().default([]),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        notesUserIdx: index("document_notes_user_idx").on(table.userId),
        notesDocIdx: index("document_notes_document_idx").on(table.documentId),
        notesCompanyIdx: index("document_notes_company_idx").on(table.companyId),
    })
);

export type DocumentNote = InferSelectModel<typeof documentNotes>;
