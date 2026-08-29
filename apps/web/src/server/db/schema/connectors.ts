/**
 * Product schema: third-party connector connections and Drive-linked files.
 *
 * Connections are workspace-scoped and user-attributed (the workspace owns the
 * grant; the row records who made it): users belong to multiple workspaces,
 * every consumer of the synced data is company-owned, and the reconciler runs
 * in the worker with no user session. One table serves every OAuth provider —
 * `provider` discriminates — so Slack/GitHub connections later reuse it
 * unchanged.
 *
 * A document has at most one Drive link, ever: re-linking after an unlink
 * updates the same row (new driveFileId), so `document_id` is simply unique.
 */
import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    index,
    integer,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company, document, documentVersions } from "@launchstack/store/schema";

import { users } from "./identity";

export const connectorConnections = pgTable(
    "connector_connections",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** e.g. "google-drive"; discriminates providers within one table. */
        provider: varchar("provider", { length: 32 }).notNull(),
        /** Stable account id at the provider (Google: the OpenID `sub`). */
        providerAccountId: varchar("provider_account_id", { length: 256 }).notNull(),
        /** Display-only; the stable identity is providerAccountId. */
        providerAccountEmail: varchar("provider_account_email", { length: 256 }),
        /** Attribution, not ownership — the connection survives the user. */
        grantedByUserId: bigint("granted_by_user_id", { mode: "bigint" }).references(
            () => users.id,
            { onDelete: "set null" }
        ),
        /** Secret-box output (AES-256-GCM, key-versioned envelope). */
        refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
        encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
        scopes: varchar("scopes", { length: 512 }).notNull(),
        /** 'active' | 'revoked' — revoked means reconnect is the only fix. */
        status: varchar("status", { length: 16 }).notNull().default("active"),
        lastRefreshError: text("last_refresh_error"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyProviderAccountUnique: uniqueIndex(
            "connector_connections_company_provider_account_unique"
        ).on(table.companyId, table.provider, table.providerAccountId),
        companyProviderIdx: index("connector_connections_company_provider_idx").on(
            table.companyId,
            table.provider
        ),
    })
);

export const documentDriveLinks = pgTable(
    "document_drive_links",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        connectionId: bigint("connection_id", { mode: "bigint" })
            .notNull()
            .references(() => connectorConnections.id, { onDelete: "cascade" }),
        linkedByUserId: bigint("linked_by_user_id", { mode: "bigint" }).references(() => users.id, {
            onDelete: "set null",
        }),
        driveFileId: varchar("drive_file_id", { length: 128 }).notNull(),
        driveWebViewLink: varchar("drive_web_view_link", { length: 1024 }),
        /** The document version the Drive file was created from. */
        baseVersionId: bigint("base_version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "set null" }
        ),
        /** The last version a pull created (or the push that produced it). */
        lastSyncedVersionId: bigint("last_synced_version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "set null" }
        ),
        /**
         * Drive change markers as of the last sync. Revision id is the primary
         * gate; md5 absorbs revision churn with identical bytes without a
         * download (absent once a file is converted to a native Google Doc).
         */
        lastSyncedRevisionId: varchar("last_synced_revision_id", { length: 128 }),
        lastSyncedMd5: varchar("last_synced_md5", { length: 64 }),
        /** 'linked' | 'orphaned' | 'unlinked' */
        status: varchar("status", { length: 16 }).notNull().default("linked"),
        /** Set when the user converted the Drive copy to a native Google Doc. */
        fidelityWarning: boolean("fidelity_warning").notNull().default(false),
        lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
        lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
        lastError: text("last_error"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        documentUnique: uniqueIndex("document_drive_links_document_unique").on(table.documentId),
        connectionIdx: index("document_drive_links_connection_idx").on(table.connectionId),
        /** The reconciler sweeps linked rows oldest-checked first. */
        statusCheckedIdx: index("document_drive_links_status_checked_idx").on(
            table.status,
            table.lastCheckedAt
        ),
    })
);

export const connectorConnectionsRelations = relations(connectorConnections, ({ one, many }) => ({
    company: one(company, {
        fields: [connectorConnections.companyId],
        references: [company.id],
    }),
    grantedBy: one(users, {
        fields: [connectorConnections.grantedByUserId],
        references: [users.id],
    }),
    driveLinks: many(documentDriveLinks),
}));

export const documentDriveLinksRelations = relations(documentDriveLinks, ({ one }) => ({
    document: one(document, {
        fields: [documentDriveLinks.documentId],
        references: [document.id],
    }),
    connection: one(connectorConnections, {
        fields: [documentDriveLinks.connectionId],
        references: [connectorConnections.id],
    }),
    linkedBy: one(users, {
        fields: [documentDriveLinks.linkedByUserId],
        references: [users.id],
    }),
}));

export type ConnectorConnection = InferSelectModel<typeof connectorConnections>;
export type DocumentDriveLink = InferSelectModel<typeof documentDriveLinks>;
