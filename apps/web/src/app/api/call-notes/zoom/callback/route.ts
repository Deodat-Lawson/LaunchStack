import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { callNotesZoomConnections } from "@launchstack/features/call-notes";

import { env } from "~/env";
import { encryptZoomSecret, verifyZoomOAuthState } from "~/server/call-notes/zoom-oauth";
import { getEngine } from "~/server/engine";

export const runtime = "nodejs";

const ZoomTokenSchema = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().int().positive(),
    scope: z.string().optional(),
});

const ZoomUserSchema = z.object({
    id: z.string().min(1).max(256),
    account_id: z.string().min(1).max(256),
});

export async function GET(request: Request): Promise<Response> {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const clientId = env.server.ZOOM_CLIENT_ID;
    const clientSecret = env.server.ZOOM_CLIENT_SECRET;
    const redirectUri = env.server.ZOOM_OAUTH_REDIRECT_URI;
    const encryptionKey = env.server.ZOOM_TOKEN_ENCRYPTION_KEY;
    if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
        return NextResponse.json({ error: "Zoom OAuth is not configured" }, { status: 503 });
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const queryState = url.searchParams.get("state");
    const cookieStore = await cookies();
    const cookieState = cookieStore.get("launchstack_zoom_oauth_state")?.value;
    cookieStore.delete("launchstack_zoom_oauth_state");
    if (!code || !queryState || !cookieState) {
        return NextResponse.json({ error: "Invalid Zoom OAuth callback" }, { status: 400 });
    }

    let state;
    try {
        state = verifyZoomOAuthState({ queryState, cookieState, keyBase64: encryptionKey });
    } catch {
        return NextResponse.json({ error: "Invalid Zoom OAuth state" }, { status: 400 });
    }
    if (state.userId !== userId) {
        return NextResponse.json({ error: "Zoom OAuth user mismatch" }, { status: 403 });
    }

    const tokenResponse = await fetch("https://zoom.us/oauth/token", {
        method: "POST",
        headers: {
            authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
        }),
        cache: "no-store",
    });
    if (!tokenResponse.ok) {
        return NextResponse.json({ error: "Zoom token exchange failed" }, { status: 502 });
    }
    const token = ZoomTokenSchema.parse(await tokenResponse.json());

    const userResponse = await fetch("https://api.zoom.us/v2/users/me", {
        headers: { authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
    });
    if (!userResponse.ok) {
        return NextResponse.json({ error: "Zoom identity lookup failed" }, { status: 502 });
    }
    const zoomUser = ZoomUserSchema.parse(await userResponse.json());
    const now = new Date();
    const values = {
        id: `zoom_${randomUUID().replaceAll("-", "")}`,
        companyId: BigInt(state.companyId),
        userId,
        zoomAccountId: zoomUser.account_id,
        zoomUserId: zoomUser.id,
        encryptedAccessToken: encryptZoomSecret(
            token.access_token,
            encryptionKey,
            "zoom-access-token"
        ),
        encryptedRefreshToken: token.refresh_token
            ? encryptZoomSecret(token.refresh_token, encryptionKey, "zoom-refresh-token")
            : null,
        tokenExpiresAt: new Date(now.getTime() + token.expires_in * 1_000),
        scopes: token.scope?.split(" ").filter(Boolean) ?? [],
        status: "active" as const,
        disconnectedAt: null,
        updatedAt: now,
    };
    await getEngine()
        .db.insert(callNotesZoomConnections)
        .values({ ...values, createdAt: now })
        .onConflictDoUpdate({
            target: [callNotesZoomConnections.companyId, callNotesZoomConnections.userId],
            set: values,
        });

    const destination = new URL("/employer/documents", request.url);
    destination.searchParams.set("feature", "calls");
    destination.searchParams.set("zoom", "connected");
    return NextResponse.redirect(destination);
}
