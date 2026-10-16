/**
 * Who may see and change a mindmap draft (ADR-014).
 *
 * A draft has no audience of its own: its folder decides, as it does for a
 * file that inherits its folder.
 *
 * - **Filed in a folder**: whoever can open the folder sees the draft, at the
 *   level the folder gives them. View opens it; edit saves, renames, moves,
 *   restores and publishes it; manage — or edit plus `documents.delete` —
 *   trashes it (`canDeleteAtLevel`, the rule files use).
 * - **Unfiled**: private to whoever made it, as a loose file is.
 * - **Whoever made it** always keeps it at manage, the way an uploader keeps
 *   the manage grant on their own file.
 *
 * Publishing is how a draft reaches anyone else: the published copy is an
 * ordinary document with its own access.
 *
 * What is listed is filtered in SQL by the caller's `DocumentScope` through
 * `folderScopePredicate` — the documents list's own rule — and per-item
 * decisions use `item-access`, as the document write paths do. A move never
 * shows a draft to someone who could not see it before, except when a person
 * files a draft that only they could see (Drive's rule, as for files); a
 * draft cannot carry its old audience the way a file does, so any other
 * widening move is refused.
 */

import { and, eq, ne, or, type SQL } from "drizzle-orm";

import { db } from "~/server/db";
import { mindmaps, users } from "~/server/db/schema";
import { folderScopePredicate } from "~/lib/authz/scope";
import { scopeAllowsCategory, type DocumentScope } from "~/lib/authz/scope-types";
import { isUnfiledFolder, normalizeFolderPath, UNFILED_FOLDER } from "~/lib/folders/path";
import type { GrantLevel } from "~/lib/authz/permissions";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import type { Executor } from "~/server/workspace/db-types";
import {
    accessSubject,
    canDeleteAtLevel,
    folderAccess,
    folderAccessFrom,
    levelAtLeast,
    loadFolderLineage,
    maxLevel,
    type AccessActor,
    type AccessSubject,
    type AudienceMember,
    type FolderFact,
    type ItemAccess,
} from "~/server/workspace/item-access";
import {
    accessViewOf,
    classifyFolders,
    loadFolderAccessFacts,
    type DocumentAccessView,
} from "~/server/workspace/source-access";

/** The draft fields every rule here reads. */
export interface DraftRef {
    readonly folder: string;
    readonly createdByUserId: string;
}

/** What a list or a single read is filtered by. */
export interface DraftReader {
    readonly companyId: bigint;
    readonly authUserId: string;
    readonly scope: DocumentScope;
}

/** The caller as `actor` plus who they are, for the per-item checks. */
export type DraftActor = AccessActor & { readonly authUserId: string };

/** Same shape as a document's in the documents list, so the rail treats both alike. */
export type DraftAccessView = DocumentAccessView;

export const DRAFT_EDIT_DENIED = "You can view this mindmap but not change it.";
export const DRAFT_DELETE_DENIED =
    "Only the person who made this mindmap, or someone who manages its folder, can delete it.";
export const DRAFT_UNFILED_DENIED =
    "Only the person who made this mindmap can move it to Unfiled: drafts there are private to whoever made them.";
export const DRAFT_MOVE_WIDENS =
    "Moving this mindmap there would show it to people who can't see it now. A draft takes its folder's access, so publish it to share it, or change who can see the folder.";

