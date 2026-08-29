/**
 * Product schema: workspace connections to third-party providers.
 *
 * A connection belongs to the workspace and records the member who granted
 * it — it is never keyed on the user alone. Users hold memberships in many
 * workspaces, so a user-global credential would follow them across tenants;
 * background syncs run in the worker with no session, so the credential must
 * be resolvable by companyId. Tokens are AES-256-GCM ciphertext via
 * secret-box, the same pattern as company_embedding_credentials.
 *
 * One shared table carries the OAuth grant for every provider; sync state
 * that only one provider needs (the Drive changes-feed cursor, picked items)
 * lives in per-provider satellite tables keyed on the connection.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    index,
    jsonb,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company } from "@launchstack/store/schema";

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
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** 'google-drive' | 'slack' | 'github' */
        provider: varchar("provider", { length: 32 }).notNull(),
        grantedByUserPk: bigint("granted_by_user_pk", { mode: "number" })
            .notNull()
            .references(() => users.id),
        /**
         * The provider's stable id for what was connected: Google OIDC `sub`,
         * Slack `team_id`, GitHub user id. Part of the uniqueness key so a
         * workspace can hold several accounts of one provider, while
         * re-authorizing the same account converges on its existing row.
         */
        providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
        /** Human-readable: Google email, Slack team name, GitHub login. */
        displayName: varchar("display_name", { length: 320 }),
        /** Space-delimited, exactly as granted by the provider. */
        scopes: text("scopes").notNull(),
        /**
         * For Google this is a short-lived cache refreshed on use; for Slack
         * and GitHub (non-rotating tokens) it IS the credential.
         */
        accessTokenCiphertext: text("access_token_ciphertext"),
        /** Null when the provider issues non-expiring tokens. */
        accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
        /** Null when the provider issued no refresh token. */
        refreshTokenCiphertext: text("refresh_token_ciphertext"),
        encryptionKeyVersion: smallint("encryption_key_version").notNull().default(1),
        /** active | suspended | revoked | error */
        status: varchar("status", { length: 16 }).notNull().default("active"),
        statusDetail: text("status_detail"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyProviderAccountUnique: uniqueIndex("connector_conn_company_provider_account_idx").on(
            table.companyId,
            table.provider,
            table.providerAccountId
        ),
        companyIdx: index("connector_conn_company_idx").on(table.companyId),
    })
);

/**
 * Google Drive sync bookkeeping — the changes-feed cursor and the sync lease.
 * One row per Drive connection, created with the connection.
 */
export const googleDriveSyncState = pgTable("google_drive_sync_state", {
    connectionId: bigint("connection_id", { mode: "bigint" })
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
 * these are the entire universe the app can see.
 */
export const googleDrivePickedItem = pgTable(
    "google_drive_picked_item",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        connectionId: bigint("connection_id", { mode: "bigint" })
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

export type ConnectorConnection = InferSelectModel<typeof connectorConnections>;
export type GoogleDriveSyncState = InferSelectModel<typeof googleDriveSyncState>;
export type GoogleDrivePickedItem = InferSelectModel<typeof googleDrivePickedItem>;
