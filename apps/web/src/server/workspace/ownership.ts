/**
 * Who owns what, and what a new or moved thing starts as (ADR-014).
 *
 * - A new top-level folder is private to its creator: a restricted
 *   `folder_settings` row and one `manage` grant.
 * - A new subfolder inherits its parent; its creator still gets a `manage`
 *   grant, so they can change its access later.
 * - A new loose file (`Unfiled`) is private to its uploader; a new file in a
 *   folder inherits it, and the uploader gets a `manage` grant on it.
 * - A file private only to its mover takes the folder's audience when it is
 *   filed; a file sent to `Unfiled` becomes private to the mover unless it
 *   already has its own audience.
 * - A departing member's sole-managed items pass to an heir; deleting a role
 *   deletes its grants; deleting a folder carries its restriction onto the
 *   documents it re-homes.
 *
 * Every function takes the executor it should write through, so callers keep
 * the default and the change in one transaction.
 */

import { and, eq, inArray, like, or } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import {
    documentGrants,
    documentSettings,
    folderGrants,
    folderSettings,
    userCompanyMemberships,
    workspaceSessionGrants,
} from "~/server/db/schema";
import { grantLevelAtLeast, isGrantLevel } from "~/lib/authz/permissions";
import {
    FOLDER_SEPARATOR,
    folderParentPath,
    isUnfiledFolder,
    normalizeFolderPath,
} from "~/lib/folders/path";

import type { Executor } from "./db-types";
import { loadDocumentFacts, loadFolderLineage } from "./item-access";

/** The person a default is applied for. */
export interface OwnerRef {
    readonly companyId: bigint;
    readonly userPk: bigint;
    readonly authUserId: string;
}

// ---------------------------------------------------------------------------
// Creation defaults
// ---------------------------------------------------------------------------

async function folderIdsByPath(
    executor: Executor,
    companyId: bigint,
    paths: readonly string[]
): Promise<Map<string, bigint>> {
    if (paths.length === 0) return new Map();
    const rows = await executor
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(and(eq(category.companyId, companyId), inArray(category.name, [...paths])));
    const out = new Map<string, bigint>();
    for (const row of rows) {
        const key = normalizeFolderPath(row.name);
        if (!out.has(key)) out.set(key, BigInt(row.id));
    }
    return out;
}

async function grantFolderManage(
    executor: Executor,
    owner: OwnerRef,
    categoryId: bigint
): Promise<void> {
    await executor
        .insert(folderGrants)
        .values({
            companyId: owner.companyId,
            categoryId,
            principalType: "user",
            principalId: owner.userPk.toString(),
            level: "manage",
            grantedBy: owner.authUserId,
        })
        .onConflictDoUpdate({
            target: [folderGrants.categoryId, folderGrants.principalType, folderGrants.principalId],
            set: { level: "manage" },
        });
}

async function grantDocumentManage(
    executor: Executor,
    owner: OwnerRef,
    documentId: bigint
): Promise<void> {
    await executor
        .insert(documentGrants)
        .values({
            companyId: owner.companyId,
            documentId,
            principalType: "user",
            principalId: owner.userPk.toString(),
            level: "manage",
            grantedBy: owner.authUserId,
        })
        .onConflictDoUpdate({
            target: [
                documentGrants.documentId,
                documentGrants.principalType,
                documentGrants.principalId,
            ],
            set: { level: "manage" },
        });
}

async function folderHasDocuments(
    executor: Executor,
    companyId: bigint,
    path: string
): Promise<boolean> {
    const [row] = await executor
        .select({ id: document.id })
        .from(document)
        .where(
            and(
                eq(document.companyId, companyId),
                or(eq(document.category, path), like(document.category, descendantPattern(path)))
            )
        )
        .limit(1);
    return Boolean(row);
}

/**
 * Defaults for folders `createFolder` just inserted (`created` from its
 * result: the path and any ancestors that did not exist). The outermost new
 * folder with no parent above it is made private; every new folder gets a
 * manage grant for its creator.
 */
export async function applyFolderCreationDefaults(
    executor: Executor,
    owner: OwnerRef,
    created: readonly string[]
): Promise<void> {
    if (created.length === 0) return;
    const paths = created.map(normalizeFolderPath);
    const ids = await folderIdsByPath(executor, owner.companyId, paths);
    for (const path of paths) {
        const id = ids.get(path);
        if (id === undefined) continue;
        await grantFolderManage(executor, owner, id);
        // A folder that already existed through the documents in it (a
        // connector's, an old upload's) is not new to anyone: it keeps the
        // audience it had.
        if (
            folderParentPath(path) === null &&
            !(await folderHasDocuments(executor, owner.companyId, path))
        ) {
            await executor
                .insert(folderSettings)
                .values({
                    categoryId: id,
                    companyId: owner.companyId,
                    visibility: "restricted",
                    updatedBy: owner.authUserId,
                })
                .onConflictDoNothing();
        }
    }
}

/**
 * Defaults for documents a person just added. Loose files (Unfiled) are
 * private to them; filed ones inherit their folder, with a manage grant so
 * the uploader can still share that one file.
 */
