/**
 * Resolves who is editing or viewing a profile.
 *
 * A profile belongs to a person, not a workspace, so these routes work
 * without an active workspace (the workspace picker, a fresh signup) — they
 * just have no workspace half. With one, the workspace is the active
 * workspace the rest of the app would resolve, and only when the membership
 * there is active.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireAuthIdentity, requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";

import type { ProfileCaller } from "./store";

export type ProfileCallerResult =
    | { success: true; data: ProfileCaller }
    | { success: false; response: NextResponse };

export async function resolveProfileCaller(): Promise<ProfileCallerResult> {
    const ctx = await requireWorkspaceContext();
    if (ctx.success) {
        return {
            success: true,
            data: {
                userPk: ctx.data.userPk,
                authUserId: ctx.data.authUserId,
                companyId: ctx.data.companyId,
            },
        };
    }
    if (ctx.response.status === 401) return ctx;

    // Signed in, but no active workspace: the profile half still works.
    const identity = await requireAuthIdentity();
    if (!identity.success) return identity;
    const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userId, identity.data.authUserId));
    if (!row) {
        return {
            success: false,
            response: NextResponse.json({ error: "No profile yet." }, { status: 404 }),
        };
    }
    return {
        success: true,
        data: { userPk: BigInt(row.id), authUserId: identity.data.authUserId, companyId: null },
    };
}
