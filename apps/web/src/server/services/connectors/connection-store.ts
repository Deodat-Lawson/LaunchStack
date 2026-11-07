/**
 * The connection row: encrypted token lifecycle for the generic providers
 * (Slack, GitHub, LinkedIn, Notion). Tokens are AES-256-GCM ciphertext via secret-box; the
 * plaintext never leaves this module except as a live access token. Google
 * rows live in the same table but their token lifecycle belongs to
 * `~/server/services/google-drive/connections` — this module delegates to it
 * so consumers get one `getCompanyAccessToken` across providers.
 *
 * Refresh needs no lock: Slack/GitHub tokens only rotate when the provider's
 * rotation mode is enabled, and there a lost race surfaces as a reconnect —
 * acceptable until a deployment actually enables rotation.
 */

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";

import { db } from "~/server/db";
import {
    connectorConnections,
    isPerUserProvider,
    type ConnectorConnection,
    type ConnectorProvider,
} from "~/server/db/schema/connectors";
import { getEngine } from "~/server/engine";
import type { Executor } from "~/server/workspace/db-types";
import { getConnectorConfig, isOAuthProvider, PROVIDER_MODULES } from "./config";
import { ConnectorGrantRevokedError, type ProviderGrant } from "./providers/types";

/** Refresh when the stored access token is within this window of expiry. */
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

export async function listConnectionsForCompany(
    companyId: bigint,
    provider?: ConnectorProvider
): Promise<ConnectorConnection[]> {
    return db
        .select()
        .from(connectorConnections)
        .where(
            provider
                ? and(
                      eq(connectorConnections.companyId, companyId),
                      eq(connectorConnections.provider, provider)
                  )
                : eq(connectorConnections.companyId, companyId)
        )
        .orderBy(asc(connectorConnections.createdAt));
}

/** One member's connections to a per-user provider (Notion), oldest first. */
export async function listConnectionsForOwner(
    companyId: bigint,
    provider: ConnectorProvider,
    ownerUserId: bigint
): Promise<ConnectorConnection[]> {
    return db
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.provider, provider),
                eq(connectorConnections.ownerUserId, ownerUserId)
            )
        )
        .orderBy(asc(connectorConnections.createdAt));
}

/** The workspace's oldest active connection for a provider, or null. */
export async function getActiveConnection(
    companyId: bigint,
    provider: ConnectorProvider
): Promise<ConnectorConnection | null> {
    const rows = await listConnectionsForCompany(companyId, provider);
    return rows.find(row => row.status === "active") ?? null;
}

/** Every active connection of one provider, across all companies (cron fan-out). */
export async function listActiveConnectionsForProvider(
    provider: ConnectorProvider
): Promise<ConnectorConnection[]> {
    return db
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.provider, provider),
                eq(connectorConnections.status, "active")
            )
        );
}

export async function getConnectionById(id: number): Promise<ConnectorConnection | null> {
    const [row] = await db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.id, id))
        .limit(1);
    return row ?? null;
}

export interface UpsertConnectionParams {
    readonly companyId: bigint;
    readonly provider: ConnectorProvider;
    readonly grantedByUserId: bigint | null;
    /**
     * The member a per-user connection (Notion) belongs to; null for a
     * workspace connection. Required exactly when the provider is per-user.
     */
    readonly ownerUserId?: bigint | null;
    readonly grant: ProviderGrant;
}

/** Another member of this workspace already connected that provider account. */
export class ConnectorAccountClaimedError extends Error {
    constructor(readonly provider: ConnectorProvider) {
        super(`That ${provider} account is already connected by another member of this workspace.`);
        this.name = "ConnectorAccountClaimedError";
    }
}

/**
 * Create the connection to this provider account, or replace its grant on
 * re-auth — the (company, provider, account) key makes re-connecting the same
 * account converge on its existing row. A per-user connection is its owner's:
 * re-connecting an account another member owns is refused rather than taking
 * their row (and the folder its pages live in) over. The refusal is enforced
 * in the write itself, so two members racing for one new grant cannot both
 * win; a per-user row left with no owner (written by an older build) is
 * adopted by whoever re-authorizes it.
 */
