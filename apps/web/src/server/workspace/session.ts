/**
 * Session-only identity for the accept routes, which run before the person
 * holds a membership — so `requireWorkspaceContext` cannot serve them — and
 * which need the session's email to match an invitation against.
 */

import { NextResponse } from "next/server";

import { getServerSession } from "~/server/auth";

export interface SessionUser {
    authUserId: string;
    email: string;
    name: string | null;
}

type Result = { success: true; data: SessionUser } | { success: false; response: NextResponse };

export async function requireSessionUser(): Promise<Result> {
    const session = await getServerSession();
    const user = session?.user;
    if (!user?.id) {
        return {
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        };
    }
    return {
        success: true,
        data: {
            authUserId: user.id,
            email: (user.email ?? "").trim().toLowerCase(),
            name: user.name?.trim() || null,
        },
    };
}
