/**
 * The folder a Notion connection's pages land in.
 *
 * Notion connections are per-user, and each gets `Notion/<workspace>` of its
 * own, private to the member who connected it with a manage grant so they
 * decide who else sees the pages (see ../private-folder.ts). Two connections
 * whose workspace names clean to the same path never share a folder — two
 * members connecting the same Notion workspace each get their own copy, and
 * the second folder is `(2)`.
 *
 * The folder's id is remembered on the sync state, so a rename or move in
 * LaunchStack is followed rather than undone.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import type { OwnerRef } from "~/server/workspace/ownership";

import { claimPrivateFolder } from "../private-folder";
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
    /** The member the connection belongs to. */
    readonly owner: OwnerRef;
    readonly workspaceName: string | null;
    /** Where the last run put pages; followed if it still exists. */
    readonly rememberedCategoryId: number | null;
}): Promise<NotionFolder> {
    const { owner } = params;
    if (params.rememberedCategoryId != null) {
        const current = await categoryById(owner.companyId, params.rememberedCategoryId);
        if (current) return { path: current, categoryId: params.rememberedCategoryId };
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
