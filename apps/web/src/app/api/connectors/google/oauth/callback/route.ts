/**
 * GET /api/connectors/google/oauth/callback — Leg 0, second half.
 *
 * Google redirects here with ?code&state. The state must match the nonce
 * cookie set by /start, the code is exchanged for tokens, and the connection
 * is stored workspace-scoped + user-attributed. Ends in a redirect back to
 * the documents workspace with a query flag the UI turns into a toast.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { decodeIdTokenClaims, exchangeAuthorizationCode } from "@launchstack/google-drive";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    GOOGLE_DRIVE_SCOPES,
    OAUTH_STATE_COOKIE,
    getGoogleOAuthApp,
    getOAuthRedirectUrl,
    isDriveLinkingEnabled,
} from "~/server/services/google-drive/config";
import { upsertGoogleConnection } from "~/server/services/google-drive/connections";

function redirectToWorkspace(request: Request, flag: string): NextResponse {
    const response = NextResponse.redirect(
        new URL(`/employer/documents?googleDrive=${flag}`, request.url)
    );
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
}

export async function GET(request: Request) {
    if (!isDriveLinkingEnabled()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    if (!isManagementRole(ctx.data.role)) {
        return redirectToWorkspace(request, "forbidden");
    }

    const url = new URL(request.url);
    if (url.searchParams.get("error")) {
        // The user clicked "cancel" on the consent screen — not an error.
        return redirectToWorkspace(request, "cancelled");
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieHeader = request.headers.get("cookie") ?? "";
    const nonce = /(?:^|;\s*)gdrive_oauth_state=([^;]+)/.exec(cookieHeader)?.[1];

    if (!code || !state || !nonce || state !== nonce) {
        console.warn("[google-oauth] state mismatch or missing code — rejecting callback");
        return redirectToWorkspace(request, "error");
    }

    try {
        const token = await exchangeAuthorizationCode({
            app: getGoogleOAuthApp(),
            code,
            redirectUri: getOAuthRedirectUrl(url.origin),
        });

        if (!token.refresh_token) {
            // prompt=consent should always yield one; without it the link
            // would die within the hour, so refuse rather than half-connect.
            console.error("[google-oauth] token exchange returned no refresh_token");
            return redirectToWorkspace(request, "error");
        }

        const claims = token.id_token ? decodeIdTokenClaims(token.id_token) : {};
        const accountId = claims.sub ?? claims.email;
        if (!accountId) {
            console.error("[google-oauth] no account identity in the token response");
            return redirectToWorkspace(request, "error");
        }

        const [userRow] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, ctx.data.authUserId))
            .limit(1);

        await upsertGoogleConnection({
            companyId: BigInt(ctx.data.companyId),
            grantedByUserId: userRow ? BigInt(userRow.id) : null,
            providerAccountId: accountId,
            providerAccountEmail: claims.email ?? null,
            refreshToken: token.refresh_token,
            scopes: token.scope ?? GOOGLE_DRIVE_SCOPES.join(" "),
        });

        return redirectToWorkspace(request, "connected");
    } catch (err) {
        console.error("[google-oauth] callback failed:", err);
        return redirectToWorkspace(request, "error");
    }
}
