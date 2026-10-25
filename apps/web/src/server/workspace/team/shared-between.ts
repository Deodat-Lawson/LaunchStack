/**
 * "What we share" — the two lists on a person's page in the Team tab
 * (ADR-014 §7):
 *
 * - **Shared with you by them**: grants that reach the caller (as a person or
 *   through one of their groups) and that the other person added.
 * - **You shared with them**: grants that reach the other person (directly or
 *   through their groups) and that the caller added.
 *
 * Folders, files and chats alike. Role- and workspace-wide grants are left
 * out: "shared with Everyone" is not something two people share with each
 * other. Every item is checked against what the caller can open today, so a
 * page never names a file the caller has since lost.
 */

import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import {
    documentGrants,
    folderGrants,
    userCompanyMemberships,
    users,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceSessionGrants,
    workspaceSessions,
} from "~/server/db/schema";
import { grantLevelRank, isGrantLevel, type GrantLevel } from "~/lib/authz/permissions";
import { scopeAllowsCategory, scopeAllowsDocument } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { readableSessionIds } from "~/server/sessions/access";
import { copy } from "~/i18n/copy";

import { notFound } from "../errors";

export type SharedItemType = "folder" | "document" | "chat";

export interface SharedItem {
    type: SharedItemType;
    /** Folder: category id. Document: document id. Chat: session id. */
    id: number | string;
    name: string;
    /** Folder: its path. Document: the folder it is in. */
    path?: string;
    level: GrantLevel;
    /** When it was shared (the newest grant, when several reach). */
    at: string;
    /** Set when it reaches the recipient only through a group. */
    viaGroup?: string;
}

export interface SharedBetween {
    sharedWithMe: SharedItem[];
    iShared: SharedItem[];
}

const LIMIT = 100;

/** A person as a grant recipient: their `users.id` and their groups, by id → name. */
interface Recipient {
    userPk: string;
    groups: Map<string, string>;
}

interface RawGrant {
    principalType: string;
    principalId: string;
    level: string;
    at: Date;
}

function reaches(
    table: typeof folderGrants | typeof documentGrants | typeof workspaceSessionGrants,
    recipient: Recipient
): SQL {
    const direct = and(eq(table.principalType, "user"), eq(table.principalId, recipient.userPk))!;
    const groupIds = [...recipient.groups.keys()];
    if (groupIds.length === 0) return direct;
    return or(direct, and(eq(table.principalType, "group"), inArray(table.principalId, groupIds)))!;
}

/** Fold several grants on one item into one row: the highest level, the newest time. */
function merge<R extends RawGrant & { key: string }>(
    rows: readonly R[],
    recipient: Recipient,
    toItem: (row: R) => Omit<SharedItem, "level" | "at" | "viaGroup">
): SharedItem[] {
    const out = new Map<string, SharedItem & { direct: boolean }>();
    for (const row of rows) {
        if (!isGrantLevel(row.level)) continue;
        const direct = row.principalType === "user";
        const viaGroup = direct ? undefined : recipient.groups.get(row.principalId);
        const at = row.at.toISOString();
        const seen = out.get(row.key);
        if (!seen) {
            out.set(row.key, {
                ...toItem(row),
                level: row.level,
                at,
                ...(viaGroup ? { viaGroup } : {}),
                direct,
            });
            continue;
        }
        if (grantLevelRank(row.level) > grantLevelRank(seen.level)) seen.level = row.level;
        if (at > seen.at) seen.at = at;
        if (direct) {
            seen.direct = true;
            delete seen.viaGroup;
        }
    }
    return [...out.values()].map(({ direct: _direct, ...item }) => item);
}