export async function upsertConnection(
    params: UpsertConnectionParams
): Promise<ConnectorConnection> {
    getEngine(); // populates the secret-box slot

    const ownerUserId = params.ownerUserId ?? null;
    if (isPerUserProvider(params.provider) !== (ownerUserId != null)) {
        throw new Error(
            `A ${params.provider} connection ${ownerUserId == null ? "needs" : "takes no"} owner`
        );
    }
    if (ownerUserId != null) {
        const [claimed] = await db
            .select({ ownerUserId: connectorConnections.ownerUserId })
            .from(connectorConnections)
            .where(
                and(
                    eq(connectorConnections.companyId, params.companyId),
                    eq(connectorConnections.provider, params.provider),
                    eq(connectorConnections.providerAccountId, params.grant.providerAccountId)
                )
            )
            .limit(1);
        // The friendly early answer; the write below is what guarantees it.
        if (claimed?.ownerUserId != null && claimed.ownerUserId !== ownerUserId) {
            throw new ConnectorAccountClaimedError(params.provider);
        }
    }

    const access = encryptSecret(params.grant.accessToken);
    const refresh = params.grant.refreshToken ? encryptSecret(params.grant.refreshToken) : null;

    const values = {
        companyId: params.companyId,
        provider: params.provider,
        grantedByUserId: params.grantedByUserId,
        ownerUserId,
        providerAccountId: params.grant.providerAccountId,
        providerAccountEmail: params.grant.displayName,
        scopes: params.grant.scopes,
        accessTokenCiphertext: access.ciphertext,
        accessTokenExpiresAt: params.grant.accessTokenExpiresAt,
        refreshTokenCiphertext: refresh?.ciphertext ?? null,
        encryptionKeyVersion: access.keyVersion,
        status: "active" as const,
        lastRefreshError: null,
    };

    const [row] = await db
        .insert(connectorConnections)
        .values(values)
        .onConflictDoUpdate({
            target: [
                connectorConnections.companyId,
                connectorConnections.provider,
                connectorConnections.providerAccountId,
            ],
            set: { ...values, updatedAt: new Date() },
            // A per-user row is only ever rewritten for its own owner.
            ...(ownerUserId != null
                ? {
                      setWhere: or(
                          isNull(connectorConnections.ownerUserId),
                          eq(connectorConnections.ownerUserId, ownerUserId)
                      ),
                  }
                : {}),
        })
        .returning();
    if (!row) {
        // ON CONFLICT … WHERE false returns nothing: someone else owns it.
        if (ownerUserId != null) throw new ConnectorAccountClaimedError(params.provider);
        throw new Error("Failed to upsert connection");
    }
    return row;
}

export async function markConnectionRevoked(connectionId: number, reason: string): Promise<void> {
    await db
        .update(connectorConnections)
        .set({
            status: "revoked",
            lastRefreshError: reason,
            accessTokenCiphertext: null,
            accessTokenExpiresAt: null,
            updatedAt: new Date(),
        })
        .where(eq(connectorConnections.id, connectionId));
}

/**
 * Delete the row and return the tokens for best-effort provider-side
 * revocation. Undecryptable tokens (a key-rotation casualty) come back null —
 * the row is gone either way.
 */
export async function deleteConnection(
    connectionId: number
): Promise<{ accessToken: string | null; refreshToken: string | null } | null> {
    getEngine();
    const connection = await getConnectionById(connectionId);
    if (!connection) return null;
    await db.delete(connectorConnections).where(eq(connectorConnections.id, connectionId));
    return {
        accessToken: tryDecrypt(connection.accessTokenCiphertext),
        refreshToken: tryDecrypt(connection.refreshTokenCiphertext),
    };
}

export interface RemovedConnection {
    readonly id: number;
    readonly provider: ConnectorProvider;
    readonly accessToken: string | null;
    readonly refreshToken: string | null;
}

/**
 * Delete every per-user connection (Gmail, Notion) a member owns in this
 * workspace — they leave with the member — inside the caller's transaction,
 * and hand back the tokens so the caller can revoke them once it commits.
 * Sync state cascades; the documents and folders they imported stay.
 */
export async function deleteOwnedConnections(
    executor: Executor,
    companyId: bigint,
    ownerUserId: bigint
): Promise<RemovedConnection[]> {
    getEngine();
    const rows = await executor
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.ownerUserId, ownerUserId)
            )
        );
    if (rows.length === 0) return [];
    await executor.delete(connectorConnections).where(
        inArray(
            connectorConnections.id,
            rows.map(row => row.id)
        )
    );
    return rows.map(row => ({
        id: row.id,
        provider: row.provider as ConnectorProvider,
        accessToken: tryDecrypt(row.accessTokenCiphertext),
        refreshToken: tryDecrypt(row.refreshTokenCiphertext),
    }));
}

