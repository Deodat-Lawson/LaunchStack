/**
 * The folder a member's Outlook mailbox lands in, and why nobody else sees
 * it. The Gmail model exactly (`../gmail/folder.ts`):
 *
 * `Outlook` (the root) is restricted with no grants, so nobody gets an empty
 * folder they cannot open. `Outlook/<address>` is restricted with one
 * `manage` grant to the owner. The nearest restricted ancestor decides
 * (ADR-010), so the owner sees their own folder and no one else's, and since
 * ADR-014 nobody reads past a restriction by role. It is never handed on:
 * when its owner is removed or leaves, the mail still in it is deleted with
 * their connection (`../personal-connections.ts`).
 *
 * Idempotent: called on connect (so the folder shows up at once) and at the
 * start of every sync (so a folder someone un-restricted by hand is
 * restricted again before more mail lands in it).
 *
 * Not `claimPrivateFolder`: that helper gives a taken name " (2)" and leaves
 * an existing root as it found it, which is right for Notion and wrong for a
 * mailbox, whose folder is the address and whose root must stay closed.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { folderGrants, folderSettings } from "~/server/db/schema";
import { createFolder } from "~/server/folders";

import { OUTLOOK_ROOT_FOLDER, outlookFolderFor } from "./config";

export interface OutlookFolderOwner {
    readonly companyId: bigint;
    readonly ownerUserPk: bigint;
    /** Auth subject id: what `folder_settings.updated_by` and `folder_grants.granted_by` record. */
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

export async function ensurePrivateOutlookFolder(
    owner: OutlookFolderOwner
): Promise<{ path: string }> {
    const path = outlookFolderFor(owner.accountEmail);
    await createFolder(owner.companyId, path);

    const [rootId, folderId] = await Promise.all([
        categoryIdFor(owner.companyId, OUTLOOK_ROOT_FOLDER),
        categoryIdFor(owner.companyId, path),
    ]);
    if (!rootId || !folderId) {
        throw new Error(`Outlook folder rows are missing after creation (${path})`);
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
