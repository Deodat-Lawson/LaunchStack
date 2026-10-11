/**
 * What one person may do with one folder or one document (ADR-014).
 *
 * `DocumentScope` answers "which documents may I read" for a whole request;
 * this module answers the per-item questions the write paths and the Share
 * dialog ask — may I add here, edit this, change who sees it — and how the
 * Sources rail should label it (private, shared, workspace).
 *
 * The rules, in one place:
 *
 * - A folder is governed by its **nearest restricted ancestor-or-self**. With
 *   one, only grants on the folders from the item up to and including that
 *   governing folder count. With none, the folder is workspace-wide and the
 *   caller's role sets the floor (`documents.upload` → edit,
 *   `folders.manage` → manage); grants anywhere in the lineage can only raise
 *   it.
 * - A restricted document is governed by its own grants alone. An
 *   unrestricted document follows its folder; a grant on the document raises
 *   the level the folder gives, and opens it to someone the folder keeps out
 *   (a reach-in, as `resolveDocumentScope` applies it).
 * - Nobody reads past a restriction by role: there is no admin bypass.
 * - Guests see only what reaches them through a grant on a restricted item.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { category, company, documentVersions } from "@launchstack/store/schema";
import { db } from "~/server/db";
import {
    documentGrants,
    documentSettings,
    folderGrants,
    folderSettings,
    users,
    workspaceGroupMembers,
} from "~/server/db/schema";
import {
    grantLevelRank,
    isGrantLevel,
    normalizeRoleSlug,
    type GrantLevel,
    type Permission,
} from "~/lib/authz/permissions";
import { folderAncestors, normalizeFolderPath } from "~/lib/folders/path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The caller as a principal: who they are, their role, their groups. */
export interface AccessSubject {
    /** `users.id` as a string — the form `user` grants store. */
    readonly userPk: string;
    readonly role: string;
    readonly groupIds: ReadonlySet<string>;
    readonly permissions: ReadonlySet<Permission>;
}

export interface GrantFact {
    readonly principalType: string;
    readonly principalId: string;
    readonly level: string;
    readonly grantedBy?: string | null;
}

/** One folder in a lineage: is it restricted, and who is granted what on it. */
export interface FolderFact {
    readonly path: string;
    readonly categoryId: number | null;
    readonly restricted: boolean;
    readonly grants: readonly GrantFact[];
}

/** `workspace` — everyone; `private` — only the caller; `shared` — specific people. */
export type AudienceKind = "workspace" | "private" | "shared";

