/**
 * GET /api/connectors/google/oauth/start — Leg 0, first half.
 *
 * Redirects a signed-in management user to Google's consent screen. CSRF: a
 * random nonce goes into both the OAuth `state` and a short-lived Lax cookie;
 * the callback requires them to match. The Clerk session survives the round
 * trip (top-level navigation, Lax cookies are sent), so the callback runs
 * with full workspace context.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { buildAuthorizationUrl } from "@launchstack/google-drive";

import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    GOOGLE_DRIVE_SCOPES,
    getGoogleOAuthApp,
    getOAuthRedirectUrl,
    isDriveLinkingEnabled,
} from "~/server/services/google-drive/config";

export const OAUTH_STATE_COOKIE = "gdrive_oauth_state";

export async function GET(request: Request) {
    if (!isDriveLinkingEnabled()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    if (!isManagementRole(ctx.data.role)) {
        return NextResponse.json(
            { error: "Forbidden: owner or admin role required" },
            { status: 403 }
        );
    }

    const nonce = randomUUID();
    const url = buildAuthorizationUrl({
        clientId: getGoogleOAuthApp().clientId,
        redirectUri: getOAuthRedirectUrl(new URL(request.url).origin),
        scopes: GOOGLE_DRIVE_SCOPES,
        state: nonce,
    });

    const response = NextResponse.redirect(url);
    response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        maxAge: 600,
        path: "/api/connectors/google",
    });
    return response;
}
