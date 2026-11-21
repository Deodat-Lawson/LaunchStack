import { bigint, bigserial, jsonb, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { pgTable } from "./helpers";
import { company, document, documentVersions } from "./base";
import type { DigestItem } from "../../document-digests";

export const documentVersionDigests = pgTable("document_version_digests", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: bigint("company_id", { mode: "number" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    documentId: bigint("document_id", { mode: "number" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    versionId: bigint("version_id", { mode: "number" }).notNull().references(() => documentVersions.id, { onDelete: "cascade" }),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    formatVersion: varchar("format_version", { length: 32 }).notNull(),
    headline: text("headline").notNull(),
    items: jsonb("items").$type<DigestItem[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ key: uniqueIndex("document_version_digests_key").on(table.versionId, table.contentHash, table.formatVersion) }));
