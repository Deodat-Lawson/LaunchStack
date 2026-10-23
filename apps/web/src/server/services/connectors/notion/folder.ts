/**
 * The folder a Notion connection's pages land in.
 *
 * Each connection gets `Notion/<workspace>` of its own, private to whoever
 * connected it with a manage grant so they decide who else sees the pages
 * (see ../private-folder.ts). Two connections whose workspace names clean to
 * the same path never share a folder: the second gets `(2)`.
 *
 * The folder's id is remembered on the sync state, so a rename or move in
 * LaunchStack is followed rather than undone. A connection re-authorized by
 * another admin is the same Notion account (the grant is keyed on its
 * bot id), so its folder is kept and the new admin is granted access to it.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import type { OwnerRef } from "~/server/workspace/ownership";

import { claimPrivateFolder, grantManage } from "../private-folder";
import { NOTION_ROOT_FOLDER } from "./config";

export interface NotionFolder {
    readonly path: string;
    readonly categoryId: number;
}

async function categoryById(companyId: bigint, id: number): Promise<string | null> {
    const [row] = await db
        .select({ name: category.name })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.id, id)))
        .limit(1);
    return row?.name ?? null;
}

export async function ensureNotionFolder(params: {
    /** Whoever connected (or last re-authorized) Notion. */
    readonly owner: OwnerRef;
    readonly workspaceName: string | null;
    /** Where the last run put pages; followed if it still exists. */
    readonly rememberedCategoryId: number | null;
}): Promise<NotionFolder> {
    const { owner } = params;
    if (params.rememberedCategoryId != null) {
        const current = await categoryById(owner.companyId, params.rememberedCategoryId);
        if (current) {
            // Idempotent; only adds something when another admin re-authorized.
            await grantManage(owner, BigInt(params.rememberedCategoryId));
            return { path: current, categoryId: params.rememberedCategoryId };
        }
    }

    // No reuse: an existing folder of this name is another connection's.
    const folder = await claimPrivateFolder({
        owner,
        root: NOTION_ROOT_FOLDER,
        name: params.workspaceName ?? "",
        fallback: "Workspace",
    });
    return { path: folder.path, categoryId: Number(folder.categoryId) };
}
