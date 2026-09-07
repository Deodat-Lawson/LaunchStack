/**
 * The actor half of the route contract: who is calling, and in which workspace.
 *
 * This started life inside the email-campaign routes, where it was the only
 * place in the API with a considered answer to that question — and two other
 * route folders were already reaching across into it. It lives here so every
 * service can use it without importing another service's internals.
 *
 * It layers on top of `requireWorkspaceContext`; it does not replace it.
 * Tenancy resolution stays in one place, and this adds the user row and the
 * permission gate that routes were otherwise re-querying for themselves.
 *
 * Response shape, id parsing and error mapping live in `./responses`, which is
 * free of the database — a route that only needs to answer should not have to
 * load the engine.
 */

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import type { Permission } from "~/lib/authz/permissions";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { fail } from "./responses";
import type { NextResponse } from "next/server";

export * from "./responses";

/** The caller, resolved to an internal user row and an active workspace. */
export interface ApiActor {
    /**
     * The auth subject id. Needed by services that persist who asked for something —
     * an internal row id is not stable across a re-seeded database, and a
     * stored actor reference should survive one.
     */
    externalUserId: string;
    /** `users.id` — the internal row id, not the auth subject id. */
    userId: number;
    email: string | null;
    name: string | null;
    /**
     * Narrowed from the bigint the workspace context carries. Company ids are
     * `bigserial` and nowhere near the safe-integer ceiling; a service that
     * wants the bigint back widens it in its own adapter.
     */
    companyId: number;
    /** Membership role slug in the active company, normalised (see ~/lib/authz/permissions). */
    role: string;
    /** The permission set the role resolves to. */
    permissions: ReadonlySet<Permission>;
    can(permission: Permission): boolean;
}

/**
 * A resolution result rather than a thrown error, so a route can return the
 * failure response directly without a try/catch that swallows real errors.
 */
export type ActorResult<A extends ApiActor = ApiActor> =
    | { ok: true; actor: A }
    | { ok: false; response: NextResponse };

export async function resolveApiActor(): Promise<ActorResult> {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) {
        return { ok: false, response: ctx.response };
    }

    const [requestingUser] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, Number(ctx.data.userPk)))
        .limit(1);
    if (!requestingUser) {
        return { ok: false, response: fail("User not found", 404) };
    }

    const permissions = ctx.data.permissions;
    return {
        ok: true,
        actor: {
            externalUserId: ctx.data.authUserId,
            userId: Number(ctx.data.userPk),
            email: requestingUser.email ?? null,
            name: requestingUser.name ?? null,
            companyId: Number(ctx.data.companyId),
            role: ctx.data.role,
            permissions,
            can: permission => permissions.has(permission),
        },
    };
}

/**
 * Narrows an already-resolved actor to one holding `permission`.
 *
 * Kept separate from resolution so a service that extends {@link ApiActor}
 * with its own fields can gate without re-querying, and so the rule is
 * written once rather than per route.
 */
export function requirePermission<A extends ApiActor>(
    resolved: ActorResult<A>,
    permission: Permission
): ActorResult<A> {
    if (!resolved.ok) return resolved;
    if (!resolved.actor.can(permission)) {
        return {
            ok: false,
            response: fail("Your workspace role does not allow this action.", 403, {
                permission,
            }),
        };
    }
    return resolved;
}

export async function resolveApiActorWithPermission(permission: Permission): Promise<ActorResult> {
    return requirePermission(await resolveApiActor(), permission);
}
