/**
 * Folder-level write access, and the category rows connectors write into.
 *
 * A folder is an engine `category` row. One with a `folder_settings` row is
 * restricted: only people holding `folders.manage`, or a `folder_grants` row
 * at `edit` or above whose principal reaches them (as a user, through one of
 * their groups, or through their role), may put documents into it. A folder
 * with no settings row is workspace-visible and any `documents.upload`
 * holder may write to it.
 *
 * Read access is `DocumentScope`'s job (`~/lib/authz/scope`); this module is
 * only about who may add or move documents into a folder.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { folderGrants, folderSettings, workspaceGroupMembers } from "~/server/db/schema";
import { grantLevelAtLeast, isGrantLevel, normalizeRoleSlug } from "~/lib/authz/permissions";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

/** The slice of a workspace context the folder check needs. */
export type FolderActor = Pick<WorkspaceContext, "companyId" | "userPk" | "role" | "can">;

/** The 403 body every upload path returns when a restricted folder refuses. */
export const FOLDER_EDIT_DENIED = "You do not have edit access to this folder.";

/**
 * May `ctx` add documents to the folder named `categoryName`?
 *
 * Costs nothing for a `folders.manage` holder; one indexed read for anyone
 * else when the folder is open; up to three when it is restricted.
 */
export async function canEditFolder(ctx: FolderActor, categoryName: string): Promise<boolean> {
    if (ctx.can("folders.manage")) return true;

    const [restricted] = await db
        .select({ categoryId: folderSettings.categoryId })
        .from(folderSettings)
        .innerJoin(category, eq(category.id, folderSettings.categoryId))
        .where(
            and(
                eq(category.companyId, ctx.companyId),
                eq(category.name, categoryName),
                eq(folderSettings.visibility, "restricted")
            )
        )
        .limit(1);
    if (!restricted) return true;

    const grants = await db
        .select({
            principalType: folderGrants.principalType,
            principalId: folderGrants.principalId,
            level: folderGrants.level,
        })
        .from(folderGrants)
        .where(
            and(
                eq(folderGrants.companyId, ctx.companyId),
                eq(folderGrants.categoryId, restricted.categoryId)
            )
        );

    const editGrants = grants.filter(
        grant => isGrantLevel(grant.level) && grantLevelAtLeast(grant.level, "edit")
    );
    if (editGrants.length === 0) return false;

    const userPk = ctx.userPk.toString();
    const role = normalizeRoleSlug(ctx.role);
    for (const grant of editGrants) {
        if (grant.principalType === "user" && grant.principalId === userPk) return true;
        if (grant.principalType === "role" && normalizeRoleSlug(grant.principalId) === role) {
            return true;
        }
    }

    const groupGrantIds = editGrants
        .filter(grant => grant.principalType === "group")
        .map(grant => grant.principalId);
    if (groupGrantIds.length === 0) return false;

    const memberships = await db
        .select({ groupId: workspaceGroupMembers.groupId })
        .from(workspaceGroupMembers)
        .where(eq(workspaceGroupMembers.userId, ctx.userPk));
    const memberGroupIds = new Set(memberships.map(row => row.groupId.toString()));
    return groupGrantIds.some(id => memberGroupIds.has(id));
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
