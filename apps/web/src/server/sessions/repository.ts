/**
 * Data access for persisted Ask sessions.
 *
 * Every read and write is scoped by `(companyId, userId)` here rather than in
 * the route handlers, so a forgotten `where` clause cannot hand someone else's
 * chat to a caller who guessed a uuid. The routes never build a query
 * themselves — they call these functions and translate the result.
 */

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
    deriveSessionTitle,
    MAX_SESSION_APPEND,
    MAX_SESSION_MESSAGE_CHARS,
} from "~/lib/workspace-history";
import { db } from "~/server/db";
import {
    workspaceSessionMessages,
    workspaceSessions,
    type WorkspaceSessionMessageRow,
    type WorkspaceSessionRow,
} from "~/server/db/schema";

export interface SessionOwner {
    companyId: bigint;
    /** Auth subject id. */
    userId: string;
}

export interface SessionMessageInput {
    role: "user" | "assistant";
    text: string;
    refs?: string[];
    citations?: unknown[];
    attachments?: unknown[];
    model?: string | null;
    tokens?: number | null;
}

export interface SessionSummary {
    id: string;
    title: string;
    messageCount: number;
    pinned: boolean;
    contextSourceIds: string[];
    lastMessageAt: string;
    createdAt: string;
}

export interface SessionMessage extends SessionMessageInput {
    seq: number;
    createdAt: string;
}

export interface SessionDetail extends SessionSummary {
    continuation: { title: string; context: string } | null;
    messages: SessionMessage[];
}

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: WorkspaceSessionRow): SessionSummary {
    return {
        id: row.id,
        title: row.title,
        messageCount: row.messageCount,
        pinned: row.pinned,
        contextSourceIds: row.contextSourceIds ?? [],
        lastMessageAt: iso(row.lastMessageAt),
        createdAt: iso(row.createdAt),
    };
}

function toMessage(row: WorkspaceSessionMessageRow): SessionMessage {
    return {
        seq: row.seq,
        role: row.role,
        text: row.text,
        refs: row.refs ?? undefined,
        citations: row.citations ?? undefined,
        attachments: row.attachments ?? undefined,
        model: row.model,
        tokens: row.tokens,
        createdAt: iso(row.createdAt),
    };
}

/** Trim to the storage cap. Truncating beats refusing to save the turn at all. */
function clampText(text: string): string {
    return text.length > MAX_SESSION_MESSAGE_CHARS
        ? text.slice(0, MAX_SESSION_MESSAGE_CHARS)
        : text;
}

const ownedBy = (owner: SessionOwner) =>
    and(
        eq(workspaceSessions.companyId, owner.companyId),
        eq(workspaceSessions.userId, owner.userId)
    );

export async function listSessions(
    owner: SessionOwner,
    options: { limit?: number } = {}
): Promise<SessionSummary[]> {
    const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
    const rows = await db
        .select()
        .from(workspaceSessions)
        .where(ownedBy(owner))
        .orderBy(desc(workspaceSessions.pinned), desc(workspaceSessions.lastMessageAt))
        .limit(limit);
    return rows.map(toSummary);
}

/**
 * Create a session and store its opening turns in one transaction: a session
 * row with no messages would show up in the sidebar as an untitled ghost, and
 * the first send is the only moment we know what to call it.
 */
export async function createSession(
    owner: SessionOwner,
    input: {
        messages: SessionMessageInput[];
        title?: string;
        contextSourceIds?: string[];
        continuation?: { title: string; context: string } | null;
    }
): Promise<SessionDetail> {
    const messages = input.messages.slice(0, MAX_SESSION_APPEND);
    const firstUserTurn = messages.find(m => m.role === "user")?.text ?? "";
    const title = (input.title?.trim() ?? "") || deriveSessionTitle(firstUserTurn);
    const id = randomUUID();
    const now = new Date();

    return db.transaction(async tx => {
        const [row] = await tx
            .insert(workspaceSessions)
            .values({
                id,
                companyId: owner.companyId,
                userId: owner.userId,
                title,
                contextSourceIds: input.contextSourceIds ?? [],
                continuation: input.continuation ?? null,
                messageCount: messages.length,
                lastMessageAt: now,
                createdAt: now,
                updatedAt: now,
            })
            .returning();

        if (messages.length > 0) {
            await tx.insert(workspaceSessionMessages).values(
                messages.map((message, index) => ({
                    sessionId: id,
                    seq: index,
                    role: message.role,
                    text: clampText(message.text),
                    refs: message.refs ?? null,
                    citations: message.citations ?? null,
                    attachments: message.attachments ?? null,
                    model: message.model ?? null,
                    tokens: message.tokens ?? null,
                }))
            );
        }

        return {
            ...toSummary(row!),
            continuation: input.continuation ?? null,
            messages: messages.map((message, index) => ({
                ...message,
                seq: index,
                createdAt: iso(now),
            })),
        };
    });
}

