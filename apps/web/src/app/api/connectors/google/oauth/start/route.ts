/**
 * GET /api/connectors/google/oauth/start — Leg 0, first half.
 *
 * Two Google products share this door, told apart by `?provider=`:
 *
 * - (default) `google-drive` — workspace-scoped. A `connectors.manage`
 *   holder grants drive.file for the whole workspace. `?access=folders`
 *   (the panel's "Allow folder access") also asks for drive.readonly, when
 *   the operator allows folder import (GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED);
 *   a plain connect never does, so it stays clear of the warning Google
 *   shows for a restricted scope until the app is verified.
 * - `gmail` — per-user. Any `documents.upload` holder grants gmail.readonly
 *   for their own mailbox; the connection belongs to them, and the mail
 *   lands in a folder only they can see.
 *
 * Both redirect to Google's consent screen. CSRF: a random nonce goes into
 * both the OAuth `state` and a short-lived Lax cookie; the callback requires
 * them to match. The Gmail state carries a prefix so the shared callback can
 * tell the flows apart before it reads either cookie. The session survives
 * the round trip (top-level navigation, Lax cookies are sent), so the
 * callback runs with full workspace context.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { buildAuthorizationUrl } from "@launchstack/google-drive";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    GMAIL_OAUTH_STATE_COOKIE,
    GMAIL_SCOPES,
    GMAIL_STATE_PREFIX,
    isGmailConnectorConfigured,
} from "~/server/services/connectors/gmail/config";
import {
    googleDriveScopes,
    GOOGLE_OAUTH_STATE_COOKIE,
    getGoogleOAuthApp,
    getOAuthRedirectUrl,
    isGoogleConnectConfigured,
} from "~/server/services/google-drive/config";
import { publicOrigin } from "~/server/public-origin";

function redirectToConsent(
    request: Request,
    input: { scopes: string[]; cookieName: string; statePrefix: string }
): NextResponse {
    const nonce = randomUUID();
    const url = buildAuthorizationUrl({
        clientId: getGoogleOAuthApp().clientId,
        redirectUri: getOAuthRedirectUrl(publicOrigin(request)),
        scopes: input.scopes,
        state: `${input.statePrefix}${nonce}`,
    });

    const response = NextResponse.redirect(url);
    response.cookies.set(input.cookieName, nonce, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        maxAge: 600,
        path: "/api/connectors/google",
    });
    return response;
}

export async function GET(request: Request) {
    const search = new URL(request.url).searchParams;
    const provider = search.get("provider");

    if (provider === "gmail") {
        if (!isGmailConnectorConfigured()) {
            return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
        }
        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;
        return redirectToConsent(request, {
            scopes: GMAIL_SCOPES,
            cookieName: GMAIL_OAUTH_STATE_COOKIE,
            statePrefix: GMAIL_STATE_PREFIX,
        });
    }

    if (!isGoogleConnectConfigured()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }

    const ctx = await requireWorkspacePermission("connectors.manage");
    if (!ctx.success) return ctx.response;
    return redirectToConsent(request, {
        scopes: googleDriveScopes({ folderAccess: search.get("access") === "folders" }),
        cookieName: GOOGLE_OAUTH_STATE_COOKIE,
        statePrefix: "",
    });
}
