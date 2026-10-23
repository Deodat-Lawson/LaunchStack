/**
 * The folder a Notion connection's pages land in.
 *
 * `Notion/<workspace>` is created the way a person creating it by hand would
 * (ADR-014): a new top-level folder is private to whoever connected Notion,
 * and they get a manage grant on every folder this adds, so they decide who
 * else sees the pages. The folder's id is remembered on the sync state, so a
 * rename or move in LaunchStack is followed rather than undone.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { createFolder } from "~/server/folders";
import { applyFolderCreationDefaults, type OwnerRef } from "~/server/workspace/ownership";

import { notionFolderFor } from "./config";

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

async function categoryIdFor(companyId: bigint, path: string): Promise<number | null> {
    const [row] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, path)))
        .limit(1);
    return row ? Number(row.id) : null;
}

export async function ensureNotionFolder(params: {
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

    const { path } = await createFolder(
        owner.companyId,
        notionFolderFor(params.workspaceName),
        async (tx, created) => applyFolderCreationDefaults(tx, owner, created)
    );
    const categoryId = await categoryIdFor(owner.companyId, path);
    if (categoryId == null)
        throw new Error(`Notion folder row is missing after creation (${path})`);
    return { path, categoryId };
}
