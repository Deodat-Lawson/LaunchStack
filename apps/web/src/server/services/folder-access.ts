/**
 * Folder-level write access, and the category rows connectors write into.
 *
 * A folder is an engine `category` row. Who may put documents into it is the
 * edit level `~/server/workspace/item-access` resolves: a workspace-wide
 * folder takes edit from the caller's role (`documents.upload`), a restricted
 * one only from a grant at `edit` or above on the folder or a folder between
 * it and its nearest restricted ancestor. No role reaches past a restriction
 * (ADR-014).
 *
 * Read access is `DocumentScope`'s job (`~/lib/authz/scope`); this module is
 * only about who may add or move documents into a folder.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { canEditFolderPath } from "~/server/workspace/item-access";

/** The slice of a workspace context the folder check needs. */
export type FolderActor = Pick<WorkspaceContext, "companyId" | "userPk" | "role" | "permissions">;

/** The 403 body every upload path returns when a restricted folder refuses. */
export const FOLDER_EDIT_DENIED = "You do not have edit access to this folder.";

/**
 * The 403 body for renaming, moving, replacing or deleting a file the caller
 * can open but holds no edit level on (ADR-014's `canEditDocument`).
 */
export const DOCUMENT_EDIT_DENIED = "You can view this file but not change it.";

/** May `ctx` add documents to the folder named `categoryName`? */
export async function canEditFolder(ctx: FolderActor, categoryName: string): Promise<boolean> {
    return canEditFolderPath(ctx, categoryName);
}

/**
 * Make sure a `category` row exists for a folder name so it can later be
 * restricted. Connector sinks name their folder in code and used to write
 * documents into it without ever creating the row; a folder that is only a
 * string on the document has nothing for `folder_settings` to point at.
 *
 * Select-then-insert: the category table has no (company, name) unique
 * index, so a racing pair of syncs may create two rows — harmless, and the
 * common case is a single row that already exists.
 */
export async function ensureCategoryRow(companyId: bigint, name: string): Promise<void> {
    const [existing] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, name)))
        .limit(1);
    if (existing) return;
    await db.insert(category).values({ name, companyId });
}
