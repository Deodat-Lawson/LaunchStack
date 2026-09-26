/**
 * The folder a member's mailbox lands in, and why nobody else sees it.
 *
 * `Gmail` (the root) is restricted with no grants — invisible to every
 * member, so nobody gets an empty folder they cannot open. `Gmail/<address>`
 * is restricted with one `manage` grant to the owner. Under ADR-010 the
 * nearest restricted ancestor decides, so the owner sees their own folder
 * and no one else's; documents inside inherit the folder's audience, and the
 * post-retrieval gate keeps the assistant from quoting a mailbox to anyone
 * but its owner.
 *
 * Holders of `folders.manage` (Owners, Admins) see every restricted folder,
 * this one included — the same rule as a Finance folder. That is the
 * model's stated design, not an oversight; a tighter "private even from
 * admins" tier would be a change to `DocumentScope`, not to this file.
 *
 * Idempotent: called on connect (so the folder shows up immediately) and at
 * the start of every sync (so a manually un-restricted folder is restricted
 * again before more mail lands in it).
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { folderGrants, folderSettings } from "~/server/db/schema";
import { createFolder } from "~/server/folders";

import { GMAIL_ROOT_FOLDER, gmailFolderFor } from "./config";

export interface GmailFolderOwner {
    readonly companyId: bigint;
    readonly ownerUserPk: bigint;
    /** Auth subject id — what `folder_settings.updated_by` and `folder_grants.granted_by` record. */
    readonly ownerAuthUserId: string;
    readonly accountEmail: string;
}

async function categoryIdFor(companyId: bigint, path: string): Promise<bigint | null> {
    const [row] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, path)))
        .limit(1);
    return row ? BigInt(row.id) : null;
}

async function restrictFolder(
    companyId: bigint,
    categoryId: bigint,
    updatedBy: string
): Promise<void> {
    await db
        .insert(folderSettings)
        .values({ categoryId, companyId, visibility: "restricted", updatedBy })
        .onConflictDoNothing({ target: folderSettings.categoryId });
}

export async function ensurePrivateGmailFolder(owner: GmailFolderOwner): Promise<{ path: string }> {
    const path = gmailFolderFor(owner.accountEmail);
    await createFolder(owner.companyId, path);

    const [rootId, folderId] = await Promise.all([
        categoryIdFor(owner.companyId, GMAIL_ROOT_FOLDER),
        categoryIdFor(owner.companyId, path),
    ]);
    if (!rootId || !folderId) {
        throw new Error(`Gmail folder rows are missing after creation (${path})`);
    }

    await restrictFolder(owner.companyId, rootId, owner.ownerAuthUserId);
    await restrictFolder(owner.companyId, folderId, owner.ownerAuthUserId);
    await db
        .insert(folderGrants)
        .values({
            companyId: owner.companyId,
            categoryId: folderId,
            principalType: "user",
            principalId: owner.ownerUserPk.toString(),
            level: "manage",
            grantedBy: owner.ownerAuthUserId,
        })
        .onConflictDoNothing({
            target: [folderGrants.categoryId, folderGrants.principalType, folderGrants.principalId],
        });

    return { path };
}
