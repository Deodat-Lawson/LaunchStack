/**
 * Who can see each folder and file in a list, for the caller, in bulk
 * (ADR-014 §6 — the Sources rail's Workspace / Shared / Private sections).
 *
 * `item-access` answers one item at a time with two or three reads each; a
 * list of hundreds would be hundreds of round trips. Here the facts are read
 * once per request — every folder row, every restricted folder and document,
 * every grant — and the same pure rules (`folderAccessFrom`,
 * `documentAccessFrom`) run over them in memory, so the rail's labels can
 * never disagree with what the write paths enforce.
 *
 * The classifiers are pure and take the facts as arguments; the loaders are
 * thin. Read scope still decides what is listed at all (`DocumentScope`);
 * this only describes what is already visible.
 */

import { and, asc, eq } from "drizzle-orm";

import { category, document, documentVersions } from "@launchstack/store/schema";
import { db } from "~/server/db";
import {
    documentGrants,
    documentSettings,
    folderGrants,
    folderSettings,
    users,
} from "~/server/db/schema";
import { folderAncestors, normalizeFolderPath } from "~/lib/folders/path";

import {
    documentAccessFrom,
    folderAccessFrom,
    levelAtLeast,
    type AccessSubject,
    type AudienceKind,
    type FolderFact,
    type GrantFact,
    type ItemAccess,
    type OwnerView,
} from "./item-access";

// ---------------------------------------------------------------------------
// The view the client gets
// ---------------------------------------------------------------------------

/** One item's access as the caller's rail draws and gates it. */
export interface AccessView {
    /** `workspace` — everyone; `shared` — specific people; `private` — only the caller. */
    audience: AudienceKind;
    /** True when the item sets its own audience; false when it inherits one. */
    ownAudience: boolean;
    /** The restricted folder that governs it, or null. */
    governingPath: string | null;
    /** How many principals the governing grants name (people, groups, roles). */
    principalCount: number;
    /** May add to it (a folder), or rename, move, replace, delete it. */
    canEdit: boolean;
    /** May change who has access — and, for a folder, rename, move or delete it. */
    canManage: boolean;
}

export function accessViewOf(access: ItemAccess): AccessView {
    return {
        audience: access.audience,
        ownAudience: access.ownAudience,
        governingPath: access.governingPath,
        principalCount: access.principalCount,
        canEdit: levelAtLeast(access.level, "edit"),
        canManage: levelAtLeast(access.level, "manage"),
    };
}

// ---------------------------------------------------------------------------
// Facts and the pure classifiers
// ---------------------------------------------------------------------------

export interface FolderAccessFacts {
    /** `category.id` by normalized path. The first row wins, as in `loadFolderLineage`. */
    readonly idByPath: ReadonlyMap<string, number>;
    readonly restrictedIds: ReadonlySet<number>;
    readonly grantsByFolder: ReadonlyMap<number, readonly GrantFact[]>;
}

export interface DocumentAccessFacts {
    readonly restrictedIds: ReadonlySet<number>;
    readonly grantsByDocument: ReadonlyMap<number, readonly GrantFact[]>;
}

/** A folder and its ancestors, deepest first — the shape `loadFolderLineage` reads from the database. */
export function lineageFrom(rawPath: string, facts: FolderAccessFacts): FolderFact[] {
    const path = normalizeFolderPath(rawPath);
    return [path, ...folderAncestors(path).reverse()].map(p => {
        const categoryId = facts.idByPath.get(p) ?? null;
        return {
            path: p,
            categoryId,
            restricted: categoryId !== null && facts.restrictedIds.has(categoryId),
            grants: categoryId === null ? [] : (facts.grantsByFolder.get(categoryId) ?? []),
        };
    });
}

/** Access to every folder in `paths`, keyed by normalized path. */
export function classifyFolders(
    paths: Iterable<string>,
    facts: FolderAccessFacts,
    subject: AccessSubject
): Map<string, ItemAccess> {
    const out = new Map<string, ItemAccess>();
    for (const raw of paths) {
        const path = normalizeFolderPath(raw);
        if (!out.has(path)) out.set(path, folderAccessFrom(lineageFrom(path, facts), subject));
    }
    return out;
}

/** Access to every document, each folder's access worked out once. */
export function classifyDocuments(
    docs: Iterable<{ id: number; category: string | null }>,
    documentFacts: DocumentAccessFacts,
    folderFacts: FolderAccessFacts,
    subject: AccessSubject
): Map<number, ItemAccess> {
    const folders = new Map<string, ItemAccess>();
    const out = new Map<number, ItemAccess>();
    for (const doc of docs) {
        const path = normalizeFolderPath(doc.category);
        let folder = folders.get(path);
        if (!folder) {
            folder = folderAccessFrom(lineageFrom(path, folderFacts), subject);
            folders.set(path, folder);
        }
        out.set(
            doc.id,
            documentAccessFrom(
                {
                    restricted: documentFacts.restrictedIds.has(doc.id),
                    grants: documentFacts.grantsByDocument.get(doc.id) ?? [],
                },
                folder,
                subject
            )
        );
    }
    return out;
}

// ---------------------------------------------------------------------------
// Loaders — one read per table, whole workspace
// ---------------------------------------------------------------------------