export interface ItemAccess {
    /** May the caller see it at all. */
    readonly visible: boolean;
    /** The caller's level, or null when they can't see it. */
    readonly level: GrantLevel | null;
    /** Who can see it, from the caller's point of view. */
    readonly audience: AudienceKind;
    /** The folder whose restriction applies, or null when nothing above restricts it. */
    readonly governingPath: string | null;
    /** True when the item has its own audience; false when it inherits one. */
    readonly ownAudience: boolean;
    /** How many principals the governing grants name (people, groups, roles). */
    readonly principalCount: number;
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

export function grantReaches(grant: GrantFact, subject: AccessSubject): boolean {
    switch (grant.principalType) {
        case "user":
            return grant.principalId === subject.userPk;
        case "group":
            return subject.groupIds.has(grant.principalId);
        case "role":
            return normalizeRoleSlug(grant.principalId) === normalizeRoleSlug(subject.role);
        case "workspace":
            return normalizeRoleSlug(subject.role) !== "guest";
        default:
            return false;
    }
}

export function maxLevel(
    a: GrantLevel | null | undefined,
    b: GrantLevel | null | undefined
): GrantLevel | null {
    if (!a) return b ?? null;
    if (!b) return a;
    return grantLevelRank(a) >= grantLevelRank(b) ? a : b;
}

/** The highest level `grants` give `subject`, or null. */
export function levelFromGrants(
    grants: readonly GrantFact[],
    subject: AccessSubject
): GrantLevel | null {
    let best: GrantLevel | null = null;
    for (const grant of grants) {
        if (!isGrantLevel(grant.level) || !grantReaches(grant, subject)) continue;
        best = maxLevel(best, grant.level);
    }
    return best;
}

/** What a workspace-wide folder gives someone by role alone. */
export function roleFloor(subject: AccessSubject): GrantLevel | null {
    if (normalizeRoleSlug(subject.role) === "guest") return null;
    if (!subject.permissions.has("documents.read")) return null;
    if (subject.permissions.has("folders.manage")) return "manage";
    if (subject.permissions.has("documents.upload") || subject.permissions.has("documents.edit")) {
        return "edit";
    }
    return "view";
}

/** Private when the only principal is the caller themselves. */
export function audienceOf(
    restricted: boolean,
    grants: readonly GrantFact[],
    subject: AccessSubject
): AudienceKind {
    if (!restricted) return "workspace";
    const principals = new Set(grants.map(g => `${g.principalType}:${g.principalId}`));
    if (principals.size === 1 && principals.has(`user:${subject.userPk}`)) return "private";
    return "shared";
}

function countPrincipals(grants: readonly GrantFact[]): number {
    return new Set(grants.map(g => `${g.principalType}:${g.principalId}`)).size;
}

/**
 * Access to a folder from its lineage, **deepest first** (`lineage[0]` is the
 * folder itself). Folders missing from the lineage simply have no facts.
 */
const NOTHING: ItemAccess = {
    visible: false,
    level: null,
    audience: "workspace",
    governingPath: null,
    ownAudience: false,
    principalCount: 0,
};

export function folderAccessFrom(
    lineage: readonly FolderFact[],
    subject: AccessSubject
): ItemAccess {
    if (!subject.permissions.has("documents.read")) return NOTHING;
    const governingIndex = lineage.findIndex(f => f.restricted);
    const counted = governingIndex === -1 ? lineage : lineage.slice(0, governingIndex + 1);
    const granted = levelFromGrants(
        counted.flatMap(f => f.grants),
        subject
    );

    if (governingIndex !== -1) {
        const governing = lineage[governingIndex]!;
        return {
            visible: granted !== null,
            level: granted,
            audience: audienceOf(true, governing.grants, subject),
            governingPath: governing.path,
            ownAudience: governingIndex === 0,
            principalCount: countPrincipals(governing.grants),
        };
    }

    const floor = roleFloor(subject);
    const level = floor === null ? null : maxLevel(floor, granted);
    return {
        visible: level !== null,
        level,
        audience: "workspace",
        governingPath: null,
        ownAudience: false,
        principalCount: 0,
    };
}

/** Access to a document, given its own facts and its folder's access. */
export function documentAccessFrom(
    doc: { restricted: boolean; grants: readonly GrantFact[] },
    folder: ItemAccess,
    subject: AccessSubject
): ItemAccess {
    if (!subject.permissions.has("documents.read")) return NOTHING;
    const granted = levelFromGrants(doc.grants, subject);
    if (doc.restricted) {
        return {
            visible: granted !== null,
            level: granted,
            audience: audienceOf(true, doc.grants, subject),
            governingPath: null,
            ownAudience: true,
            principalCount: countPrincipals(doc.grants),
        };
    }
    // A person added to a file inside a folder they can't open still opens
    // that file ("Same as Q4 planning", plus Ada) — the reach-in exception
    // `resolveDocumentScope` applies too.
    if (!folder.visible) {
        return granted
            ? { ...folder, visible: true, level: granted, ownAudience: false }
            : { ...folder, ownAudience: false };
    }
    return { ...folder, level: maxLevel(folder.level, granted), ownAudience: false };
}

export function levelAtLeast(level: GrantLevel | null, required: GrantLevel): boolean {
    return level !== null && grantLevelRank(level) >= grantLevelRank(required);
}

/**
 * May someone at `level` delete a document? Whoever manages it — the person
 * who added it, or anyone they made a manager — always may; anyone else needs
 * edit access and the `documents.delete` permission. A Member can throw away
 * their own private file, not a teammate's.
 */
export function canDeleteAtLevel(
    level: GrantLevel | null,
    permissions: ReadonlySet<Permission>
): boolean {
    if (levelAtLeast(level, "manage")) return true;
    return levelAtLeast(level, "edit") && permissions.has("documents.delete");
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** The slice of a workspace context these checks need. */
export interface AccessActor {
    readonly companyId: bigint;
    readonly userPk: bigint;
    readonly role: string;
    readonly permissions: ReadonlySet<Permission>;
}

export async function accessSubject(actor: AccessActor): Promise<AccessSubject> {
    const rows = await db
        .select({ groupId: workspaceGroupMembers.groupId })
        .from(workspaceGroupMembers)
        .where(eq(workspaceGroupMembers.userId, actor.userPk));
    return {
        userPk: actor.userPk.toString(),
        role: actor.role,
        groupIds: new Set(rows.map(r => r.groupId.toString())),
        permissions: actor.permissions,
    };
}

/** Facts for a folder and every ancestor, deepest first. Two indexed reads. */
export async function loadFolderLineage(companyId: bigint, rawPath: string): Promise<FolderFact[]> {
    const path = normalizeFolderPath(rawPath);
    const paths = [path, ...folderAncestors(path).reverse()];
    const rows = await db
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(and(eq(category.companyId, companyId), inArray(category.name, paths)));
    // The category table has no unique (company, name); the first row wins.
    const idByPath = new Map<string, number>();
    for (const row of rows) {
        const key = normalizeFolderPath(row.name);
        if (!idByPath.has(key)) idByPath.set(key, Number(row.id));
    }
    const ids = [...idByPath.values()].map(id => BigInt(id));
    const [settings, grants] =
        ids.length === 0
            ? [[], []]
            : await Promise.all([
                  db
                      .select({ categoryId: folderSettings.categoryId })
                      .from(folderSettings)
                      .where(
                          and(
                              inArray(folderSettings.categoryId, ids),
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
                      .where(inArray(folderGrants.categoryId, ids)),
              ]);
    const restrictedIds = new Set(settings.map(s => Number(s.categoryId)));
    return paths.map(p => {
        const categoryId = idByPath.get(p) ?? null;
        return {
            path: p,
            categoryId,
            restricted: categoryId !== null && restrictedIds.has(categoryId),
            grants:
                categoryId === null ? [] : grants.filter(g => Number(g.categoryId) === categoryId),
        };
    });
}

export async function loadDocumentFacts(
    documentId: number
): Promise<{ restricted: boolean; grants: GrantFact[] }> {
    const key = BigInt(documentId);
    const [settings, grants] = await Promise.all([
        db
            .select({ restricted: documentSettings.restricted })
            .from(documentSettings)
            .where(eq(documentSettings.documentId, key))
            .limit(1),
        db
            .select({
                principalType: documentGrants.principalType,
                principalId: documentGrants.principalId,
                level: documentGrants.level,
                grantedBy: documentGrants.grantedBy,
            })
            .from(documentGrants)
            .where(eq(documentGrants.documentId, key)),
    ]);
    return { restricted: settings[0]?.restricted === true, grants };
}

export async function folderAccess(
    actor: AccessActor,
    path: string,
    subject?: AccessSubject
): Promise<ItemAccess> {
    const [lineage, who] = await Promise.all([
        loadFolderLineage(actor.companyId, path),
        subject ? Promise.resolve(subject) : accessSubject(actor),
    ]);
    return folderAccessFrom(lineage, who);
}

export async function documentAccess(
    actor: AccessActor,
    doc: { id: number; category: string | null },
    subject?: AccessSubject
): Promise<ItemAccess> {
    const who = subject ?? (await accessSubject(actor));
    const [facts, folder] = await Promise.all([
        loadDocumentFacts(doc.id),
        folderAccess(actor, doc.category ?? "", who),
    ]);
    return documentAccessFrom(facts, folder, who);
}

/** May the actor add documents or subfolders here (needs `documents.upload` too). */
export async function canEditFolderPath(actor: AccessActor, path: string): Promise<boolean> {
    return levelAtLeast((await folderAccess(actor, path)).level, "edit");
}

/** May the actor change who sees this folder, rename, move or delete it. */
export async function canManageFolderPath(actor: AccessActor, path: string): Promise<boolean> {
    return levelAtLeast((await folderAccess(actor, path)).level, "manage");
}

/** May the actor rename, move, replace or delete this document (role permission checked by the route). */
export async function canEditDocument(
    actor: AccessActor,
    doc: { id: number; category: string | null }
): Promise<boolean> {
    return levelAtLeast((await documentAccess(actor, doc)).level, "edit");
}

export async function canManageDocument(
    actor: AccessActor,
    doc: { id: number; category: string | null }
): Promise<boolean> {
    return levelAtLeast((await documentAccess(actor, doc)).level, "manage");
}

// ---------------------------------------------------------------------------
// Share dialog context
// ---------------------------------------------------------------------------

/** Where an item's audience comes from when it has none of its own. */
export interface InheritedAudience {
    /** The governing restricted folder above the item, or null — the workspace. */
    path: string | null;
    restricted: boolean;
}

/** What the folder at `parentPath` (null = top level) would give a child that inherits it. */
export async function inheritedAudience(
    companyId: bigint,
    parentPath: string | null
): Promise<InheritedAudience> {
    if (parentPath === null) return { path: null, restricted: false };
    const lineage = await loadFolderLineage(companyId, parentPath);
    const governing = lineage.find(f => f.restricted);
    return governing
        ? { path: governing.path, restricted: true }
        : { path: null, restricted: false };
}

export interface OwnerView {
    /** Auth subject id — draw with `usePeople` / `ProfileAvatar`. */
    authUserId: string;
    name: string;
}

/**
 * Who made a folder: the person whose own manage grant they gave themselves
 * when creating it (ADR-014). Folders from before ADR-014 have no owner.
 */
export async function folderOwner(categoryId: number): Promise<OwnerView | null> {
    const [row] = await db
        .select({ authUserId: users.userId, name: users.name })
        .from(folderGrants)
        .innerJoin(users, sql`${users.id} = ${folderGrants.principalId}::bigint`)
        .where(
            and(
                eq(folderGrants.categoryId, BigInt(categoryId)),
                eq(folderGrants.principalType, "user"),
                eq(folderGrants.level, "manage"),
                eq(folderGrants.grantedBy, users.userId)
            )
        )
        .orderBy(asc(folderGrants.createdAt))
        .limit(1);
    return row ? { authUserId: row.authUserId, name: row.name } : null;
}

/** Who added a document: the uploader of its first version. */
export async function documentOwner(documentId: number): Promise<OwnerView | null> {
    const [row] = await db
        .select({ authUserId: users.userId, name: users.name })
        .from(documentVersions)
        .innerJoin(users, eq(users.userId, documentVersions.uploadedBy))
        .where(eq(documentVersions.documentId, BigInt(documentId)))
        .orderBy(asc(documentVersions.versionNumber))
        .limit(1);
    return row ? { authUserId: row.authUserId, name: row.name } : null;
}

export async function workspaceName(companyId: bigint): Promise<string> {
    const [row] = await db
        .select({ name: company.name })
        .from(company)
        .where(eq(company.id, Number(companyId)))
        .limit(1);
    return row?.name ?? "the workspace";
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/** One active member, as `activeMemberPrincipals` lists them. */
export interface AudienceMember {
    /** `users.id` as a string. */
    readonly userId: string;
    readonly role: string;
    readonly groupIds: ReadonlySet<string>;
    readonly permissions: ReadonlySet<Permission>;
}

/**
 * How many of `members` can open the folder at the top of `lineage` (deepest
 * first) — or, with `doc`, that document in it — by exactly the rules reads
 * use. The Share dialog's "(4 people)".
 */
export function countAudience(
    members: readonly AudienceMember[],
    lineage: readonly FolderFact[],
    doc?: { restricted: boolean; grants: readonly GrantFact[] }
): number {
    let n = 0;
    for (const m of members) {
        const subject: AccessSubject = {
            userPk: m.userId,
            role: m.role,
            groupIds: m.groupIds,
            permissions: m.permissions,
        };
        const folder = folderAccessFrom(lineage, subject);
        const access = doc ? documentAccessFrom(doc, folder, subject) : folder;
        if (access.visible) n++;
    }
    return n;
}
