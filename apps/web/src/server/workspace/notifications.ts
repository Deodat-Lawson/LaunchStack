/**
 * The inbox — "Ada shared Q3 plan with you" (ADR-014).
 *
 * Written in the transaction that adds the grant, one row per person it
 * reaches: a person directly, or every member of a group. Role- and
 * workspace-wide shares notify nobody (they reach too many people to be news;
 * the item simply appears). The person doing the sharing is never notified.
 *
 * Reading filters to what the reader can still open, so an item shared and
 * then unshared does not linger as a dead link.
 */

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import {
    users,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceNotifications,
    type WorkspaceNotificationRow,
} from "~/server/db/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { readableSessionIds } from "~/server/sessions/access";

import type { Executor } from "./db-types";

export type NotificationTargetType = "document" | "folder" | "chat";

export interface SharePrincipal {
    principalType: string;
    principalId: string;
}

export interface ShareNotificationInput {
    companyId: bigint;
    /** Auth subject id of the person sharing. */
    actorUserId: string;
    targetType: NotificationTargetType;
    targetId: string | number | bigint;
    targetLabel: string;
    /** For a folder: its path, so the inbox can open it. */
    targetPath?: string | null;
    level: string;
    /** The grants just added. */
    principals: readonly SharePrincipal[];
}

/** Auth ids of the people a set of new grants reaches, and how each was reached. */
async function recipientsFor(
    executor: Executor,
    companyId: bigint,
    principals: readonly SharePrincipal[]
): Promise<Map<string, { via: "direct" | "group"; groupName?: string }>> {
    const out = new Map<string, { via: "direct" | "group"; groupName?: string }>();
    const userPks = principals
        .filter(p => p.principalType === "user" && /^\d+$/.test(p.principalId))
        .map(p => Number(p.principalId));
    const groupIds = principals
        .filter(p => p.principalType === "group" && /^\d+$/.test(p.principalId))
        .map(p => Number(p.principalId));

    if (userPks.length > 0) {
        const rows = await executor
            .select({ authUserId: users.userId })
            .from(users)
            .where(inArray(users.id, userPks));
        for (const row of rows) out.set(row.authUserId, { via: "direct" });
    }
    if (groupIds.length > 0) {
        const rows = await executor
            .select({ authUserId: users.userId, groupName: workspaceGroups.name })
            .from(workspaceGroupMembers)
            .innerJoin(workspaceGroups, eq(workspaceGroups.id, workspaceGroupMembers.groupId))
            .innerJoin(users, eq(users.id, workspaceGroupMembers.userId))
            .where(
                and(
                    eq(workspaceGroups.companyId, companyId),
                    inArray(
                        workspaceGroupMembers.groupId,
                        groupIds.map(id => BigInt(id))
                    )
                )
            );
        for (const row of rows) {
            if (!out.has(row.authUserId)) {
                out.set(row.authUserId, { via: "group", groupName: row.groupName });
            }
        }
    }
    return out;
}

/** Tell everyone the new grants reach. Returns how many were told. */
export async function notifyShared(
    executor: Executor,
    input: ShareNotificationInput
): Promise<number> {
    if (input.principals.length === 0) return 0;
    const recipients = await recipientsFor(executor, input.companyId, input.principals);
    recipients.delete(input.actorUserId);
    if (recipients.size === 0) return 0;
    await executor.insert(workspaceNotifications).values(
        [...recipients.entries()].map(([recipient, how]) => ({
            companyId: input.companyId,
            recipientUserId: recipient,
            actorUserId: input.actorUserId,
            kind: "shared",
            targetType: input.targetType,
            targetId: String(input.targetId),
            targetLabel: input.targetLabel.slice(0, 300),
            detail: {
                level: input.level,
                via: how.via,
                ...(input.targetPath ? { path: input.targetPath } : {}),
                ...(how.groupName ? { groupName: how.groupName } : {}),
            },
        }))
    );
    return recipients.size;
}

export interface NotificationEntry {
    id: number;
    kind: string;
    actorUserId: string;
    targetType: NotificationTargetType;
    targetId: string;
    targetLabel: string;
    detail: Record<string, unknown> | null;
    at: string;
    read: boolean;
}

function toEntry(row: WorkspaceNotificationRow): NotificationEntry {
    return {
        id: Number(row.id),
        kind: row.kind,
        actorUserId: row.actorUserId,
        targetType: row.targetType as NotificationTargetType,
        targetId: row.targetId,
        targetLabel: row.targetLabel,
        detail: row.detail ?? null,
        at: row.createdAt.toISOString(),
        read: row.readAt !== null,
    };
}

async function keepOpenable(
    ctx: WorkspaceContext,
    entries: readonly NotificationEntry[]
): Promise<NotificationEntry[]> {
    const scope = await ctx.documentScope();
    const docIds = entries
        .filter(e => e.targetType === "document" && /^\d+$/.test(e.targetId))
        .map(e => Number(e.targetId));
    const folderIds = entries
        .filter(e => e.targetType === "folder" && /^\d+$/.test(e.targetId))
        .map(e => Number(e.targetId));
    const chatIds = entries.filter(e => e.targetType === "chat").map(e => e.targetId);

    const [docs, folders, chats] = await Promise.all([
        docIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: document.id })
                  .from(document)
                  .where(
                      and(scopedDocumentWhere(ctx.companyId, scope), inArray(document.id, docIds))
                  ),
        folderIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: category.id, name: category.name })
                  .from(category)
                  .where(
                      and(eq(category.companyId, ctx.companyId), inArray(category.id, folderIds))
                  ),
        readableSessionIds(ctx, chatIds),
    ]);
    const openDocs = new Set(docs.map(d => String(d.id)));
    const openFolders = new Set(
        folders.filter(f => scopeAllowsCategory(scope, f.name)).map(f => String(f.id))
    );
    return entries.filter(e =>
        e.targetType === "document"
            ? openDocs.has(e.targetId)
            : e.targetType === "folder"
              ? openFolders.has(e.targetId)
              : chats.has(e.targetId)
    );
}

export async function listNotifications(
    ctx: WorkspaceContext,
    options: { limit?: number } = {}
): Promise<{ entries: NotificationEntry[]; unread: number }> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const mine = and(
        eq(workspaceNotifications.companyId, ctx.companyId),
        eq(workspaceNotifications.recipientUserId, ctx.authUserId)
    );
    const rows = await db
        .select()
        .from(workspaceNotifications)
        .where(mine)
        .orderBy(desc(workspaceNotifications.id))
        .limit(limit);
    const entries = await keepOpenable(ctx, rows.map(toEntry));
    const [unreadRow] = await db
        .select({ n: count() })
        .from(workspaceNotifications)
        .where(and(mine, isNull(workspaceNotifications.readAt)));
    // The badge counts only what the list can show.
    const hidden = rows.filter(r => r.readAt === null).length - entries.filter(e => !e.read).length;
    return { entries, unread: Math.max(0, Number(unreadRow?.n ?? 0) - hidden) };
}

/** Mark some (or, with no ids, all) of the caller's notifications read. */
export async function markNotificationsRead(
    ctx: WorkspaceContext,
    ids?: readonly number[]
): Promise<void> {
    await db
        .update(workspaceNotifications)
        .set({ readAt: new Date() })
        .where(
            and(
                eq(workspaceNotifications.companyId, ctx.companyId),
                eq(workspaceNotifications.recipientUserId, ctx.authUserId),
                isNull(workspaceNotifications.readAt),
                ids && ids.length > 0 ? inArray(workspaceNotifications.id, [...ids]) : undefined
            )
        );
}
