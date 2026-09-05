/**
 * Product schema: third-party connector connections, Drive-linked files, and
 * the Drive knowledge-sync satellites.
 *
 * Connections are workspace-scoped and user-attributed (the workspace owns the
 * grant; the row records who made it): users belong to multiple workspaces,
 * every consumer of the synced data is company-owned, and the reconciler and
 * sync jobs run in the worker with no user session. One table serves every
 * OAuth provider — `provider` discriminates — Google Drive, Slack, and GitHub
 * today.
 *
 * Token shape varies by provider. Google issues a refresh token and short
 * -lived access tokens (cached in-process by the Drive services); Slack bot
 * tokens and GitHub OAuth tokens are long-lived credentials with no refresh
 * token unless rotation is enabled — so `refreshTokenCiphertext` is nullable
 * and `accessTokenCiphertext` persists the credential itself (plus a rotated
 * refresh token when the provider hands one out).
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
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company, document, documentVersions } from "@launchstack/store/schema";

import { users } from "./identity";

/** Providers a workspace can connect. Route segments and DB values alike. */
export const CONNECTOR_PROVIDERS = ["google-drive", "slack", "github"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export function isConnectorProvider(value: string): value is ConnectorProvider {
    return (CONNECTOR_PROVIDERS as readonly string[]).includes(value);
}

export const connectorConnections = pgTable(
    "connector_connections",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** e.g. "google-drive"; discriminates providers within one table. */
        provider: varchar("provider", { length: 32 }).notNull(),
        /**
         * Stable account id at the provider (Google: the OpenID `sub`;
         * Slack: the team id; GitHub: the user id).
         */
        providerAccountId: varchar("provider_account_id", { length: 256 }).notNull(),
        /**
         * Display-only; the stable identity is providerAccountId. Google: the
         * account email; Slack: the team name; GitHub: the login.
         */
        providerAccountEmail: varchar("provider_account_email", { length: 256 }),
        /** Attribution, not ownership — the connection survives the user. */
        grantedByUserId: bigint("granted_by_user_id", { mode: "bigint" }).references(
            () => users.id,
            { onDelete: "set null" }
        ),
        /**
         * Secret-box output (AES-256-GCM, key-versioned envelope). Null for
         * providers that issue no refresh token (Slack/GitHub without
         * rotation) — there `accessTokenCiphertext` IS the credential.
         */
        refreshTokenCiphertext: text("refresh_token_ciphertext"),
        encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
        scopes: varchar("scopes", { length: 512 }).notNull(),
        /** 'active' | 'revoked' — revoked means reconnect is the only fix. */
        status: varchar("status", { length: 16 }).notNull().default("active"),
        lastRefreshError: text("last_refresh_error"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
        // Added after the table shipped, so declared last: ALTER TABLE ADD
        // COLUMN appends physically, and the migrations-apply job compares a
        // migrated database against a freshly-pushed one column by column.
        /**
         * For Google this stays null (access tokens are cached in-process);
         * for Slack/GitHub it persists the long-lived token.
         */
        accessTokenCiphertext: text("access_token_ciphertext"),
        /** Null when the stored access token does not expire. */
        accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
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

/**
 * Google Drive knowledge-sync bookkeeping — the changes-feed cursor and the
 * sync lease for picked-item ingestion. One row per Drive connection, created
 * on connect; distinct from documentDriveLinks, which tracks per-document
 * editing links.
 */
export const googleDriveSyncState = pgTable("google_drive_sync_state", {
    connectionId: bigint("connection_id", { mode: "number" })
        .primaryKey()
        .references(() => connectorConnections.id, { onDelete: "cascade" }),
    /** Drive changes-feed cursor; advances only inside the sync lease. */
    startPageToken: varchar("start_page_token", { length: 64 }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    /** ok | error | running */
    lastSyncStatus: varchar("last_sync_status", { length: 16 }),
    lastSyncError: text("last_sync_error"),
    /** Counts from the last run ({discovered, stored, skipped, failed, …}). */
    lastSyncReport: jsonb("last_sync_report").$type<Record<string, unknown>>(),
    /** Sync lease; stale after 10 minutes, claimed via conditional update. */
    syncLockedAt: timestamp("sync_locked_at", { withTimezone: true }),
});

/**
 * What the admin selected in the Google Picker; under the drive.file scope
 * these are the entire universe the knowledge sync can see.
 */
export const googleDrivePickedItem = pgTable(
    "google_drive_picked_item",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        connectionId: bigint("connection_id", { mode: "number" })
            .notNull()
            .references(() => connectorConnections.id, { onDelete: "cascade" }),
        fileId: varchar("file_id", { length: 128 }).notNull(),
        /** file | folder */
        kind: varchar("kind", { length: 8 }).notNull(),
        name: text("name").notNull(),
        mimeType: varchar("mime_type", { length: 255 }),
        addedByUserPk: bigint("added_by_user_pk", { mode: "number" }).references(() => users.id),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        connectionFileUnique: uniqueIndex("gdrive_picked_conn_file_idx").on(
            table.connectionId,
            table.fileId
        ),
        connectionIdx: index("gdrive_picked_connection_idx").on(table.connectionId),
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
export type GoogleDriveSyncState = InferSelectModel<typeof googleDriveSyncState>;
export type GoogleDrivePickedItem = InferSelectModel<typeof googleDrivePickedItem>;
