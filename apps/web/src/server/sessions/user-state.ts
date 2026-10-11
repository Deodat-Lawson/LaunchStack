/**
 * One person's organisation of their chat list (ADR-014 §5): pins and their
 * manual order, archive, and when they last opened a chat someone shared.
 *
 * It lives in `workspace_session_user_state`, keyed by (chat, person), for
 * your own chats and for chats shared with you alike — so the owner pinning a
 * chat never reorders a reader's sidebar, and a reader archiving a shared
 * chat hides it from nobody else. Anyone who can read a chat may organise it
 * for themselves; nobody else gets past `resolveSessionAccess` (404).
 */

import { and, asc, eq, isNotNull, min } from "drizzle-orm";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { workspaceSessionUserState } from "~/server/db/schema";

import { resolveSessionAccess } from "./access";

export interface SessionStatePatch {
    pinned?: boolean;
    archived?: boolean;
    seen?: true;
}

export interface SessionStateView {
    pinned: boolean;
    /** Ascending: lower is higher in the Pinned list. Null when not pinned. */
    pinRank: number | null;
    archived: boolean;
    lastSeenAt: string | null;
}

const mine = (ctx: WorkspaceContext) =>
    and(
        eq(workspaceSessionUserState.companyId, ctx.companyId),
        eq(workspaceSessionUserState.userId, ctx.authUserId)
    );

/** Null when the caller cannot read the chat. */
export async function setSessionState(
    ctx: WorkspaceContext,
    sessionId: string,
    patch: SessionStatePatch
): Promise<SessionStateView | null> {
    const access = await resolveSessionAccess(ctx, sessionId);
    if (!access) return null;

    return db.transaction(async tx => {
        const [current] = await tx
            .select()
            .from(workspaceSessionUserState)
            .where(
                and(
                    eq(workspaceSessionUserState.sessionId, sessionId),
                    eq(workspaceSessionUserState.userId, ctx.authUserId)
                )
            )
            .for("update");
        const now = new Date();
        let pinnedAt = current?.pinnedAt ?? null;
        let pinRank = current?.pinRank ?? null;
        let archivedAt = current?.archivedAt ?? null;
        let lastSeenAt = current?.lastSeenAt ?? null;

        if (patch.pinned === true) {
            if (!pinnedAt) {
                // A new pin lands on top: one above the current top.
                const [top] = await tx
                    .select({ rank: min(workspaceSessionUserState.pinRank) })
                    .from(workspaceSessionUserState)
                    .where(and(mine(ctx), isNotNull(workspaceSessionUserState.pinnedAt)));
                pinnedAt = now;
                pinRank = top?.rank === null || top?.rank === undefined ? 0 : top.rank - 1;
            }
            // Something pinned is something you want to see.
            archivedAt = null;
        } else if (patch.pinned === false) {
            pinnedAt = null;
            pinRank = null;
        }
        if (patch.archived === true) {
            archivedAt ??= now;
            // Archive hides it; a hidden pin would hold a place in an order you can't see.
            pinnedAt = null;
            pinRank = null;
        } else if (patch.archived === false) {
            archivedAt = null;
        }
        if (patch.seen) lastSeenAt = now;

        const values = { pinnedAt, pinRank, archivedAt, lastSeenAt, updatedAt: now };
        await tx
            .insert(workspaceSessionUserState)
            .values({ sessionId, userId: ctx.authUserId, companyId: ctx.companyId, ...values })
            .onConflictDoUpdate({
                target: [workspaceSessionUserState.sessionId, workspaceSessionUserState.userId],
                set: values,
            });

        return {
            pinned: pinnedAt !== null,
            pinRank,
            archived: archivedAt !== null,
            lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
        };
    });
}

/**
 * Rewrite the caller's pin order: `ids` first, in that order, then any other
 * chat they have pinned in its old order. Ids that aren't pinned (or aren't
 * theirs to organise) are ignored. Returns the resulting order.
 */
export async function reorderPins(
    ctx: WorkspaceContext,
    ids: readonly string[]
): Promise<string[]> {
    return db.transaction(async tx => {
        const rows = await tx
            .select({ sessionId: workspaceSessionUserState.sessionId })
            .from(workspaceSessionUserState)
            .where(and(mine(ctx), isNotNull(workspaceSessionUserState.pinnedAt)))
            .orderBy(
                asc(workspaceSessionUserState.pinRank),
                asc(workspaceSessionUserState.pinnedAt)
            )
            .for("update");
        const pinned = new Set(rows.map(r => r.sessionId));
        const listed = [...new Set(ids)].filter(id => pinned.has(id));
        const placed = new Set(listed);
        const order = [...listed, ...rows.map(r => r.sessionId).filter(id => !placed.has(id))];
        const now = new Date();
        for (const [index, sessionId] of order.entries()) {
            await tx
                .update(workspaceSessionUserState)
                .set({ pinRank: index, updatedAt: now })
                .where(and(mine(ctx), eq(workspaceSessionUserState.sessionId, sessionId)));
        }
        return order;
    });
}
