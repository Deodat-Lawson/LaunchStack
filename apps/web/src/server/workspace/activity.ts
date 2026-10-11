/**
 * The team's activity feed — who added, filed, renamed, shared or deleted what
 * (ADR-014). Written in the same transaction as the change, read by everyone,
 * filtered to what the reader can see *now*: a row about a file you can't open
 * is not shown, so the feed never leaks a private file's name.
 */

import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { workspaceActivity, type WorkspaceActivityRow } from "~/server/db/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { listFolders } from "~/server/folders";
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
    const folderIds = [
        ...new Set(
            rows
                .filter(r => r.targetType === "folder" && r.targetId && /^\d+$/.test(r.targetId))
                .map(r => Number(r.targetId))
        ),
    ];
    // Rows written before folder ids were recorded carry only a path.
    const needsPaths = rows.some(
        r =>
            (r.targetType === "folder" && !(r.targetId && /^\d+$/.test(r.targetId))) ||
            (r.targetType === "document" && typeof r.detail?.from === "string")
    );

    const [visibleDocs, existingDocs, readableChats, folderRows, folderPaths] = await Promise.all([
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
        folderIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: category.id, name: category.name })
                  .from(category)
                  .where(
                      and(eq(category.companyId, ctx.companyId), inArray(category.id, folderIds))
                  ),
        needsPaths
            ? listFolders(ctx.companyId).then(list => new Set(list.map(f => f.path)))
            : Promise.resolve(new Set<string>()),
    ]);
    const visible = new Set(visibleDocs.map(d => Number(d.id)));
    const exists = new Set(existingDocs.map(d => Number(d.id)));
    const folderNow = new Map(folderRows.map(f => [Number(f.id), f.name]));
    /** A path the reader can see today: it still exists, and their scope allows it. */
    const seesPath = (path: string) => folderPaths.has(path) && scopeAllowsCategory(scope, path);
    const mine = (row: ActivityEntry) => row.actorUserId === ctx.authUserId;

    const kept = rows.filter(row => {
        switch (row.targetType) {
            case "document": {
                const id = Number(row.targetId);
                if (exists.has(id)) return visible.has(id);
                return mine(row) || row.detail?.wasWorkspace === true;
            }
            case "folder": {
                // Gone: teammates see it only if it was workspace-wide when it went.
                if (row.verb === "deleted") return mine(row) || row.detail?.wasWorkspace === true;
                // By id: the folder as it is now, under whatever name it has now.
                if (row.targetId && /^\d+$/.test(row.targetId)) {
                    const now = folderNow.get(Number(row.targetId));
                    return now !== undefined ? scopeAllowsCategory(scope, now) : mine(row);
                }
                // An older row with only a path: only while that path still
                // exists and is visible — a renamed or deleted private folder's
                // old path must not read as "unrestricted".
                return mine(row) || (row.targetPath !== null && seesPath(row.targetPath));
            }
            case "chat":
                return row.targetId ? readableChats.has(row.targetId) : false;
            case "group":
                return true;
            default:
                return false;
        }
    });

    // A file the reader can open may have come from a folder they can't: keep
    // its old path out of what they read.
    return kept.map(row => {
        if (row.targetType !== "document" || mine(row) || typeof row.detail?.from !== "string") {
            return row;
        }
        if (seesPath(row.detail.from)) return row;
        const detail = { ...row.detail };
        delete detail.from;
        return { ...row, detail };
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
