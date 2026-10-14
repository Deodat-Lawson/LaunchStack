/**
 * Who may read a chat (ADR-014).
 *
 * The owner always can, and only the owner may write — every write still goes
 * through `repository.ts`'s `ownedBy`. Anyone else reads it when a
 * `workspace_session_grants` row reaches them: as a person, through one of
 * their groups, through their role, or through `workspace` ("Everyone at
 * <workspace>", never a Guest). Anything else is null, which routes turn into
 * a 404 — never confirm that a colleague's chat id exists.
 */

import { and, eq, inArray, ne, or } from "drizzle-orm";

import { db } from "~/server/db";
import {
    workspaceSessionGrants,
    workspaceSessions,
    type WorkspaceSessionRow,
} from "~/server/db/schema";
import { normalizeRoleSlug } from "~/lib/authz/permissions";
import {
    accessSubject,
    type AccessActor,
    type AccessSubject,
} from "~/server/workspace/item-access";

export type SessionAccessLevel = "owner" | "view";

export const SESSION_PRINCIPAL_TYPES = ["user", "group", "role", "workspace"] as const;
export type SessionPrincipalType = (typeof SESSION_PRINCIPAL_TYPES)[number];
export const WORKSPACE_PRINCIPAL_ID = "*";

export interface SessionActor extends AccessActor {
    /** Auth subject id — what `workspace_sessions.user_id` stores. */
    readonly authUserId: string;
}

export interface SessionAccess {
    level: SessionAccessLevel;
    session: WorkspaceSessionRow;
}

/** The `(principal_type, principal_id)` pairs that reach this subject. */
export function sessionPrincipalKeys(subject: AccessSubject): { type: string; id: string }[] {
    const keys = [
        { type: "user", id: subject.userPk },
        { type: "role", id: normalizeRoleSlug(subject.role) },
        ...[...subject.groupIds].map(id => ({ type: "group", id })),
    ];
    if (normalizeRoleSlug(subject.role) !== "guest") {
        keys.push({ type: "workspace", id: WORKSPACE_PRINCIPAL_ID });
    }
    return keys;
}

function reachesSubject(subject: AccessSubject) {
    const keys = sessionPrincipalKeys(subject);
    return or(
        ...keys.map(k =>
            and(
                eq(workspaceSessionGrants.principalType, k.type),
                eq(workspaceSessionGrants.principalId, k.id)
            )
        )
    );
}

export async function resolveSessionAccess(
    actor: SessionActor,
    sessionId: string,
    subject?: AccessSubject
): Promise<SessionAccess | null> {
    const [session] = await db
        .select()
        .from(workspaceSessions)
        .where(
            and(
                eq(workspaceSessions.id, sessionId),
                eq(workspaceSessions.companyId, actor.companyId)
            )
        )
        .limit(1);
    if (!session) return null;
    if (session.userId === actor.authUserId) return { level: "owner", session };

    const who = subject ?? (await accessSubject(actor));
    const [grant] = await db
        .select({ id: workspaceSessionGrants.id })
        .from(workspaceSessionGrants)
        .where(and(eq(workspaceSessionGrants.sessionId, sessionId), reachesSubject(who)))
        .limit(1);
    return grant ? { level: "view", session } : null;
}

/** Ids of chats someone else owns that are shared with this person. */
export async function sessionIdsSharedWith(
    actor: SessionActor,
    subject?: AccessSubject
): Promise<string[]> {
    const who = subject ?? (await accessSubject(actor));
    const rows = await db
        .selectDistinct({ sessionId: workspaceSessionGrants.sessionId })
        .from(workspaceSessionGrants)
        .innerJoin(workspaceSessions, eq(workspaceSessions.id, workspaceSessionGrants.sessionId))
        .where(
            and(
                eq(workspaceSessionGrants.companyId, actor.companyId),
                ne(workspaceSessions.userId, actor.authUserId),
                reachesSubject(who)
            )
        );
    return rows.map(r => r.sessionId);
}

/** Which of `sessionIds` this person may read (owner or a grant). */
export async function readableSessionIds(
    actor: SessionActor,
    sessionIds: readonly string[],
    subject?: AccessSubject
): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set();
    const ids = [...new Set(sessionIds)];
    const owned = await db
        .select({ id: workspaceSessions.id })
        .from(workspaceSessions)
        .where(
            and(
                eq(workspaceSessions.companyId, actor.companyId),
                eq(workspaceSessions.userId, actor.authUserId),
                inArray(workspaceSessions.id, ids)
            )
        );
    const out = new Set(owned.map(r => r.id));
    const rest = ids.filter(id => !out.has(id));
    if (rest.length === 0) return out;
    const who = subject ?? (await accessSubject(actor));
    const granted = await db
        .selectDistinct({ sessionId: workspaceSessionGrants.sessionId })
        .from(workspaceSessionGrants)
        .where(and(inArray(workspaceSessionGrants.sessionId, rest), reachesSubject(who)));
    for (const row of granted) out.add(row.sessionId);
    return out;
}
