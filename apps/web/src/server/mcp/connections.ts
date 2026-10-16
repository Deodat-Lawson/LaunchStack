/**
 * Assistants a person has connected to a workspace over OAuth.
 *
 * A connection is a consent row in better-auth's OAuth tables: one per
 * (assistant, person, workspace). It is what Settings lists and what Revoke
 * removes. Access tokens are JWTs and outlive any row, so the MCP route also
 * asks `hasLiveConsent` on every request: revoking here cuts an assistant off
 * at its next call instead of when its token expires.
 */
import { and, desc, eq, isNull, max } from "drizzle-orm";

import { db } from "~/server/db";
import {
    authOauthAccessToken,
    authOauthClient,
    authOauthConsent,
    authOauthRefreshToken,
} from "~/server/db/schema/auth";
import type { AssistantClient } from "~/server/db/schema/mcp";

/**
 * Which assistant family a client is, from what it calls itself. Used for
 * labels ("Saved from Claude") and the conversation viewer — never for access.
 */
export function assistantFamily(name: string | null | undefined): AssistantClient {
    const n = (name ?? "").toLowerCase();
    if (/claude|anthropic/.test(n)) return "claude";
    if (/chatgpt|openai|codex/.test(n)) return "chatgpt";
    if (/gemini|google|antigravity/.test(n)) return "gemini";
    return "other";
}

export interface ConnectionSummary {
    clientId: string;
    name: string;
    family: AssistantClient;
    icon: string | null;
    uri: string | null;
    scopes: string[];
    connectedAt: string | null;
    lastActiveAt: string | null;
}

export async function listConnections(input: {
    authUserId: string;
    companyId: bigint;
}): Promise<ConnectionSummary[]> {
    const reference = String(input.companyId);
    const consents = await db
        .select({
            clientId: authOauthConsent.clientId,
            scopes: authOauthConsent.scopes,
            createdAt: authOauthConsent.createdAt,
            updatedAt: authOauthConsent.updatedAt,
            name: authOauthClient.name,
            icon: authOauthClient.icon,
            uri: authOauthClient.uri,
        })
        .from(authOauthConsent)
        .innerJoin(authOauthClient, eq(authOauthClient.clientId, authOauthConsent.clientId))
        .where(
            and(
                eq(authOauthConsent.userId, input.authUserId),
                eq(authOauthConsent.referenceId, reference)
            )
        )
        .orderBy(desc(authOauthConsent.updatedAt));
    if (consents.length === 0) return [];

    // Last token issued per client stands in for "last active": a client
    // refreshes when it uses the connection after its hour-long token lapses.
    const activity = await db
        .select({
            clientId: authOauthRefreshToken.clientId,
            last: max(authOauthRefreshToken.createdAt),
        })
        .from(authOauthRefreshToken)
        .where(
            and(
                eq(authOauthRefreshToken.userId, input.authUserId),
                eq(authOauthRefreshToken.referenceId, reference)
            )
        )
        .groupBy(authOauthRefreshToken.clientId);
    const lastByClient = new Map(activity.map(a => [a.clientId, a.last]));

    return consents.map(c => {
        const name = c.name?.trim() || "Unnamed assistant";
        const last = lastByClient.get(c.clientId) ?? c.updatedAt ?? c.createdAt;
        return {
            clientId: c.clientId,
            name,
            family: assistantFamily(name),
            icon: c.icon,
            uri: c.uri,
            scopes: c.scopes,
            connectedAt: c.createdAt?.toISOString() ?? null,
            lastActiveAt: last?.toISOString() ?? null,
        };
    });
}

/**
 * Disconnects one assistant from one workspace for one person: the consent
 * goes, and every refresh and access token it issued is revoked. The other
 * workspaces that person connected the same assistant to are untouched.
 */
export async function revokeConnection(input: {
    authUserId: string;
    companyId: bigint;
    clientId: string;
}): Promise<boolean> {
    const reference = String(input.companyId);
    const now = new Date();
    return db.transaction(async tx => {
        const removed = await tx
            .delete(authOauthConsent)
            .where(
                and(
                    eq(authOauthConsent.clientId, input.clientId),
                    eq(authOauthConsent.userId, input.authUserId),
                    eq(authOauthConsent.referenceId, reference)
                )
            )
            .returning({ id: authOauthConsent.id });
        await tx
            .update(authOauthRefreshToken)
            .set({ revoked: now })
            .where(
                and(
                    eq(authOauthRefreshToken.clientId, input.clientId),
                    eq(authOauthRefreshToken.userId, input.authUserId),
                    eq(authOauthRefreshToken.referenceId, reference),
                    isNull(authOauthRefreshToken.revoked)
                )
            );
        await tx
            .update(authOauthAccessToken)
            .set({ revoked: now })
            .where(
                and(
                    eq(authOauthAccessToken.clientId, input.clientId),
                    eq(authOauthAccessToken.userId, input.authUserId),
                    eq(authOauthAccessToken.referenceId, reference),
                    isNull(authOauthAccessToken.revoked)
                )
            );
        return removed.length > 0;
    });
}

/** Whether this assistant still holds consent for this person in this workspace. */
export async function hasLiveConsent(input: {
    authUserId: string;
    companyId: bigint;
    clientId: string;
}): Promise<boolean> {
    const [row] = await db
        .select({ id: authOauthConsent.id })
        .from(authOauthConsent)
        .where(
            and(
                eq(authOauthConsent.clientId, input.clientId),
                eq(authOauthConsent.userId, input.authUserId),
                eq(authOauthConsent.referenceId, String(input.companyId))
            )
        )
        .limit(1);
    return Boolean(row);
}

/** The client's display name, for labels on what it saves. */
export async function clientDisplayName(clientId: string): Promise<string | null> {
    const [row] = await db
        .select({ name: authOauthClient.name })
        .from(authOauthClient)
        .where(eq(authOauthClient.clientId, clientId))
        .limit(1);
    return row?.name?.trim() || null;
}
