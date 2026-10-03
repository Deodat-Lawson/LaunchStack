/**
 * The chats in one person's History (ADR-014 §5): their own, and other
 * people's that are shared with them, each with that person's pin, archive and
 * unread state.
 *
 * Sorted newest activity first. Pinned chats always come back, however old,
 * because the rail draws them on top in their manual order (`pinRank`) — the
 * ordering of the Pinned section is the client's job; making sure every pin is
 * in the payload is this module's.
 *
 * Archived chats are left out by default; `archived: true` returns only them.
 */

import { and, count, desc, eq, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";

import { db } from "~/server/db";
import { workspaceSessionUserState, workspaceSessions } from "~/server/db/schema";
import { accessSubject } from "~/server/workspace/item-access";

import { sessionIdsSharedWith, type SessionActor } from "./access";

export interface ChatFeedRow {
    id: string;
    title: string;
    messageCount: number;
    lastMessageAt: string;
    /** Auth subject id of the owner. */
    ownerAuthUserId: string;
    mine: boolean;
    pinned: boolean;
    pinRank: number | null;
    archived: boolean;
    /** Own chat with at least one grant. */
    shared: boolean;
    /** Someone else's chat with turns I haven't opened since. */
    unread: boolean;
}

export interface ChatFeed {
    rows: ChatFeedRow[];
    /** How many chats this person has archived (only counted outside the archived view). */
    archivedCount: number | null;
}

const MAX_PINS = 200;

const columns = {
    id: workspaceSessions.id,
    title: workspaceSessions.title,
    userId: workspaceSessions.userId,
    messageCount: workspaceSessions.messageCount,
    lastMessageAt: workspaceSessions.lastMessageAt,
    sharedAt: workspaceSessions.sharedAt,
    pinnedAt: workspaceSessionUserState.pinnedAt,
    pinRank: workspaceSessionUserState.pinRank,
    archivedAt: workspaceSessionUserState.archivedAt,
    lastSeenAt: workspaceSessionUserState.lastSeenAt,
};

type Row = {
    id: string;
    title: string;
    userId: string;
    messageCount: number;
    lastMessageAt: Date;
    sharedAt: Date | null;
    pinnedAt: Date | null;
    pinRank: number | null;
    archivedAt: Date | null;
    lastSeenAt: Date | null;
};

export function toFeedRow(row: Row, me: string): ChatFeedRow {
    const mine = row.userId === me;
    return {
        id: row.id,
        title: row.title,
        messageCount: row.messageCount,
        lastMessageAt: row.lastMessageAt.toISOString(),
        ownerAuthUserId: row.userId,
        mine,
        pinned: row.pinnedAt !== null,
        pinRank: row.pinnedAt !== null ? row.pinRank : null,
        archived: row.archivedAt !== null,
        shared: mine && row.sharedAt !== null,
        unread:
            !mine &&
            row.messageCount > 0 &&
            (row.lastSeenAt === null || row.lastMessageAt.getTime() > row.lastSeenAt.getTime()),
    };
}

export async function listChatFeed(
    actor: SessionActor,
    options: { limit: number; archived?: boolean }
): Promise<ChatFeed> {
    const me = actor.authUserId;
    const subject = await accessSubject(actor);
    const sharedIds = await sessionIdsSharedWith(actor, subject);

    const select = (where: SQL | undefined, limit: number) =>
        db
            .select(columns)
            .from(workspaceSessions)
            .leftJoin(
                workspaceSessionUserState,
                and(
                    eq(workspaceSessionUserState.sessionId, workspaceSessions.id),
                    eq(workspaceSessionUserState.userId, me)
                )
            )
            .where(and(eq(workspaceSessions.companyId, actor.companyId), where))
            .orderBy(desc(workspaceSessions.lastMessageAt))
            .limit(limit);

    const archivedFilter = options.archived
        ? isNotNull(workspaceSessionUserState.archivedAt)
        : isNull(workspaceSessionUserState.archivedAt);
    const readable =
        sharedIds.length > 0
            ? or(eq(workspaceSessions.userId, me), inArray(workspaceSessions.id, sharedIds))
            : eq(workspaceSessions.userId, me);

    const [own, shared, pinned, archived] = await Promise.all([
        select(and(eq(workspaceSessions.userId, me), archivedFilter), options.limit),
        sharedIds.length === 0
            ? Promise.resolve([] as Row[])
            : select(and(inArray(workspaceSessions.id, sharedIds), archivedFilter), options.limit),
        options.archived
            ? Promise.resolve([] as Row[])
            : select(
                  and(readable, isNotNull(workspaceSessionUserState.pinnedAt), archivedFilter),
                  MAX_PINS
              ),
        options.archived
            ? Promise.resolve(null)
            : db
                  .select({ n: count() })
                  .from(workspaceSessionUserState)
                  .innerJoin(
                      workspaceSessions,
                      eq(workspaceSessions.id, workspaceSessionUserState.sessionId)
                  )
                  .where(
                      and(
                          eq(workspaceSessionUserState.companyId, actor.companyId),
                          eq(workspaceSessionUserState.userId, me),
                          isNotNull(workspaceSessionUserState.archivedAt),
                          readable
                      )
                  ),
    ]);

    const byId = new Map<string, ChatFeedRow>();
    for (const row of [...pinned, ...own, ...shared]) {
        if (!byId.has(row.id)) byId.set(row.id, toFeedRow(row, me));
    }
    const rows = [...byId.values()].sort(
        (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
    );
    return { rows, archivedCount: archived ? Number(archived[0]?.n ?? 0) : null };
}
