import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    index,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { STORAGE_ADAPTERS } from "~/server/storage/object-ref";

export const storageObjects = pgTable(
    "storage_objects",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        adapter: varchar("adapter", { length: 32, enum: STORAGE_ADAPTERS }).notNull(),
        storageLocationId: varchar("storage_location_id", { length: 256 }).notNull(),
        objectKey: text("object_key").notNull(),
        url: text("url").notNull(),
        // Deliberately no FK: the inventory must outlive tenants and documents
        // so cleanup and audit can still locate their stored bytes.
        companyId: bigint("company_id", { mode: "bigint" }),
        contentType: varchar("content_type", { length: 256 }),
        sizeBytes: bigint("size_bytes", { mode: "number" }),
        checksum: varchar("checksum", { length: 256 }),
        source: varchar("source", { length: 64 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    table => [
        uniqueIndex("storage_objects_identity_unique").on(
            table.adapter,
            table.storageLocationId,
            table.objectKey
        ),
        // Provider URLs can exceed PostgreSQL's btree index tuple limit.
        index("storage_objects_url_idx").using("hash", table.url),
        index("storage_objects_company_created_idx").on(table.companyId, table.createdAt),
    ]
);

export type StoredObject = InferSelectModel<typeof storageObjects>;
