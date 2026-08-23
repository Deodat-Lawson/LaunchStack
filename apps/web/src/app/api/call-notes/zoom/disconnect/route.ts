import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { callNotesZoomConnections } from "@launchstack/features/call-notes";

import { getActiveCompanyId } from "~/lib/active-workspace";
import { getEngine } from "~/server/engine";

export async function POST(): Promise<Response> {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const companyId = await getActiveCompanyId(userId);
    const now = new Date();
    await getEngine()
        .db.update(callNotesZoomConnections)
        .set({
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            tokenExpiresAt: null,
            scopes: [],
            status: "disconnected",
            disconnectedAt: now,
            updatedAt: now,
        })
        .where(
            and(
                eq(callNotesZoomConnections.companyId, companyId),
                eq(callNotesZoomConnections.userId, userId)
            )
        );

    return new Response(null, { status: 204 });
}
