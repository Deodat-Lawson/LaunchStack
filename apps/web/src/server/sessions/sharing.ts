/**
 * Who a chat is shared with (ADR-014 §4) — the server half of the Share
 * dialog's chat adapter (`_workspace/access/chatShareAdapter.ts`), whose
 * `ChatSharing` shape this returns.
 *
 * A chat is private to its owner until they add people, groups or roles, or
 * open it to "Everyone at <workspace>" (a `workspace` / `*` grant). Every
 * grant is `view`: readers read, and continue in a chat of their own. Anyone
 * who can read the chat may look at its sharing; only the owner may change it.
 */

import { and, eq } from "drizzle-orm";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { normalizeRoleSlug, type GrantLevel, type PrincipalType } from "~/lib/authz/permissions";
import { db } from "~/server/db";
import { users, workspaceSessionGrants, workspaceSessions } from "~/server/db/schema";
import { recordActivity } from "~/server/workspace/activity";
import { copy } from "~/i18n/copy";
import { forbidden, notFound } from "~/server/workspace/errors";
import {
    activeMemberPrincipals,
    grantKey,
    principalMatches,
    principalNames,
    toGrantViews,
    validatePrincipals,
    type GrantInput,
    type GrantRow,
} from "~/server/workspace/grants";
import { workspaceName } from "~/server/workspace/item-access";
import { notifyShared } from "~/server/workspace/notifications";

import { resolveSessionAccess, WORKSPACE_PRINCIPAL_ID } from "./access";

export interface ChatSharingView {
    general: "private" | "workspace";
    grants: {
        principalType: PrincipalType;
        principalId: string;
        principalName: string;
        level: GrantLevel;
        authUserId: string | null;
    }[];
    canManage: boolean;
    owner: { authUserId: string; name: string };
    workspaceName: string;
    /** Active members who can read it, owner included. */
    audienceCount: number;
}

export interface ChatSharingInput {
    general: "private" | "workspace";
    grants: { principalType: PrincipalType; principalId: string; level?: "view" }[];
}

async function grantRows(sessionId: string): Promise<GrantRow[]> {
    const rows = await db
        .select({
            id: workspaceSessionGrants.id,
            principalType: workspaceSessionGrants.principalType,
            principalId: workspaceSessionGrants.principalId,
            level: workspaceSessionGrants.level,
        })
        .from(workspaceSessionGrants)
        .where(eq(workspaceSessionGrants.sessionId, sessionId));
    return rows.map(r => ({ ...r, id: Number(r.id) }));
}

async function ownerRef(
    authUserId: string
): Promise<{ authUserId: string; name: string; pk: string | null }> {
    const [row] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.userId, authUserId))
        .limit(1);
    return { authUserId, name: row?.name ?? "Former member", pk: row ? String(row.id) : null };
}

const isWorkspaceGrant = (g: { principalType: string; principalId: string }) =>
    g.principalType === "workspace" && g.principalId === WORKSPACE_PRINCIPAL_ID;

/**
 * Who of the active members can read it: the owner, and everyone a grant
 * reaches — by the same rules `resolveSessionAccess` applies at read time
 * (`workspace` reaches every member but Guests).
 */
export function chatAudience(
    members: readonly { userId: string; role: string; groupIds: ReadonlySet<string> }[],
    ownerPk: string | null,
    grants: readonly { principalType: string; principalId: string }[]
): number {
    const everyone = grants.some(isWorkspaceGrant);
    return members.filter(member => {
        if (member.userId === ownerPk) return true;
        if (everyone && normalizeRoleSlug(member.role) !== "guest") return true;
        return grants.some(g => !isWorkspaceGrant(g) && principalMatches(g, member));
    }).length;
}

async function buildView(
    ctx: WorkspaceContext,
    session: { id: string; userId: string },
    canManage: boolean
): Promise<ChatSharingView> {
    const [grants, owner, members, wsName] = await Promise.all([
        grantRows(session.id),
        ownerRef(session.userId),
        activeMemberPrincipals(ctx.companyId),
        workspaceName(ctx.companyId),
    ]);
    const named = grants.filter(g => !isWorkspaceGrant(g));
    const names = await principalNames(ctx.companyId, named);
    return {
        general: grants.some(isWorkspaceGrant) ? "workspace" : "private",
        grants: toGrantViews(named, names).map(g => ({
            principalType: g.principalType,
            principalId: g.principalId,
            principalName: g.principalName,
            level: g.level,
            authUserId: g.authUserId,
        })),
        canManage,
        owner: { authUserId: owner.authUserId, name: owner.name },
        workspaceName: wsName,
        audienceCount: chatAudience(members, owner.pk, grants),
    };
}

