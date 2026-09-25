/**
 * A few real teammates per workspace, for the workspace picker's avatar pile.
 *
 * Each face is resolved by `workspaceLooks` for *that* workspace — so the
 * photo is the one that workspace sees, and the image route will serve it to
 * this viewer, who is an active member there. Teammates are only shown where
 * the viewer could open the member list anyway: an active membership whose
 * role holds `members.view`. Elsewhere the pile is just the viewer and a count.
 */

import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { userCompanyMemberships, users } from "~/server/db/schema";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";

import { workspaceLooks } from "./store";

/** What the picker draws for one person: nothing it doesn't show. */
export interface PileSeat {
    name: string;
    avatarUrl: string | null;
}

export interface WorkspacePile {
    /** The viewer as this workspace sees them (their override here, if any). */
    me: PileSeat | null;
    /** Up to `perWorkspace` other active members, most recently active first. */
    teammates: PileSeat[];
}

export async function workspacePiles(
    viewer: { userPk: bigint; authUserId: string },
    memberships: readonly { companyId: bigint; role: string; status: string }[],
    perWorkspace = 3
): Promise<Map<string, WorkspacePile>> {
    const out = new Map<string, WorkspacePile>();
    if (memberships.length === 0) return out;

    const visible: bigint[] = [];
    await Promise.all(
        memberships.map(async m => {
            if (m.status !== "active") return;
            try {
                const permissions = await resolvePermissionsForRole(m.companyId, m.role);
                if (permissions.has("members.view")) visible.push(m.companyId);
            } catch {
                // An unknown custom role shows no teammates, not an error page.
            }
        })
    );

    const teammateIds = new Map<string, string[]>();
    if (visible.length > 0) {
        const ranked = db
            .select({
                companyId: userCompanyMemberships.companyId,
                authUserId: users.userId,
                rank: sql<number>`row_number() over (
                    partition by ${userCompanyMemberships.companyId}
                    order by ${users.lastActiveAt} desc nulls last, ${userCompanyMemberships.createdAt}
                )`.as("rank"),
            })
            .from(userCompanyMemberships)
            .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
            .where(
                and(
                    inArray(userCompanyMemberships.companyId, visible),
                    eq(userCompanyMemberships.status, "active"),
                    ne(userCompanyMemberships.userId, viewer.userPk)
                )
            )
            .as("ranked");
        const rows = await db
            .select({ companyId: ranked.companyId, authUserId: ranked.authUserId })
            .from(ranked)
            .where(lte(ranked.rank, perWorkspace))
            .orderBy(ranked.companyId, ranked.rank);
        for (const row of rows) {
            const key = row.companyId.toString();
            teammateIds.set(key, [...(teammateIds.get(key) ?? []), row.authUserId]);
        }
    }

    const seat = (look: { displayName: string; avatarUrl: string | null }): PileSeat => ({
        name: look.displayName,
        avatarUrl: look.avatarUrl,
    });

    await Promise.all(
        memberships.map(async m => {
            const key = m.companyId.toString();
            const ids = teammateIds.get(key) ?? [];
            const looks = await workspaceLooks(m.companyId, [viewer.authUserId, ...ids]);
            const me = looks.get(viewer.authUserId);
            out.set(key, {
                me: me ? seat(me) : null,
                teammates: ids.flatMap(id => {
                    const look = looks.get(id);
                    return look ? [seat(look)] : [];
                }),
            });
        })
    );
    return out;
}