function groupGrants<K extends string>(
    rows: readonly (GrantFact & Record<K, bigint>)[],
    key: K
): Map<number, GrantFact[]> {
    const out = new Map<number, GrantFact[]>();
    for (const row of rows) {
        const id = Number(row[key]);
        const grant: GrantFact = {
            principalType: row.principalType,
            principalId: row.principalId,
            level: row.level,
            grantedBy: row.grantedBy ?? null,
        };
        const list = out.get(id);
        if (list) list.push(grant);
        else out.set(id, [grant]);
    }
    return out;
}

/**
 * Every folder fact of the workspace. Callers that already read the folder
 * rows and restricted settings (`listVisibleFolders`) pass them in, so only
 * the grants are read here.
 */
export async function loadFolderAccessFacts(
    companyId: bigint,
    known?: Pick<FolderAccessFacts, "idByPath" | "restrictedIds">
): Promise<FolderAccessFacts> {
    const [rows, restricted, grants] = await Promise.all([
        known
            ? Promise.resolve(null)
            : db
                  .select({ id: category.id, name: category.name })
                  .from(category)
                  .where(eq(category.companyId, companyId))
                  .orderBy(asc(category.id)),
        known
            ? Promise.resolve(null)
            : db
                  .select({ categoryId: folderSettings.categoryId })
                  .from(folderSettings)
                  .where(
                      and(
                          eq(folderSettings.companyId, companyId),
                          eq(folderSettings.visibility, "restricted")
                      )
                  ),
        db
            .select({
                categoryId: folderGrants.categoryId,
                principalType: folderGrants.principalType,
                principalId: folderGrants.principalId,
                level: folderGrants.level,
                grantedBy: folderGrants.grantedBy,
            })
            .from(folderGrants)
            .where(eq(folderGrants.companyId, companyId)),
    ]);

    let idByPath = known?.idByPath;
    if (!idByPath) {
        const map = new Map<string, number>();
        for (const row of rows ?? []) {
            const path = normalizeFolderPath(row.name);
            if (!map.has(path)) map.set(path, Number(row.id));
        }
        idByPath = map;
    }
    const restrictedIds =
        known?.restrictedIds ?? new Set((restricted ?? []).map(r => Number(r.categoryId)));
    return { idByPath, restrictedIds, grantsByFolder: groupGrants(grants, "categoryId") };
}

export async function loadDocumentAccessFacts(companyId: bigint): Promise<DocumentAccessFacts> {
    const [restricted, grants] = await Promise.all([
        db
            .select({ documentId: documentSettings.documentId })
            .from(documentSettings)
            .where(
                and(
                    eq(documentSettings.companyId, companyId),
                    eq(documentSettings.restricted, true)
                )
            ),
        db
            .select({
                documentId: documentGrants.documentId,
                principalType: documentGrants.principalType,
                principalId: documentGrants.principalId,
                level: documentGrants.level,
                grantedBy: documentGrants.grantedBy,
            })
            .from(documentGrants)
            .where(eq(documentGrants.companyId, companyId)),
    ]);
    return {
        restrictedIds: new Set(restricted.map(r => Number(r.documentId))),
        grantsByDocument: groupGrants(grants, "documentId"),
    };
}

/**
 * Who added each document: the uploader of its first version, when that is a
 * person (connectors and older rows record none). One read for the workspace.
 */
export async function loadDocumentOwners(companyId: bigint): Promise<Map<number, OwnerView>> {
    const rows = await db
        .selectDistinctOn([documentVersions.documentId], {
            documentId: documentVersions.documentId,
            authUserId: users.userId,
            name: users.name,
        })
        .from(documentVersions)
        .innerJoin(document, eq(document.id, documentVersions.documentId))
        .leftJoin(users, eq(users.userId, documentVersions.uploadedBy))
        .where(eq(document.companyId, companyId))
        .orderBy(documentVersions.documentId, asc(documentVersions.versionNumber));
    const out = new Map<number, OwnerView>();
    for (const row of rows) {
        if (row.authUserId && row.name) {
            out.set(Number(row.documentId), { authUserId: row.authUserId, name: row.name });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// The documents list
// ---------------------------------------------------------------------------

/** A document's access as the list carries it — no governing path; a file's own rail row needs none. */
export type DocumentAccessView = Pick<
    AccessView,
    "audience" | "ownAudience" | "principalCount" | "canEdit" | "canManage"
>;

/** What the documents list adds to each row it already returns. */
export interface DescribedDocuments {
    /** Keyed by document id. */
    access: Map<number, DocumentAccessView>;
    /** Who added it, when a person did. */
    addedBy: Map<number, OwnerView>;
}

export async function describeDocumentAccess(
    companyId: bigint,
    subject: AccessSubject,
    docs: readonly { id: number; category: string | null }[]
): Promise<DescribedDocuments> {
    if (docs.length === 0) return { access: new Map(), addedBy: new Map() };
    const [folderFacts, documentFacts, addedBy] = await Promise.all([
        loadFolderAccessFacts(companyId),
        loadDocumentAccessFacts(companyId),
        loadDocumentOwners(companyId),
    ]);
    const access = new Map<number, DocumentAccessView>();
    for (const [id, item] of classifyDocuments(docs, documentFacts, folderFacts, subject)) {
        const { audience, ownAudience, principalCount, canEdit, canManage } = accessViewOf(item);
        access.set(id, { audience, ownAudience, principalCount, canEdit, canManage });
    }
    return { access, addedBy };
}