export async function getChatSharing(
    ctx: WorkspaceContext,
    sessionId: string
): Promise<ChatSharingView> {
    const access = await resolveSessionAccess(ctx, sessionId);
    if (!access) throw notFound(copy("chat.server.sessions.notFound"));
    return buildView(ctx, access.session, access.level === "owner");
}

export async function setChatSharing(
    ctx: WorkspaceContext,
    sessionId: string,
    input: ChatSharingInput
): Promise<ChatSharingView> {
    const access = await resolveSessionAccess(ctx, sessionId);
    if (!access) throw notFound(copy("chat.server.sessions.notFound"));
    if (access.level !== "owner") throw forbidden(copy("chat.server.sessions.ownerOnlyShare"));
    const session = access.session;

    // A grant naming the owner is meaningless (they always read it); drop it
    // rather than store a row the dialog would show as "you".
    const requested = input.grants.filter(
        g => !(g.principalType === "user" && g.principalId.trim() === String(ctx.userPk))
    );
    const validated = await validatePrincipals(
        ctx.companyId,
        requested.map(
            (g): GrantInput => ({
                principalType: g.principalType,
                principalId: g.principalId,
                level: "view",
            })
        )
    );
    const desired: { principalType: string; principalId: string; level: "view" }[] = [
        ...validated.map(g => ({
            principalType: g.principalType,
            principalId: g.principalId,
            level: "view" as const,
        })),
        ...(input.general === "workspace"
            ? [
                  {
                      principalType: "workspace",
                      principalId: WORKSPACE_PRINCIPAL_ID,
                      level: "view" as const,
                  },
              ]
            : []),
    ];

    const existing = await grantRows(session.id);
    const existingByKey = new Map(existing.map(g => [grantKey(g), g]));
    const desiredKeys = new Set(desired.map(grantKey));
    const diff = {
        added: desired.filter(g => !existingByKey.has(grantKey(g))),
        removed: existing.filter(g => !desiredKeys.has(grantKey(g))),
        // Only `view` exists for chats; anything else stored is brought back to it.
        changed: existing.filter(g => desiredKeys.has(grantKey(g)) && g.level !== "view"),
    };
    const changed = diff.added.length + diff.removed.length + diff.changed.length > 0;

    if (changed) {
        const names = await principalNames(ctx.companyId, [
            ...diff.added.filter(g => !isWorkspaceGrant(g)),
            ...diff.removed.filter(g => !isWorkspaceGrant(g)),
        ]);
        const nameOf = (g: { principalType: string; principalId: string }) =>
            isWorkspaceGrant(g)
                ? "Everyone"
                : (names.get(`${g.principalType}:${g.principalId}`) ?? g.principalId);

        await db.transaction(async tx => {
            for (const grant of diff.added) {
                await tx.insert(workspaceSessionGrants).values({
                    companyId: ctx.companyId,
                    sessionId: session.id,
                    principalType: grant.principalType,
                    principalId: grant.principalId,
                    level: "view",
                    grantedBy: ctx.authUserId,
                });
            }
            for (const change of diff.changed) {
                await tx
                    .update(workspaceSessionGrants)
                    .set({ level: "view" })
                    .where(eq(workspaceSessionGrants.id, change.id));
            }
            for (const removed of diff.removed) {
                await tx
                    .delete(workspaceSessionGrants)
                    .where(
                        and(
                            eq(workspaceSessionGrants.id, removed.id),
                            eq(workspaceSessionGrants.sessionId, session.id)
                        )
                    );
            }

            // `shared_at` marks the first share and clears when nobody is left.
            const sharedAt = desired.length === 0 ? null : (session.sharedAt ?? new Date());
            if ((sharedAt === null) !== (session.sharedAt === null)) {
                await tx
                    .update(workspaceSessions)
                    .set({ sharedAt })
                    .where(eq(workspaceSessions.id, session.id));
            }

            const told = diff.added.filter(
                g => g.principalType === "user" || g.principalType === "group"
            );
            if (told.length > 0) {
                await notifyShared(tx, {
                    companyId: ctx.companyId,
                    actorUserId: ctx.authUserId,
                    targetType: "chat",
                    targetId: session.id,
                    targetLabel: session.title,
                    level: "view",
                    principals: told,
                });
            }

            if (diff.added.length > 0 || diff.removed.length > 0) {
                await recordActivity(tx, {
                    companyId: ctx.companyId,
                    actorUserId: ctx.authUserId,
                    verb: diff.added.length > 0 ? "shared" : "unshared",
                    targetType: "chat",
                    targetId: session.id,
                    targetLabel: session.title,
                    detail: {
                        everyone: diff.added.some(isWorkspaceGrant),
                        added: diff.added.map(nameOf),
                        removed: diff.removed.map(nameOf),
                    },
                });
            }
        });
    }

    return buildView(ctx, session, true);
}
