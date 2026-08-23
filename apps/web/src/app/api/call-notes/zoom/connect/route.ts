import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "~/env";
import { getActiveCompanyId } from "~/lib/active-workspace";
import { createZoomOAuthState } from "~/server/call-notes/zoom-oauth";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const clientId = env.server.ZOOM_CLIENT_ID;
    const redirectUri = env.server.ZOOM_OAUTH_REDIRECT_URI;
    const encryptionKey = env.server.ZOOM_TOKEN_ENCRYPTION_KEY;
    if (!clientId || !redirectUri || !encryptionKey) {
        return NextResponse.json({ error: "Zoom OAuth is not configured" }, { status: 503 });
    }

    const companyId = (await getActiveCompanyId(userId)).toString();
    const state = createZoomOAuthState(userId, companyId, encryptionKey);
    const cookieStore = await cookies();
    cookieStore.set("launchstack_zoom_oauth_state", state, {
        httpOnly: true,
        secure: new URL(redirectUri).protocol === "https:",
        sameSite: "lax",
        maxAge: 10 * 60,
        path: "/api/call-notes/zoom/callback",
    });

    const authorize = new URL("https://zoom.us/oauth/authorize");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state);
    return NextResponse.redirect(authorize);
}