export async function applyDocumentCreationDefaults(
    executor: Executor,
    owner: OwnerRef,
    docs: readonly { id: number | bigint; category: string | null }[]
): Promise<void> {
    for (const doc of docs) {
        const id = BigInt(doc.id);
        await grantDocumentManage(executor, owner, id);
        if (isUnfiledFolder(doc.category)) {
            await executor
                .insert(documentSettings)
                .values({
                    documentId: id,
                    companyId: owner.companyId,
                    restricted: true,
                    updatedBy: owner.authUserId,
                })
                .onConflictDoNothing();
        }
    }
}

// ---------------------------------------------------------------------------
// Moving a document
// ---------------------------------------------------------------------------

/** True when the only principal named is this one person. */
function onlyPrincipalIs(
    grants: readonly { principalType: string; principalId: string }[],
    userPk: string
): boolean {
    const keys = new Set(grants.map(g => `${g.principalType}:${g.principalId}`));
    return keys.size === 1 && keys.has(`user:${userPk}`);
}

/**
 * What a document's own audience becomes when it changes folder. Call after
 * the category is updated, in the same transaction. Returns what happened so
 * the caller can tell the person ("now visible to everyone in Sales").
 */
export async function applyDocumentMoveDefaults(
    executor: Executor,
    owner: OwnerRef,
    doc: { id: number | bigint; toCategory: string }
): Promise<"inherits_folder" | "made_private" | "unchanged"> {
    const id = BigInt(doc.id);
    const facts = await loadDocumentFacts(Number(id));
    if (isUnfiledFolder(doc.toCategory)) {
        if (facts.restricted) return "unchanged";
        await grantDocumentManage(executor, owner, id);
        await executor
            .insert(documentSettings)
            .values({
                documentId: id,
                companyId: owner.companyId,
                restricted: true,
                updatedBy: owner.authUserId,
            })
            .onConflictDoNothing();
        return "made_private";
    }
    if (facts.restricted && onlyPrincipalIs(facts.grants, owner.userPk.toString())) {
        await executor.delete(documentSettings).where(eq(documentSettings.documentId, id));
        return "inherits_folder";
    }
    return "unchanged";
}

// ---------------------------------------------------------------------------
// Deleting a folder
// ---------------------------------------------------------------------------

function descendantPattern(path: string): string {
    return `${path.replace(/[\\%_]/g, m => `\\${m}`)}${FOLDER_SEPARATOR}%`;
}

/**
 * Before a folder is deleted and its documents move up, give every document
 * whose access came from a restricted folder inside the deleted subtree that
 * same restriction of its own, so deleting a private folder never publishes
 * what was in it. Documents that already have their own audience keep it.
 */
export async function carryRestrictionsBeforeFolderDelete(
    executor: Executor,
    owner: OwnerRef,
    rawPath: string
): Promise<number> {
    const path = normalizeFolderPath(rawPath);
    const docs = await executor
        .select({ id: document.id, category: document.category })
        .from(document)
        .where(
            and(
                eq(document.companyId, owner.companyId),
                or(eq(document.category, path), like(document.category, descendantPattern(path)))
            )
        );
    if (docs.length === 0) return 0;

    const own = await executor
        .select({ documentId: documentSettings.documentId })
        .from(documentSettings)
        .where(
            inArray(
                documentSettings.documentId,
                docs.map(d => BigInt(d.id))
            )
        );
    const hasOwn = new Set(own.map(r => Number(r.documentId)));

    // The governing restriction for each distinct folder, looked up once.
    const lineageCache = new Map<string, Awaited<ReturnType<typeof loadFolderLineage>>>();
    let carried = 0;
    for (const doc of docs) {
        if (hasOwn.has(Number(doc.id))) continue;
        const folderPath = normalizeFolderPath(doc.category);
        let lineage = lineageCache.get(folderPath);
        if (!lineage) {
            lineage = await loadFolderLineage(owner.companyId, folderPath);
            lineageCache.set(folderPath, lineage);
        }
        const governing = lineage.find(f => f.restricted);
        // Only restrictions inside the subtree disappear; one above it survives.
        if (!governing || !(governing.path === path || governing.path.startsWith(path + "/"))) {
            continue;
        }
        const id = BigInt(doc.id);
        await executor
            .insert(documentSettings)
            .values({
                documentId: id,
                companyId: owner.companyId,
                restricted: true,
                updatedBy: owner.authUserId,
            })
            .onConflictDoNothing();
        // Every grant from the governing folder down to the document's own
        // folder counts today, so every one of them is carried.
        const counted = lineage.slice(0, lineage.indexOf(governing) + 1);
        for (const grant of counted.flatMap(f => f.grants)) {
            await executor
                .insert(documentGrants)
                .values({
                    companyId: owner.companyId,
                    documentId: id,
                    principalType: grant.principalType,
                    principalId: grant.principalId,
                    level: grant.level,
                    grantedBy: grant.grantedBy ?? owner.authUserId,
                })
                .onConflictDoNothing();
        }
        carried++;
    }
    return carried;
}

