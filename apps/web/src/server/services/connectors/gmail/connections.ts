/**
 * Per-user Gmail connections: one row per member per workspace, owned by the
 * member (`ownerUserId`), token lifecycle shared with the other Google rows.
 *
 * The refresh token is secret-box encrypted like every connection; access
 * tokens are minted through the Drive services' accessor, which already
 * knows how to refresh against the shared Google OAuth client and how to
 * flip a row to `revoked` on invalid_grant.
 */
import { and, eq, sql } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";

import { db } from "~/server/db";
import { connectorConnections, type ConnectorConnection } from "~/server/db/schema";
import { getEngine } from "~/server/engine";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";

import { GMAIL_PROVIDER } from "./config";
import { resetSyncState } from "./store";

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Another member of this workspace already connected that Google account. */
export class GmailAccountClaimedError extends Error {
    constructor(readonly accountEmail: string | null) {
        super(
            `${accountEmail ?? "That Google account"} is already connected by another member of this workspace.`
        );
        this.name = "GmailAccountClaimedError";
    }
}

/** The member's Gmail connection in this workspace, whatever its status. */
export async function getGmailConnectionForUser(
    companyId: bigint,
    ownerUserId: bigint
): Promise<ConnectorConnection | null> {
    const [row] = await db
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.provider, GMAIL_PROVIDER),
                eq(connectorConnections.ownerUserId, ownerUserId)
            )
        )
        .limit(1);
    return row ?? null;
}

export interface UpsertGmailConnectionParams {
    readonly companyId: bigint;
    readonly ownerUserId: bigint;
    readonly providerAccountId: string;
    readonly providerAccountEmail: string | null;
    readonly refreshToken: string;
    readonly scopes: string;
}

export interface UpsertGmailConnectionResult {
    readonly connection: ConnectorConnection;
    /** The member reconnected with a different Google account. */
    readonly mailboxChanged: boolean;
}

/**
 * Store (or re-store, after a reconnect) the member's connection. Keyed on
 * the owner, so reconnecting converges on the member's row even when they
 * pick a different Google account; a different account resets the sync
 * cursor, because history ids belong to one mailbox.
 */
export async function upsertGmailConnection(
    params: UpsertGmailConnectionParams
): Promise<UpsertGmailConnectionResult> {
    getEngine();

    const [claimed] = await db
        .select({ id: connectorConnections.id, ownerUserId: connectorConnections.ownerUserId })
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, params.companyId),
                eq(connectorConnections.provider, GMAIL_PROVIDER),
                eq(connectorConnections.providerAccountId, params.providerAccountId)
            )
        )
        .limit(1);
    if (claimed && claimed.ownerUserId !== params.ownerUserId) {
        throw new GmailAccountClaimedError(params.providerAccountEmail);
    }

    const previous = await getGmailConnectionForUser(params.companyId, params.ownerUserId);
    const { ciphertext, keyVersion } = encryptSecret(params.refreshToken);

    const [row] = await db
        .insert(connectorConnections)
        .values({
            companyId: params.companyId,
            provider: GMAIL_PROVIDER,
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
            targetWhere: sql`owner_user_id is not null`,
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
    if (!row) throw new Error("Failed to store the Gmail connection");

    const mailboxChanged = Boolean(
        previous && previous.providerAccountId !== params.providerAccountId
    );
    if (mailboxChanged) await resetSyncState(row.id);

    return { connection: row, mailboxChanged };
}

/**
 * Delete the member's connection (state and scope cascade; documents stay)
 * and hand back the refresh token for best-effort revocation at Google.
 */
export async function deleteGmailConnection(
    connectionId: number
): Promise<{ refreshToken: string | null } | null> {
    getEngine();
    const [row] = await db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.id, connectionId))
        .limit(1);
    if (!row) return null;
    await db.delete(connectorConnections).where(eq(connectorConnections.id, connectionId));
    let refreshToken: string | null = null;
    if (row.refreshTokenCiphertext) {
        try {
            refreshToken = decryptSecret(row.refreshTokenCiphertext);
        } catch {
            refreshToken = null; // key-rotation casualty; the row is gone either way
        }
    }
    return { refreshToken };
}

/**
 * Tell Google the grant is over so a copied refresh token dies with the
 * connection. Best effort: a failure here is logged, never surfaced — the
 * row is already gone.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
    try {
        const response = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        return response.ok;
    } catch (error) {
        console.error("[gmail] token revocation failed:", error);
        return false;
    }
}

/** A live access token for the mailbox; marks the row revoked on invalid_grant. */
export function getGmailAccessToken(connection: ConnectorConnection): Promise<string> {
    return getAccessTokenForConnection(connection);
}
