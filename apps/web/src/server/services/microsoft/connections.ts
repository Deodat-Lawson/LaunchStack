/**
 * Microsoft connections: token storage, refresh, and the two shapes a
 * connection takes. `microsoft-365` belongs to the workspace and records who
 * granted it; `outlook` belongs to the member (`ownerUserId`), one per member
 * per workspace. Refresh tokens are secret-box encrypted (the engine
 * registers the key; every entry point here runs `getEngine()` first).
 */
import { and, eq } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";

import { db } from "~/server/db";
import {
    connectorConnections,
    OUTLOOK_OWNER_INDEX_PREDICATE,
    type ConnectorConnection,
} from "~/server/db/schema";
import { getEngine } from "~/server/engine";

import { getMicrosoftOAuthApp, MICROSOFT_365_PROVIDER, OUTLOOK_PROVIDER } from "./config";
import { MicrosoftAuthError, refreshMicrosoftToken } from "./oauth";

export class MicrosoftNotConnectedError extends Error {
    constructor() {
        super("No active Microsoft connection.");
        this.name = "MicrosoftNotConnectedError";
    }
}

/** The mailbox is already connected to this workspace by another member. */
export class OutlookAccountClaimedError extends Error {
    constructor() {
        super("That Outlook mailbox is already connected to this workspace by another member.");
        this.name = "OutlookAccountClaimedError";
    }
}

// ---------------------------------------------------------------------------
// Microsoft 365 files: one connection per workspace
// ---------------------------------------------------------------------------

export async function getActiveMicrosoft365Connection(
    companyId: bigint
): Promise<ConnectorConnection | null> {
    const [row] = await db
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.provider, MICROSOFT_365_PROVIDER),
                eq(connectorConnections.status, "active")
            )
        )
        .limit(1);
    return row ?? null;
}

export interface UpsertMicrosoftConnectionParams {
    companyId: bigint;
    grantedByUserId: bigint | null;
    providerAccountId: string;
    providerAccountEmail: string | null;
    refreshToken: string;
    scopes: string;
}

/**
 * Store (or re-store, after a reconnect) the workspace's file connection.
 * Reconnecting the same account revives its row with the fresh refresh token
 * rather than stacking a second connection.
 */
export async function upsertMicrosoft365Connection(
    params: UpsertMicrosoftConnectionParams
): Promise<ConnectorConnection> {
    getEngine();
    const { ciphertext, keyVersion } = encryptSecret(params.refreshToken);

    const [row] = await db
        .insert(connectorConnections)
        .values({
            companyId: params.companyId,
            provider: MICROSOFT_365_PROVIDER,
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

    if (!row) throw new Error("Failed to store the Microsoft 365 connection");
    accessTokenCache.delete(row.id);
    return row;
}

// ---------------------------------------------------------------------------
// Outlook: one mailbox per member per workspace
// ---------------------------------------------------------------------------

export async function getOutlookConnectionForUser(
    companyId: bigint,
    ownerUserId: bigint
): Promise<ConnectorConnection | null> {
    const [row] = await db
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.provider, OUTLOOK_PROVIDER),
                eq(connectorConnections.ownerUserId, ownerUserId)
            )
        )
        .limit(1);
    return row ?? null;
}

export interface UpsertOutlookConnectionParams {
    companyId: bigint;
    ownerUserId: bigint;
    providerAccountId: string;
    providerAccountEmail: string | null;
    refreshToken: string;
    scopes: string;
}

export interface UpsertOutlookConnectionResult {
    connection: ConnectorConnection;
    /** The member swapped to a different mailbox: the old one's sync state no longer applies. */
    mailboxChanged: boolean;
}

/**
 * Store the member's mailbox connection. A member has one per workspace, so
 * connecting again replaces it, including with a different mailbox
 * (`mailboxChanged`; the caller resets the sync state). A mailbox someone
 * else in the workspace already connected is refused: the account index
 * would otherwise hand their row to this member.
 */
