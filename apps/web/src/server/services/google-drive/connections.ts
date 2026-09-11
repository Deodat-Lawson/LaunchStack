/**
 * Workspace-scoped Google connections: token storage, refresh, revocation.
 *
 * The connection belongs to the company and records who granted it — users are
 * multi-workspace, every consumer of the synced files is company-owned, and
 * the reconciler runs in the worker with no session. Refresh tokens are
 * secret-box encrypted (the engine registers the key; callers must have run
 * `getEngine()` first, which every entry point here does).
 */
import { and, eq } from "drizzle-orm";

import { GoogleAuthError, refreshAccessToken } from "@launchstack/google-drive";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";

import { db } from "~/server/db";
import { connectorConnections, type ConnectorConnection } from "~/server/db/schema";
import { getEngine } from "~/server/engine";

import { GOOGLE_DRIVE_PROVIDER, getGoogleOAuthApp } from "./config";

export class GoogleNotConnectedError extends Error {
    constructor() {
        super("No active Google Drive connection for this workspace.");
        this.name = "GoogleNotConnectedError";
    }
}

export async function getActiveGoogleConnection(
    companyId: bigint
): Promise<ConnectorConnection | null> {
    const [row] = await db
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.provider, GOOGLE_DRIVE_PROVIDER),
                eq(connectorConnections.status, "active")
            )
        )
        .limit(1);
    return row ?? null;
}

export interface UpsertGoogleConnectionParams {
    companyId: bigint;
    grantedByUserId: bigint | null;
    providerAccountId: string;
    providerAccountEmail: string | null;
    refreshToken: string;
    scopes: string;
}

/**
 * Store (or re-store, after a reconnect) a connection. Reconnecting the same
 * Google account revives the existing row with the fresh refresh token rather
 * than stacking a second connection.
 */
export async function upsertGoogleConnection(
    params: UpsertGoogleConnectionParams
): Promise<ConnectorConnection> {
    getEngine();
    const { ciphertext, keyVersion } = encryptSecret(params.refreshToken);

    const [row] = await db
        .insert(connectorConnections)
        .values({
            companyId: params.companyId,
            provider: GOOGLE_DRIVE_PROVIDER,
            providerAccountId: params.providerAccountId,
            providerAccountEmail: params.providerAccountEmail,
            grantedByUserId: params.grantedByUserId,
            refreshTokenCiphertext: ciphertext,
            encryptionKeyVersion: keyVersion,
            scopes: params.scopes,
            status: "active",
            lastRefreshError: null,
        })
        .onConflictDoUpdate({
            target: [
                connectorConnections.companyId,
                connectorConnections.provider,
                connectorConnections.providerAccountId,
            ],
            set: {
                providerAccountEmail: params.providerAccountEmail,
                grantedByUserId: params.grantedByUserId,
                refreshTokenCiphertext: ciphertext,
                encryptionKeyVersion: keyVersion,
                scopes: params.scopes,
                status: "active",
                lastRefreshError: null,
                updatedAt: new Date(),
            },
        })
        .returning();

    if (!row) throw new Error("Failed to store the Google connection");
    accessTokenCache.delete(row.id);
    return row;
}

export async function markConnectionRevoked(connectionId: number, reason: string): Promise<void> {
    accessTokenCache.delete(connectionId);
    await db
        .update(connectorConnections)
        .set({ status: "revoked", lastRefreshError: reason, updatedAt: new Date() })
        .where(eq(connectorConnections.id, connectionId));
}

/** Disconnect = revoke our stored grant; Drive files stay in the account. */
export async function disconnectGoogleConnections(companyId: bigint): Promise<number> {
    const rows = await db
        .update(connectorConnections)
        .set({
            status: "revoked",
            lastRefreshError: "Disconnected from workspace settings",
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.provider, GOOGLE_DRIVE_PROVIDER),
                eq(connectorConnections.status, "active")
            )
        )
        .returning({ id: connectorConnections.id });
    for (const row of rows) accessTokenCache.delete(row.id);
    return rows.length;
}

/**
 * Access tokens live ~1h; cache per connection and refresh 5 minutes early.
 * In-process only — a stale entry costs one extra refresh, never correctness.
 */
const accessTokenCache = new Map<number, { token: string; expiresAt: number }>();
const EXPIRY_MARGIN_MS = 5 * 60_000;

export async function getAccessTokenForConnection(
    connection: ConnectorConnection
): Promise<string> {
    const cached = accessTokenCache.get(connection.id);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    getEngine();
    if (!connection.refreshTokenCiphertext) {
        // Slack/GitHub rows persist the access token instead; a Google row
        // without a refresh token is corrupt either way.
        throw new GoogleNotConnectedError();
    }
    const refreshToken = decryptSecret(connection.refreshTokenCiphertext);
    try {
        const token = await refreshAccessToken({ app: getGoogleOAuthApp(), refreshToken });
        accessTokenCache.set(connection.id, {
            token: token.access_token,
            expiresAt: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS,
        });
        return token.access_token;
    } catch (err) {
        // invalid_grant means the user revoked us at Google — flip the
        // connection so the UI shows "reconnect" instead of retrying forever.
        if (err instanceof GoogleAuthError && err.invalidGrant) {
            await markConnectionRevoked(connection.id, err.detail);
        }
        throw err;
    }
}

/** Test seam. */
export function clearAccessTokenCache(): void {
    accessTokenCache.clear();
}
