/**
 * The Team tab's Activity view (ADR-014 §7): `listActivity`, plus whether
 * each row's target can still be opened.
 *
 * `listActivity` already drops rows the reader may not see. What it can't say
 * is whether the thing is still there to click: a file renamed twice is still
 * the same file, but a folder renamed since keeps its old path in old rows,
 * and anything deleted is gone. A row that can't be opened reads as plain
 * text instead of a link that goes nowhere.
 */

import { and, eq, inArray } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { workspaceGroups } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

import { listActivity, type ActivityEntry } from "../activity";

export interface FeedEntry extends ActivityEntry {
    /** The target still exists where the row points, so the row can open it. */
    openable: boolean;
}

export interface ActivityFeed {
    entries: FeedEntry[];
    nextBefore: number | null;
}

function numericIds(
    entries: readonly ActivityEntry[],
    type: ActivityEntry["targetType"]
): number[] {
    return [
        ...new Set(
            entries
                .filter(e => e.targetType === type && e.targetId && /^\d+$/.test(e.targetId))
                .map(e => Number(e.targetId))
        ),
    ];
}

export async function annotateOpenable(
    ctx: WorkspaceContext,
    entries: readonly ActivityEntry[]
): Promise<FeedEntry[]> {
    const live = entries.filter(e => e.verb !== "deleted");
    const docIds = numericIds(live, "document");
    const groupIds = numericIds(live, "group");
    const folderPaths = [
        ...new Set(
            live.filter(e => e.targetType === "folder" && e.targetPath).map(e => e.targetPath!)
        ),
    ];

    const [docs, groups, folders] = await Promise.all([
        docIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: document.id })
                  .from(document)
                  .where(and(eq(document.companyId, ctx.companyId), inArray(document.id, docIds))),
        groupIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: workspaceGroups.id })
                  .from(workspaceGroups)
                  .where(
                      and(
                          eq(workspaceGroups.companyId, ctx.companyId),
                          inArray(workspaceGroups.id, groupIds)
                      )
                  ),
        folderPaths.length === 0
            ? Promise.resolve([])
            : db
                  .select({ name: category.name })
                  .from(category)
                  .where(
                      and(
                          eq(category.companyId, ctx.companyId),
                          inArray(category.name, folderPaths)
                      )
                  ),
    ]);
    const liveDocs = new Set(docs.map(d => String(d.id)));
    const liveGroups = new Set(groups.map(g => String(g.id)));
    const liveFolders = new Set(folders.map(f => f.name));

    return entries.map(entry => {
        let openable = false;
        if (entry.verb !== "deleted") {
            switch (entry.targetType) {
                case "document":
                    openable = entry.targetId !== null && liveDocs.has(entry.targetId);
                    break;
                case "folder":
                    openable = entry.targetPath !== null && liveFolders.has(entry.targetPath);
                    break;
                case "chat":
                    // `listActivity` keeps a chat row only while the reader can open it.
                    openable = entry.targetId !== null;
                    break;
                case "group":
                    openable = entry.targetId !== null && liveGroups.has(entry.targetId);
                    break;
            }
        }
        return { ...entry, openable };
    });
}

export async function activityFeed(
    ctx: WorkspaceContext,
    options: { limit?: number; before?: number; actorUserId?: string } = {}
): Promise<ActivityFeed> {
    const page = await listActivity(ctx, options);
    return { entries: await annotateOpenable(ctx, page.entries), nextBefore: page.nextBefore };
}