export async function upsertOutlookConnection(
    params: UpsertOutlookConnectionParams
): Promise<UpsertOutlookConnectionResult> {
    getEngine();

    const [claimed] = await db
        .select({ ownerUserId: connectorConnections.ownerUserId })
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, params.companyId),
                eq(connectorConnections.provider, OUTLOOK_PROVIDER),
                eq(connectorConnections.providerAccountId, params.providerAccountId)
            )
        )
        .limit(1);
    if (claimed && claimed.ownerUserId !== params.ownerUserId) {
        throw new OutlookAccountClaimedError();
    }

    const previous = await getOutlookConnectionForUser(params.companyId, params.ownerUserId);
    const { ciphertext, keyVersion } = encryptSecret(params.refreshToken);

    const [row] = await db
        .insert(connectorConnections)
        .values({
            companyId: params.companyId,
            provider: OUTLOOK_PROVIDER,
            providerAccountId: params.providerAccountId,
            providerAccountEmail: params.providerAccountEmail,
            grantedByUserId: params.ownerUserId,
            ownerUserId: params.ownerUserId,
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
                connectorConnections.ownerUserId,
            ],
            targetWhere: OUTLOOK_OWNER_INDEX_PREDICATE,
            set: {
                providerAccountId: params.providerAccountId,
                providerAccountEmail: params.providerAccountEmail,
                grantedByUserId: params.ownerUserId,
                refreshTokenCiphertext: ciphertext,
                encryptionKeyVersion: keyVersion,
                scopes: params.scopes,
                status: "active",
                lastRefreshError: null,
                updatedAt: new Date(),
            },
        })
        .returning();

    if (!row) throw new Error("Failed to store the Outlook connection");
    accessTokenCache.delete(row.id);
    return {
        connection: row,
        mailboxChanged: Boolean(previous && previous.providerAccountId !== row.providerAccountId),
    };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export async function markMicrosoftConnectionRevoked(
    connectionId: number,
    reason: string
): Promise<void> {
    accessTokenCache.delete(connectionId);
    await db
        .update(connectorConnections)
        .set({ status: "revoked", lastRefreshError: reason, updatedAt: new Date() })
        .where(eq(connectorConnections.id, connectionId));
}

/**
 * Access tokens live about an hour; cache per connection and refresh five
 * minutes early. In-process only. Each entry remembers the grant it was
 * minted for (the account and its scopes): the web app and the worker are
 * separate processes, so a reconnect in one, as a different account or with
 * different scopes, must not leave the other syncing with the old grant's
 * token for the rest of the hour.
 */
const accessTokenCache = new Map<number, { token: string; expiresAt: number; grant: string }>();
const EXPIRY_MARGIN_MS = 5 * 60_000;

function grantIdentity(connection: ConnectorConnection): string {
    return `${connection.providerAccountId}|${connection.scopes ?? ""}`;
}

/**
 * A usable Graph access token for `connection` (either provider).
 *
 * Microsoft rotates refresh tokens: each refresh answers with a new one, and
 * the old one stops working some time later. The new one is stored before
 * the access token is returned, read fresh from the row each time, because
 * the web app and the worker are separate processes and the other one may
 * have rotated it since this row was loaded.
 */
export async function getMicrosoftAccessToken(connection: ConnectorConnection): Promise<string> {
    const cached = accessTokenCache.get(connection.id);
    if (cached && cached.expiresAt > Date.now() && cached.grant === grantIdentity(connection)) {
        return cached.token;
    }

    getEngine();
    const [fresh] = await db
        .select({ refreshTokenCiphertext: connectorConnections.refreshTokenCiphertext })
        .from(connectorConnections)
        .where(eq(connectorConnections.id, connection.id))
        .limit(1);
    const stored = fresh?.refreshTokenCiphertext ?? connection.refreshTokenCiphertext;
    if (!stored) throw new MicrosoftNotConnectedError();

    try {
        const token = await refreshMicrosoftToken({
            app: getMicrosoftOAuthApp(),
            refreshToken: decryptSecret(stored),
        });
        if (token.refresh_token) {
            const { ciphertext, keyVersion } = encryptSecret(token.refresh_token);
            await db
                .update(connectorConnections)
                .set({ refreshTokenCiphertext: ciphertext, encryptionKeyVersion: keyVersion })
                .where(eq(connectorConnections.id, connection.id));
        }
        accessTokenCache.set(connection.id, {
            token: token.access_token,
            expiresAt: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS,
            grant: grantIdentity(connection),
        });
        return token.access_token;
    } catch (err) {
        // The grant is gone at Microsoft: flip the connection so the UI says
        // "reconnect" instead of retrying forever.
        if (err instanceof MicrosoftAuthError && err.invalidGrant) {
            await markMicrosoftConnectionRevoked(connection.id, err.detail);
        }
        throw err;
    }
}

/** Test seam. */
export function clearMicrosoftAccessTokenCache(): void {
    accessTokenCache.clear();
}
