import { sql, type InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    check,
    index,
    integer,
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

export const storageDeletionRequests = pgTable(
    "storage_deletion_requests",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        // Audit records survive both document and tenant deletion.
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        scope: varchar("scope", { length: 16, enum: ["document", "version", "object"] }).notNull(),
        documentId: bigint("document_id", { mode: "number" }),
        documentVersionId: bigint("document_version_id", { mode: "number" }),
        requestedBy: varchar("requested_by", { length: 256 }).notNull(),
        reason: varchar("reason", { length: 64 }).notNull(),
        status: varchar("status", { length: 16, enum: ["pending", "completed", "blocked"] })
            .notNull()
            .default("pending"),
        traceId: varchar("trace_id", { length: 128 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
        completedAt: timestamp("completed_at", { withTimezone: true }),
    },
    table => [
        index("storage_deletion_requests_status_created_idx").on(table.status, table.createdAt),
        index("storage_deletion_requests_company_created_idx").on(table.companyId, table.createdAt),
        index("storage_deletion_requests_document_idx").on(table.documentId),
        check(
            "storage_deletion_requests_scope_check",
            sql`${table.scope} IN ('document', 'version', 'object')`
        ),
        check(
            "storage_deletion_requests_status_check",
            sql`${table.status} IN ('pending', 'completed', 'blocked')`
        ),
    ]
);

export const storageDeletionItems = pgTable(
    "storage_deletion_items",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        requestId: bigint("request_id", { mode: "number" })
            .notNull()
            .references(() => storageDeletionRequests.id, { onDelete: "cascade" }),
        storedObjectId: bigint("stored_object_id", { mode: "bigint" }).references(
            () => storageObjects.id,
            { onDelete: "set null" }
        ),
        adapter: varchar("adapter", { length: 32, enum: STORAGE_ADAPTERS }),
        storageLocationId: varchar("storage_location_id", { length: 256 }),
        objectKey: text("object_key"),
        sourceUrl: text("source_url").notNull(),
        state: varchar("state", {
            length: 16,
            enum: [
                "pending",
                "deleted",
                "not_found",
                "retained",
                "blocked",
                "quarantined",
                "skipped",
                "waived",
            ],
        })
            .notNull()
            .default("pending"),
        attempts: integer("attempts").notNull().default(0),
        errorCode: varchar("error_code", { length: 64 }),
        lastError: text("last_error"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
        // Added by a later migration; declared after the timestamps so a schema
        // built from TypeScript has the same column order as the migrations.
        resolvedBy: varchar("resolved_by", { length: 256 }),
        resolutionNote: text("resolution_note"),
        resolvedAt: timestamp("resolved_at", { withTimezone: true }),
        requeuedBy: varchar("requeued_by", { length: 256 }),
        requeueNote: text("requeue_note"),
        requeuedAt: timestamp("requeued_at", { withTimezone: true }),
    },
    table => [
        uniqueIndex("storage_deletion_items_request_url_unique").on(
            table.requestId,
            table.sourceUrl
        ),
        index("storage_deletion_items_state_idx").on(table.state),
        index("storage_deletion_items_stored_object_idx").on(table.storedObjectId),
        index("storage_deletion_items_ref_idx").on(
            table.adapter,
            table.storageLocationId,
            table.objectKey
        ),
        index("storage_deletion_items_source_url_idx").using("hash", table.sourceUrl),
        check(
            "storage_deletion_items_ref_check",
            sql`(${table.adapter} IS NOT NULL AND ${table.storageLocationId} IS NOT NULL AND ${table.objectKey} IS NOT NULL) OR (${table.state} IN ('quarantined', 'skipped', 'waived') AND ${table.adapter} IS NULL AND ${table.storageLocationId} IS NULL AND ${table.objectKey} IS NULL)`
        ),
        check(
            "storage_deletion_items_state_check",
            sql`${table.state} IN ('pending', 'deleted', 'not_found', 'retained', 'blocked', 'quarantined', 'skipped', 'waived')`
        ),
    ]
);

export type StorageDeletionRequest = InferSelectModel<typeof storageDeletionRequests>;
export type StorageDeletionItem = InferSelectModel<typeof storageDeletionItems>;