// ---------------------------------------------------------------------------
// People leaving, roles going away
// ---------------------------------------------------------------------------

function isManageLevel(level: string): boolean {
    return isGrantLevel(level) && grantLevelAtLeast(level, "manage");
}

/**
 * Before a member's grants are deleted: every folder or document where they
 * hold the only manage grant gets one for `heirPk`, so nothing they owned is
 * left without anyone able to share it — or, now that admins no longer read
 * past restrictions, without anyone able to see it.
 */
export async function handOverSoleManaged(
    executor: Executor,
    companyId: bigint,
    departingPk: bigint,
    heir: OwnerRef
): Promise<{ folders: number; documents: number }> {
    const departing = departingPk.toString();
    if (heir.userPk === departingPk) return { folders: 0, documents: 0 };

    const folderRows = await executor
        .select({
            categoryId: folderGrants.categoryId,
            principalType: folderGrants.principalType,
            principalId: folderGrants.principalId,
            level: folderGrants.level,
        })
        .from(folderGrants)
        .where(
            and(
                eq(folderGrants.companyId, companyId),
                inArray(
                    folderGrants.categoryId,
                    executor
                        .select({ id: folderGrants.categoryId })
                        .from(folderGrants)
                        .where(
                            and(
                                eq(folderGrants.companyId, companyId),
                                eq(folderGrants.principalType, "user"),
                                eq(folderGrants.principalId, departing)
                            )
                        )
                )
            )
        );
    const documentRows = await executor
        .select({
            documentId: documentGrants.documentId,
            principalType: documentGrants.principalType,
            principalId: documentGrants.principalId,
            level: documentGrants.level,
        })
        .from(documentGrants)
        .where(
            and(
                eq(documentGrants.companyId, companyId),
                inArray(
                    documentGrants.documentId,
                    executor
                        .select({ id: documentGrants.documentId })
                        .from(documentGrants)
                        .where(
                            and(
                                eq(documentGrants.companyId, companyId),
                                eq(documentGrants.principalType, "user"),
                                eq(documentGrants.principalId, departing)
                            )
                        )
                )
            )
        );

    const soleManaged = <K extends string>(
        rows: readonly ({ principalType: string; principalId: string; level: string } & Record<
            K,
            bigint
        >)[],
        key: K
    ): bigint[] => {
        const byItem = new Map<string, typeof rows>();
        for (const row of rows) {
            const id = row[key].toString();
            byItem.set(id, [...(byItem.get(id) ?? []), row]);
        }
        const out: bigint[] = [];
        for (const [id, grants] of byItem) {
            const managers = grants.filter(g => isManageLevel(g.level));
            const departingManages = managers.some(
                g => g.principalType === "user" && g.principalId === departing
            );
            if (departingManages && managers.length === 1) out.push(BigInt(id));
        }
        return out;
    };

    const folders = soleManaged(folderRows, "categoryId");
    const documents = soleManaged(documentRows, "documentId");
    for (const id of folders) await grantFolderManage(executor, heir, id);
    for (const id of documents) await grantDocumentManage(executor, heir, id);
    return { folders: folders.length, documents: documents.length };
}

/** The workspace's longest-standing active owner — the heir when someone leaves on their own. */
export async function workspaceOwnerHeir(
    executor: Executor,
    companyId: bigint
): Promise<bigint | null> {
    const [row] = await executor
        .select({ userId: userCompanyMemberships.userId })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.companyId, companyId),
                eq(userCompanyMemberships.role, "owner"),
                eq(userCompanyMemberships.status, "active")
            )
        )
        .orderBy(userCompanyMemberships.id)
        .limit(1);
    return row ? BigInt(row.userId) : null;
}

/** A deleted custom role takes its grants with it; re-creating the slug grants nothing. */
export async function deleteRoleGrants(
    executor: Executor,
    companyId: bigint,
    slug: string
): Promise<void> {
    const byRole = (table: typeof folderGrants | typeof documentGrants) =>
        and(
            eq(table.companyId, companyId),
            eq(table.principalType, "role"),
            eq(table.principalId, slug)
        );
    await executor.delete(folderGrants).where(byRole(folderGrants));
    await executor.delete(documentGrants).where(byRole(documentGrants));
    await executor
        .delete(workspaceSessionGrants)
        .where(
            and(
                eq(workspaceSessionGrants.companyId, companyId),
                eq(workspaceSessionGrants.principalType, "role"),
                eq(workspaceSessionGrants.principalId, slug)
            )
        );
}

/** Session grants naming a departing member go with their other grants. */
export async function deleteUserSessionGrants(
    executor: Executor,
    companyId: bigint,
    userPk: bigint
): Promise<void> {
    await executor
        .delete(workspaceSessionGrants)
        .where(
            and(
                eq(workspaceSessionGrants.companyId, companyId),
                eq(workspaceSessionGrants.principalType, "user"),
                eq(workspaceSessionGrants.principalId, userPk.toString())
            )
        );
}
