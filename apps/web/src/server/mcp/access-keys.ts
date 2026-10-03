/**
 * Access keys: a long-lived secret a person creates in Settings to connect a
 * script, an API call or a CLI to the MCP server without the OAuth dance.
 *
 * A key is the person who made it, in the workspace they made it in, with
 * either read-only or read-and-save scopes — never more than their own
 * membership allows, because every call still resolves their live
 * permissions. Only the SHA-256 of the secret is stored; the plaintext is
 * returned once, at creation. Revoking stamps `revokedAt`, and the very next
 * request with that key fails.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "~/server/db";
import { mcpAccessKeys, type McpAccessKey } from "~/server/db/schema/mcp";
import { users } from "~/server/db/schema/identity";
import { ACCESS_KEY_PREFIX, MCP_SCOPE_READ, MCP_SCOPE_WRITE } from "./config";

export const ACCESS_KEY_NAME_MAX = 80;
/** A person can hold this many live keys per workspace. */
export const ACCESS_KEYS_PER_MEMBER = 20;
/** `lastUsedAt` is written at most this often per key. */
const LAST_USED_RESOLUTION_MS = 60_000;

export type AccessKeyAccess = "read" | "read-write";

export function scopesForAccess(access: AccessKeyAccess): string[] {
    return access === "read-write" ? [MCP_SCOPE_READ, MCP_SCOPE_WRITE] : [MCP_SCOPE_READ];
}

export function hashAccessKey(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
}

export function looksLikeAccessKey(token: string): boolean {
    return token.startsWith(ACCESS_KEY_PREFIX);
}

/** What Settings lists — never the secret or its hash. */
export interface AccessKeySummary {
    id: number;
    name: string;
    displayPrefix: string;
    access: AccessKeyAccess;
    createdAt: string;
    lastUsedAt: string | null;
}

function summarize(row: McpAccessKey): AccessKeySummary {
    return {
        id: row.id,
        name: row.name,
        displayPrefix: row.displayPrefix,
        access: row.scopes.includes(MCP_SCOPE_WRITE) ? "read-write" : "read",
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    };
}

export async function listAccessKeys(input: {
    companyId: bigint;
    userPk: bigint;
}): Promise<AccessKeySummary[]> {
    const rows = await db
        .select()
        .from(mcpAccessKeys)
        .where(
            and(
                eq(mcpAccessKeys.companyId, input.companyId),
                eq(mcpAccessKeys.userId, input.userPk),
                isNull(mcpAccessKeys.revokedAt)
            )
        )
        .orderBy(desc(mcpAccessKeys.createdAt));
    return rows.map(summarize);
}

export class AccessKeyLimitError extends Error {
    constructor() {
        super(`You can hold at most ${ACCESS_KEYS_PER_MEMBER} access keys in a workspace.`);
    }
}

/** Creates a key and returns its secret — the only time it is ever readable. */
export async function createAccessKey(input: {
    companyId: bigint;
    userPk: bigint;
    name: string;
    access: AccessKeyAccess;
}): Promise<{ key: AccessKeySummary; secret: string }> {
    const live = await listAccessKeys(input);
    if (live.length >= ACCESS_KEYS_PER_MEMBER) throw new AccessKeyLimitError();
    const secret = `${ACCESS_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const [row] = await db
        .insert(mcpAccessKeys)
        .values({
            companyId: input.companyId,
            userId: input.userPk,
            name: input.name.trim().slice(0, ACCESS_KEY_NAME_MAX),
            displayPrefix: secret.slice(0, ACCESS_KEY_PREFIX.length + 6),
            secretHash: hashAccessKey(secret),
            scopes: scopesForAccess(input.access),
        })
        .returning();
    return { key: summarize(row!), secret };
}

/** Revokes one of the caller's own keys. False when there was none to revoke. */
export async function revokeAccessKey(input: {
    companyId: bigint;
    userPk: bigint;
    keyId: number;
}): Promise<boolean> {
    const rows = await db
        .update(mcpAccessKeys)
        .set({ revokedAt: new Date() })
        .where(
            and(
                eq(mcpAccessKeys.id, input.keyId),
                eq(mcpAccessKeys.companyId, input.companyId),
                eq(mcpAccessKeys.userId, input.userPk),
                isNull(mcpAccessKeys.revokedAt)
            )
        )
        .returning({ id: mcpAccessKeys.id });
    return rows.length > 0;
}

export interface VerifiedAccessKey {
    keyId: number;
    keyName: string;
    authUserId: string;
    companyId: bigint;
    scopes: string[];
}

/** The live key behind a presented secret, or null. Bumps `lastUsedAt`. */
export async function verifyAccessKey(secret: string): Promise<VerifiedAccessKey | null> {
    if (!looksLikeAccessKey(secret)) return null;
    const [row] = await db
        .select({
            id: mcpAccessKeys.id,
            name: mcpAccessKeys.name,
            companyId: mcpAccessKeys.companyId,
            scopes: mcpAccessKeys.scopes,
            lastUsedAt: mcpAccessKeys.lastUsedAt,
            authUserId: users.userId,
        })
        .from(mcpAccessKeys)
        .innerJoin(users, eq(users.id, mcpAccessKeys.userId))
        .where(
            and(
                eq(mcpAccessKeys.secretHash, hashAccessKey(secret)),
                isNull(mcpAccessKeys.revokedAt)
            )
        );
    if (!row) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
        await db
            .update(mcpAccessKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(mcpAccessKeys.id, row.id));
    }
    return {
        keyId: row.id,
        keyName: row.name,
        authUserId: row.authUserId,
        companyId: row.companyId,
        scopes: row.scopes,
    };
}
