/**
 * A folder one person's connector content lands in, private to them: the
 * Gmail model (gmail/folder.ts), shared by the Notion and Obsidian
 * connectors.
 *
 * `<Root>/<name>` is restricted with a `manage` grant for its owner, who can
 * share it when they choose. Under ADR-010 the nearest restricted ancestor
 * decides, so the owner sees their folder and nobody else does, whatever the
 * root's own audience is. A root created here is restricted with no grants,
 * so no one sees an empty folder they cannot open; a root that already
 * existed (someone's own "Notion" folder, say) is left as it was.
 *
 * Every claim is a folder nobody else is using: a name that is taken gets
 * " (2)", " (3)"… instead of mixing two people's content in one folder.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { FOLDER_SEPARATOR, MAX_FOLDER_NAME_CHARS } from "~/lib/folders/path";
import { db } from "~/server/db";
import { folderGrants, folderSettings } from "~/server/db/schema";
import { createFolder } from "~/server/folders";
import type { OwnerRef } from "~/server/workspace/ownership";

/** Tries before giving up on a free `<Root>/<name> (n)`. */
const MAX_NAME_ATTEMPTS = 50;

/** One folder-name segment that always passes the folder rules. */
export function cleanFolderSegment(raw: string, fallback: string): string {
    const segment = raw
        .replace(/\//g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_FOLDER_NAME_CHARS)
        .trim();
    return segment || fallback;
}

/** `<Root>/<name>`, or `<Root>/<name> (n)` for the nth attempt, within the folder rules. */
export function privateFolderPath(
    root: string,
    rawName: string,
    fallback: string,
    attempt = 1
): string {
    const base = cleanFolderSegment(rawName, fallback);
    const name =
        attempt === 1
            ? base
            : `${base.slice(0, MAX_FOLDER_NAME_CHARS - ` (${attempt})`.length)} (${attempt})`;
    return `${root}${FOLDER_SEPARATOR}${name}`;
}

export async function categoryIdFor(companyId: bigint, path: string): Promise<bigint | null> {
    const [row] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, path)))
        .limit(1);
    return row ? BigInt(row.id) : null;
}

export async function hasManageGrant(categoryId: bigint, userPk: bigint): Promise<boolean> {
    const [row] = await db
        .select({ id: folderGrants.id })
        .from(folderGrants)
        .where(
            and(
                eq(folderGrants.categoryId, categoryId),
                eq(folderGrants.principalType, "user"),
                eq(folderGrants.principalId, userPk.toString()),
                eq(folderGrants.level, "manage")
            )
        )
        .limit(1);
    return Boolean(row);
}

/** Idempotent: a manage grant on the folder for this person. */
export async function grantManage(owner: OwnerRef, categoryId: bigint): Promise<void> {
    await db
        .insert(folderGrants)
        .values({
            companyId: owner.companyId,
            categoryId,
            principalType: "user",
            principalId: owner.userPk.toString(),
            level: "manage",
            grantedBy: owner.authUserId,
        })
        .onConflictDoNothing({
            target: [folderGrants.categoryId, folderGrants.principalType, folderGrants.principalId],
        });
}

async function restrictFolder(companyId: bigint, categoryId: bigint, updatedBy: string) {
    await db
        .insert(folderSettings)
        .values({ categoryId, companyId, visibility: "restricted", updatedBy })
        .onConflictDoNothing({ target: folderSettings.categoryId });
}

export interface PrivateFolder {
    readonly path: string;
    readonly categoryId: bigint;
}

/**
 * Claim `<root>/<name>` (or the first free `(n)` variant) for `owner`. An
 * existing folder is taken only when `reuse` says it is this owner's — an
 * Obsidian vault re-imported by its importer; Notion passes none, so every
 * connection gets a folder of its own.
 */
export async function claimPrivateFolder(params: {
    readonly owner: OwnerRef;
    readonly root: string;
    readonly name: string;
    /** Used when `name` cleans down to nothing. */
    readonly fallback: string;
    readonly reuse?: (categoryId: bigint) => Promise<boolean>;
}): Promise<PrivateFolder> {
    const { owner, root } = params;
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
        const path = privateFolderPath(root, params.name, params.fallback, attempt);
        const existing = await categoryIdFor(owner.companyId, path);
        if (existing != null) {
            if (params.reuse && (await params.reuse(existing))) {
                return { path, categoryId: existing };
            }
            continue; // someone else's
        }

        const { created } = await createFolder(owner.companyId, path);
        const categoryId = await categoryIdFor(owner.companyId, path);
        if (categoryId == null) throw new Error(`Folder row is missing after creation (${path})`);
        // Created a moment ago by someone else: theirs, not ours.
        if (!created.includes(path)) {
            if (params.reuse && (await params.reuse(categoryId))) return { path, categoryId };
            continue;
        }
        if (created.includes(root)) {
            const rootId = await categoryIdFor(owner.companyId, root);
            if (rootId != null) await restrictFolder(owner.companyId, rootId, owner.authUserId);
        }
        await restrictFolder(owner.companyId, categoryId, owner.authUserId);
        await grantManage(owner, categoryId);
        return { path, categoryId };
    }
    throw new Error(`No free folder name under ${root} for "${params.name}"`);
}