async function grantsBetween(
    companyId: bigint,
    grantedBy: string,
    recipient: Recipient
): Promise<{ folders: SharedItem[]; documents: SharedItem[]; chats: SharedItem[] }> {
    const [folderRows, documentRows, chatRows] = await Promise.all([
        db
            .select({
                id: folderGrants.categoryId,
                name: category.name,
                principalType: folderGrants.principalType,
                principalId: folderGrants.principalId,
                level: folderGrants.level,
                at: folderGrants.createdAt,
            })
            .from(folderGrants)
            .innerJoin(category, eq(category.id, folderGrants.categoryId))
            .where(
                and(
                    eq(folderGrants.companyId, companyId),
                    eq(folderGrants.grantedBy, grantedBy),
                    reaches(folderGrants, recipient)
                )
            )
            .orderBy(desc(folderGrants.createdAt))
            .limit(LIMIT * 2),
        db
            .select({
                id: document.id,
                title: document.title,
                category: document.category,
                principalType: documentGrants.principalType,
                principalId: documentGrants.principalId,
                level: documentGrants.level,
                at: documentGrants.createdAt,
            })
            .from(documentGrants)
            .innerJoin(document, eq(document.id, documentGrants.documentId))
            .where(
                and(
                    eq(documentGrants.companyId, companyId),
                    eq(documentGrants.grantedBy, grantedBy),
                    reaches(documentGrants, recipient)
                )
            )
            .orderBy(desc(documentGrants.createdAt))
            .limit(LIMIT * 2),
        db
            .select({
                id: workspaceSessions.id,
                title: workspaceSessions.title,
                principalType: workspaceSessionGrants.principalType,
                principalId: workspaceSessionGrants.principalId,
                level: workspaceSessionGrants.level,
                at: workspaceSessionGrants.createdAt,
            })
            .from(workspaceSessionGrants)
            .innerJoin(
                workspaceSessions,
                eq(workspaceSessions.id, workspaceSessionGrants.sessionId)
            )
            .where(
                and(
                    eq(workspaceSessionGrants.companyId, companyId),
                    eq(workspaceSessionGrants.grantedBy, grantedBy),
                    reaches(workspaceSessionGrants, recipient)
                )
            )
            .orderBy(desc(workspaceSessionGrants.createdAt))
            .limit(LIMIT * 2),
    ]);

    return {
        folders: merge(
            folderRows.map(r => ({ ...r, key: String(r.id) })),
            recipient,
            r => ({ type: "folder", id: Number(r.id), name: r.name, path: r.name })
        ),
        documents: merge(
            documentRows.map(r => ({ ...r, key: String(r.id) })),
            recipient,
            r => ({
                type: "document",
                id: Number(r.id),
                name: r.title,
                path: r.category,
            })
        ),
        chats: merge(
            chatRows.map(r => ({ ...r, key: r.id })),
            recipient,
            r => ({ type: "chat", id: r.id, name: r.title })
        ),
    };
}

/** Keep what the caller can open now, newest first. */
async function visibleToCaller(
    ctx: WorkspaceContext,
    lists: { folders: SharedItem[]; documents: SharedItem[]; chats: SharedItem[] }
): Promise<SharedItem[]> {
    const scope = await ctx.documentScope();
    const folders = lists.folders.filter(f => scopeAllowsCategory(scope, f.path ?? f.name));
    const documents = lists.documents.filter(d =>
        scopeAllowsDocument(scope, { id: Number(d.id), category: d.path ?? null })
    );
    const readable = await readableSessionIds(
        ctx,
        lists.chats.map(c => String(c.id))
    );
    const chats = lists.chats.filter(c => readable.has(String(c.id)));
    return [...folders, ...documents, ...chats]
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .slice(0, LIMIT);
}

/** Each person's groups in this workspace, id → name. */
async function groupsOf(
    companyId: bigint,
    userPks: readonly bigint[]
): Promise<Map<string, Map<string, string>>> {
    const out = new Map<string, Map<string, string>>(userPks.map(pk => [pk.toString(), new Map()]));
    const rows = await db
        .select({
            userId: workspaceGroupMembers.userId,
            groupId: workspaceGroups.id,
            name: workspaceGroups.name,
        })
        .from(workspaceGroupMembers)
        .innerJoin(workspaceGroups, eq(workspaceGroups.id, workspaceGroupMembers.groupId))
        .where(
            and(
                eq(workspaceGroups.companyId, companyId),
                inArray(workspaceGroupMembers.userId, [...userPks])
            )
        );
    for (const row of rows) {
        out.get(row.userId.toString())?.set(String(row.groupId), row.name);
    }
    return out;
}

/**
 * What the caller and the member `otherUserPk` have shared with each other.
 * 404 when that person is not in the workspace; empty lists for yourself.
 */
export async function sharedBetween(
    ctx: WorkspaceContext,
    otherUserPk: bigint
): Promise<SharedBetween> {
    const [other] = await db
        .select({ authUserId: users.userId })
        .from(userCompanyMemberships)
        .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
        .where(
            and(
                eq(userCompanyMemberships.companyId, ctx.companyId),
                eq(userCompanyMemberships.userId, otherUserPk)
            )
        )
        .limit(1);
    if (!other) throw notFound(copy("team.server.errors.memberNotFound"));
    if (otherUserPk === ctx.userPk) return { sharedWithMe: [], iShared: [] };

    const groups = await groupsOf(ctx.companyId, [ctx.userPk, otherUserPk]);
    const me: Recipient = {
        userPk: ctx.userPk.toString(),
        groups: groups.get(ctx.userPk.toString()) ?? new Map<string, string>(),
    };
    const them: Recipient = {
        userPk: otherUserPk.toString(),
        groups: groups.get(otherUserPk.toString()) ?? new Map<string, string>(),
    };

    // One direction at a time: each reads the same three grant tables.
    const toMe = await grantsBetween(ctx.companyId, other.authUserId, me);
    const fromMe = await grantsBetween(ctx.companyId, ctx.authUserId, them);

    return {
        sharedWithMe: await visibleToCaller(ctx, toMe),
        iShared: await visibleToCaller(ctx, fromMe),
    };
}
