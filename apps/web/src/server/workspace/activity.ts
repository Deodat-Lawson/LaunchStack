/**
 * The team's activity feed — who added, filed, renamed, shared or deleted what
 * (ADR-014). Written in the same transaction as the change, read by everyone,
 * filtered to what the reader can see *now*: a row about a file you can't open
 * is not shown, so the feed never leaks a private file's name.
 */

import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { workspaceActivity, type WorkspaceActivityRow } from "~/server/db/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { readableSessionIds } from "~/server/sessions/access";

import type { Executor } from "./db-types";

export const ACTIVITY_VERBS = [
    "added",
    "created_folder",
    "renamed",
    "moved",
    "deleted",
    "shared",
    "unshared",
    "forked",
    "created_group",
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

export type ActivityTargetType = "document" | "folder" | "chat" | "group";

export interface ActivityInput {
    companyId: bigint;
    /** Auth subject id of the person who did it. */
    actorUserId: string;
    verb: ActivityVerb;
    targetType: ActivityTargetType;
    targetId?: string | number | bigint | null;
    targetLabel: string;
    /** A folder's path, or the folder a document is in. */
    targetPath?: string | null;
    detail?: Record<string, unknown>;
}

export async function recordActivity(executor: Executor, input: ActivityInput): Promise<void> {
    await executor.insert(workspaceActivity).values({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        verb: input.verb,
        targetType: input.targetType,
        targetId: input.targetId == null ? null : String(input.targetId),
        targetLabel: input.targetLabel.slice(0, 300),
        targetPath: input.targetPath ?? null,
        detail: input.detail ?? null,
    });
}

export interface ActivityEntry {
    id: number;
    /** Auth subject id — resolve with `usePeople`. */
    actorUserId: string;
    verb: ActivityVerb;
    targetType: ActivityTargetType;
    targetId: string | null;
    targetLabel: string;
    targetPath: string | null;
    detail: Record<string, unknown> | null;
    at: string;
}

function toEntry(row: WorkspaceActivityRow): ActivityEntry {
    return {
        id: Number(row.id),
        actorUserId: row.actorUserId,
        verb: row.verb as ActivityVerb,
        targetType: row.targetType as ActivityTargetType,
        targetId: row.targetId,
        targetLabel: row.targetLabel,
        targetPath: row.targetPath,
        detail: row.detail ?? null,
        at: row.createdAt.toISOString(),
    };
}

/**
 * Keep only the rows the reader may see today:
 * - documents still in their scope; a deleted document only to whoever deleted
 *   it, or to everyone when it was workspace-wide (`detail.wasWorkspace`);
 * - folders whose path is in their scope; a deleted one likewise;
 * - chats they own or that are shared with them;
 * - groups, which every member can see.
 */
export async function filterVisibleActivity(
    ctx: WorkspaceContext,
    rows: readonly ActivityEntry[]
): Promise<ActivityEntry[]> {
    const scope = await ctx.documentScope();
    const docIds = [
        ...new Set(
            rows
                .filter(r => r.targetType === "document" && r.targetId && /^\d+$/.test(r.targetId))
                .map(r => Number(r.targetId))
        ),
    ];
    const chatIds = rows.filter(r => r.targetType === "chat" && r.targetId).map(r => r.targetId!);

    const [visibleDocs, existingDocs, readableChats] = await Promise.all([
        docIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: document.id })
                  .from(document)
                  .where(
                      and(scopedDocumentWhere(ctx.companyId, scope), inArray(document.id, docIds))
                  ),
        docIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: document.id })
                  .from(document)
                  .where(and(eq(document.companyId, ctx.companyId), inArray(document.id, docIds))),
        readableSessionIds(ctx, chatIds),
    ]);
    const visible = new Set(visibleDocs.map(d => Number(d.id)));
    const exists = new Set(existingDocs.map(d => Number(d.id)));

    return rows.filter(row => {
        switch (row.targetType) {
            case "document": {
                const id = Number(row.targetId);
                if (exists.has(id)) return visible.has(id);
                return row.actorUserId === ctx.authUserId || row.detail?.wasWorkspace === true;
            }
            case "folder":
                // A deleted folder has no access rows left to check: teammates
                // see it only if it was workspace-wide when it went.
                if (row.verb === "deleted") {
                    return row.actorUserId === ctx.authUserId || row.detail?.wasWorkspace === true;
                }
                return row.targetPath ? scopeAllowsCategory(scope, row.targetPath) : false;
            case "chat":
                return row.targetId ? readableChats.has(row.targetId) : false;
            case "group":
                return true;
            default:
                return false;
        }
    });
}

/**
 * Newest first. Reads in pages of `limit * 3` until it has `limit` visible
 * rows or runs out, so heavy private activity doesn't leave the feed empty.
 */
export async function listActivity(
    ctx: WorkspaceContext,
    options: { limit?: number; before?: number; actorUserId?: string } = {}
): Promise<{ entries: ActivityEntry[]; nextBefore: number | null }> {
    const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
    const out: ActivityEntry[] = [];
    let cursor = options.before;
    for (let page = 0; page < 5 && out.length < limit; page++) {
        const rows = await db
            .select()
            .from(workspaceActivity)
            .where(
                and(
                    eq(workspaceActivity.companyId, ctx.companyId),
                    cursor ? lt(workspaceActivity.id, cursor) : undefined,
                    options.actorUserId
                        ? eq(workspaceActivity.actorUserId, options.actorUserId)
                        : undefined
                )
            )
            .orderBy(desc(workspaceActivity.id))
            .limit(limit * 3);
        if (rows.length === 0) {
            cursor = undefined;
            break;
        }
        out.push(...(await filterVisibleActivity(ctx, rows.map(toEntry))));
        cursor = Number(rows[rows.length - 1]!.id);
        if (rows.length < limit * 3) {
            cursor = undefined;
            break;
        }
    }
    const entries = out.slice(0, limit);
    const nextBefore = out.length > limit ? entries[entries.length - 1]!.id : (cursor ?? null);
    return { entries, nextBefore };
}