function tryDecrypt(ciphertext: string | null): string | null {
    if (!ciphertext) return null;
    try {
        return decryptSecret(ciphertext);
    } catch {
        return null; // key-rotation casualty; the row is gone either way
    }
}

/**
 * A live access token for a Slack/GitHub connection — the stored token when
 * it does not expire or is still fresh, refreshed (and re-stored) otherwise.
 * Marks the connection revoked and rethrows when the provider reports the
 * grant dead. Google rows are served by
 * `~/server/services/google-drive/connections`.
 */
export async function getConnectionAccessToken(connection: ConnectorConnection): Promise<string> {
    getEngine();

    if (!isOAuthProvider(connection.provider)) {
        throw new Error(
            `getConnectionAccessToken serves Slack/GitHub; ${connection.provider} has its own accessor`
        );
    }

    const fresh =
        connection.accessTokenExpiresAt == null ||
        connection.accessTokenExpiresAt.getTime() - Date.now() > ACCESS_TOKEN_EXPIRY_BUFFER_MS;
    if (connection.accessTokenCiphertext && fresh) {
        try {
            return decryptSecret(connection.accessTokenCiphertext);
        } catch {
            // Undecryptable cache (key rotation): fall through to refresh.
        }
    }

    return refreshStoredToken(connection);
}

/**
 * Refresh now, whatever the stored expiry says, and return the new access
 * token. For providers that send no expiry (Notion): the first sign a
 * token died is a 401, and one refresh is the only way to tell a stale
 * token from a revoked grant. Re-reads the row so a refresh token rotated
 * since the caller loaded it is the one spent.
 */
export async function refreshConnectionAccessToken(connectionId: number): Promise<string> {
    getEngine();
    const connection = await getConnectionById(connectionId);
    if (!connection) throw new Error(`Connection ${connectionId} no longer exists`);
    return refreshStoredToken(connection);
}

async function refreshStoredToken(connection: ConnectorConnection): Promise<string> {
    if (!isOAuthProvider(connection.provider)) {
        throw new Error(
            `Token refresh here serves the generic providers; ${connection.provider} has its own accessor`
        );
    }
    if (!connection.refreshTokenCiphertext) {
        throw new Error(
            `The stored ${connection.provider} token expired and no refresh token exists — reconnect required`
        );
    }

    const provider = connection.provider;
    const config = getConnectorConfig(provider);
    if (!config) throw new Error(`The ${provider} connector is not configured`);

    let refreshToken: string;
    try {
        refreshToken = decryptSecret(connection.refreshTokenCiphertext);
    } catch (error) {
        throw new Error(
            `Cannot decrypt the stored ${provider} refresh token (key version ${connection.encryptionKeyVersion}) — reconnect required`,
            { cause: error }
        );
    }

    try {
        const refreshed = await PROVIDER_MODULES[provider].refreshAccessToken(config, refreshToken);
        const access = encryptSecret(refreshed.accessToken);
        const rotated = refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : null;
        await db
            .update(connectorConnections)
            .set({
                accessTokenCiphertext: access.ciphertext,
                accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
                ...(rotated ? { refreshTokenCiphertext: rotated.ciphertext } : {}),
            })
            .where(eq(connectorConnections.id, connection.id));
        return refreshed.accessToken;
    } catch (error) {
        if (error instanceof ConnectorGrantRevokedError) {
            await markConnectionRevoked(connection.id, error.message);
        }
        throw error;
    }
}

/**
 * Convenience for consumers: the workspace's live token for a provider, or
 * null when nothing usable is connected. Never throws on a dead grant — the
 * consumer falls back to whatever it did before connections existed.
 */
export async function getCompanyAccessToken(
    companyId: bigint,
    provider: ConnectorProvider
): Promise<string | null> {
    // A per-user connection (a Gmail mailbox, someone's Notion) is one
    // member's, never the workspace's credential — nothing company-scoped
    // may borrow it.
    if (isPerUserProvider(provider)) return null;
    const connection = await getActiveConnection(companyId, provider);
    if (!connection) return null;
    try {
        if (provider === "google-drive") {
            const { getAccessTokenForConnection } = await import(
                "~/server/services/google-drive/connections"
            );
            return await getAccessTokenForConnection(connection);
        }
        return await getConnectionAccessToken(connection);
    } catch (error) {
        console.error(
            `[connectors] ${provider} token unavailable for company ${companyId}:`,
            error instanceof Error ? error.message : error
        );
        return null;
    }
}