export async function draftReader(ctx: WorkspaceContext): Promise<DraftReader> {
    return {
        companyId: ctx.companyId,
        authUserId: ctx.authUserId,
        scope: await ctx.documentScope(),
    };
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** May the reader see this draft — the in-memory twin of `draftVisibilityWhere`. */
export function draftVisibleTo(reader: Pick<DraftReader, "authUserId" | "scope">, map: DraftRef) {
    if (map.createdByUserId === reader.authUserId) return true;
    if (isUnfiledFolder(map.folder)) return false;
    return scopeAllowsCategory(reader.scope, normalizeFolderPath(map.folder));
}

/**
 * The caller's access to a draft, given what its folder gives them. An
 * Unfiled draft takes no folder's access: it is its creator's alone.
 */
export function draftAccessFrom(map: DraftRef, folder: ItemAccess, authUserId: string): ItemAccess {
    const creator = map.createdByUserId === authUserId;
    if (isUnfiledFolder(map.folder)) {
        return {
            visible: creator,
            level: creator ? "manage" : null,
            // Shown to its creator, the only one who sees it, as theirs alone.
            audience: "private",
            governingPath: null,
            ownAudience: true,
            principalCount: 1,
        };
    }
    if (!creator) return { ...folder, ownAudience: false };
    return {
        ...folder,
        visible: true,
        level: maxLevel(folder.level, "manage"),
        ownAudience: false,
    };
}

export function draftAccessView(access: ItemAccess, actor: Pick<AccessActor, "permissions">) {
    const { audience, ownAudience, principalCount, canEdit, canManage } = accessViewOf(access);
    return {
        audience,
        ownAudience,
        principalCount,
        canEdit,
        canManage,
        canDelete: canDeleteAtLevel(access.level, actor.permissions),
    } satisfies DraftAccessView;
}

export function canEditDraftAt(level: GrantLevel | null): boolean {
    return levelAtLeast(level, "edit");
}

/**
 * Who can see a draft filed under `lineage` (deepest first; `null` for
 * Unfiled), by `users.id`. Its creator always can.
 */
export function draftAudienceIds(
    members: readonly AudienceMember[],
    lineage: readonly FolderFact[] | null,
    creatorPk: string | null
): Set<string> {
    const out = new Set<string>();
    for (const m of members) {
        if (m.userId === creatorPk) {
            out.add(m.userId);
            continue;
        }
        if (lineage === null) continue;
        const subject: AccessSubject = {
            userPk: m.userId,
            role: m.role,
            groupIds: m.groupIds,
            permissions: m.permissions,
        };
        if (folderAccessFrom(lineage, subject).visible) out.add(m.userId);
    }
    return out;
}

/**
 * Does a move show the draft to someone new, beyond what Drive's rule allows?
 * `before` and `after` are everyone who can see it at each end (its creator
 * included); `beforeByFolder` is who its old folder alone let in. A draft
 * whose folder let in only its mover — their own private folder, or Unfiled —
 * is theirs to file anywhere, as a file private to its mover is; any other
 * widening is refused, because a draft cannot carry its old audience along.
 */
export function moveWidensDraft(
    audiences: {
        before: ReadonlySet<string>;
        after: ReadonlySet<string>;
        beforeByFolder: ReadonlySet<string>;
    },
    moverPk: string
): boolean {
    const newcomers = [...audiences.after].filter(id => !audiences.before.has(id));
    if (newcomers.length === 0) return false;
    return ![...audiences.beforeByFolder].every(id => id === moverPk);
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * The drafts a reader may see, as a predicate over `mindmaps`: their own, and
 * those filed in a folder their scope opens. Unfiled drafts are their
 * creators' alone.
 */
export function draftVisibilityWhere(reader: DraftReader): SQL {
    const inScope = folderScopePredicate(reader.scope, mindmaps.folder);
    const filed = ne(mindmaps.folder, UNFILED_FOLDER);
    return and(
        eq(mindmaps.companyId, reader.companyId),
        or(eq(mindmaps.createdByUserId, reader.authUserId), inScope ? and(filed, inScope) : filed)
    )!;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** The caller's access to one draft. Two indexed reads unless it is Unfiled. */
export async function draftAccess(actor: DraftActor, map: DraftRef): Promise<ItemAccess> {
    const subject = await accessSubject(actor);
    const folder = isUnfiledFolder(map.folder)
        ? NO_FOLDER
        : await folderAccess(actor, normalizeFolderPath(map.folder), subject);
    return draftAccessFrom(map, folder, actor.authUserId);
}

const NO_FOLDER: ItemAccess = {
    visible: false,
    level: null,
    audience: "private",
    governingPath: null,
    ownAudience: true,
    principalCount: 0,
};

/** Access views for a list of drafts, keyed by id, from one read of the folder facts. */
export async function describeDraftAccess(
    actor: DraftActor,
    maps: readonly (DraftRef & { id: number })[]
): Promise<Map<number, DraftAccessView>> {
    const out = new Map<number, DraftAccessView>();
    if (maps.length === 0) return out;
    const [facts, subject] = await Promise.all([
        loadFolderAccessFacts(actor.companyId),
        accessSubject(actor),
    ]);
    const filed = maps.filter(m => !isUnfiledFolder(m.folder)).map(m => m.folder);
    const folders = classifyFolders(filed, facts, subject);
    for (const map of maps) {
        const folder = folders.get(normalizeFolderPath(map.folder)) ?? NO_FOLDER;
        out.set(map.id, draftAccessView(draftAccessFrom(map, folder, actor.authUserId), actor));
    }
    return out;
}

async function userPkOf(authUserId: string, executor: Executor): Promise<string | null> {
    const [row] = await executor
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userId, authUserId))
        .limit(1);
    return row ? row.id.toString() : null;
}

/**
 * True when moving `map` to `to` would show it to someone new beyond what
 * Drive's rule allows. `members` is `activeMemberPrincipals`, read before the
 * caller opens its transaction; the folders are read through `executor`, so a
 * folder claimed in that transaction counts.
 */
export async function draftMoveWidens(
    actor: DraftActor,
    map: DraftRef,
    to: string,
    members: readonly AudienceMember[],
    executor: Executor = db
): Promise<boolean> {
    const from = normalizeFolderPath(map.folder);
    const [creatorPk, before, after] = await Promise.all([
        userPkOf(map.createdByUserId, executor),
        isUnfiledFolder(from) ? null : loadFolderLineage(actor.companyId, from, executor),
        isUnfiledFolder(to) ? null : loadFolderLineage(actor.companyId, to, executor),
    ]);
    return moveWidensDraft(
        {
            before: draftAudienceIds(members, before, creatorPk),
            after: draftAudienceIds(members, after, creatorPk),
            beforeByFolder: draftAudienceIds(members, before, null),
        },
        actor.userPk.toString()
    );
}