export async function getSession(
    owner: SessionOwner,
    sessionId: string
): Promise<SessionDetail | null> {
    const [row] = await db
        .select()
        .from(workspaceSessions)
        .where(and(ownedBy(owner), eq(workspaceSessions.id, sessionId)));
    if (!row) return null;

    const messages = await db
        .select()
        .from(workspaceSessionMessages)
        .where(eq(workspaceSessionMessages.sessionId, sessionId))
        .orderBy(asc(workspaceSessionMessages.seq));

    return {
        ...toSummary(row),
        continuation: row.continuation ?? null,
        messages: messages.map(toMessage),
    };
}

/**
 * Append turns to an existing session.
 *
 * `seq` continues from the stored count rather than from what the client
 * believes, so two tabs appending at once collide on the unique index instead
 * of interleaving into nonsense. Returns null when the session is not the
 * caller's — the route turns that into a 404, not a 403, because a uuid the
 * caller does not own should not be confirmed to exist.
 */
export async function appendMessages(
    owner: SessionOwner,
    sessionId: string,
    input: { messages: SessionMessageInput[]; contextSourceIds?: string[] }
): Promise<SessionSummary | null> {
    const messages = input.messages.slice(0, MAX_SESSION_APPEND);
    if (messages.length === 0) return null;

    return db.transaction(async tx => {
        const [existing] = await tx
            .select({ messageCount: workspaceSessions.messageCount })
            .from(workspaceSessions)
            .where(and(ownedBy(owner), eq(workspaceSessions.id, sessionId)))
            .for("update");
        if (!existing) return null;

        await tx.insert(workspaceSessionMessages).values(
            messages.map((message, index) => ({
                sessionId,
                seq: existing.messageCount + index,
                role: message.role,
                text: clampText(message.text),
                refs: message.refs ?? null,
                citations: message.citations ?? null,
                attachments: message.attachments ?? null,
                model: message.model ?? null,
                tokens: message.tokens ?? null,
            }))
        );

        const now = new Date();
        const [row] = await tx
            .update(workspaceSessions)
            .set({
                messageCount: sql`${workspaceSessions.messageCount} + ${messages.length}`,
                ...(input.contextSourceIds ? { contextSourceIds: input.contextSourceIds } : {}),
                lastMessageAt: now,
                updatedAt: now,
            })
            .where(and(ownedBy(owner), eq(workspaceSessions.id, sessionId)))
            .returning();

        return row ? toSummary(row) : null;
    });
}

export async function updateSession(
    owner: SessionOwner,
    sessionId: string,
    patch: { title?: string; pinned?: boolean }
): Promise<SessionSummary | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) values.title = patch.title.trim().slice(0, 300);
    if (patch.pinned !== undefined) values.pinned = patch.pinned;

    const [row] = await db
        .update(workspaceSessions)
        .set(values)
        .where(and(ownedBy(owner), eq(workspaceSessions.id, sessionId)))
        .returning();
    return row ? toSummary(row) : null;
}

/** Hard delete — the messages go with it via the cascade. There is no trash here. */
export async function deleteSession(owner: SessionOwner, sessionId: string): Promise<boolean> {
    const rows = await db
        .delete(workspaceSessions)
        .where(and(ownedBy(owner), eq(workspaceSessions.id, sessionId)))
        .returning({ id: workspaceSessions.id });
    return rows.length > 0;
}
