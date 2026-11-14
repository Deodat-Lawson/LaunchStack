/**
 * GET /api/connectors/microsoft/oauth/start
 *
 * Two Microsoft 365 products share this door, told apart by `?provider=`:
 *
 * - (default) `microsoft-365`: workspace-scoped. A `connectors.manage`
 *   holder grants read access to OneDrive and SharePoint files for the whole
 *   workspace.
 * - `outlook`: per-user. Any `documents.upload` holder grants Mail.Read for
 *   their own mailbox; the connection belongs to them, and the mail lands in
 *   a folder only they can see.
 *
 * Both redirect to Microsoft's consent screen. CSRF: a random nonce goes into
 * both the OAuth `state` and a short-lived Lax cookie; the callback requires
 * them to match. The Outlook state carries a prefix so the shared callback
 * can tell the flows apart before it reads either cookie. The session
 * survives the round trip (top-level navigation, Lax cookies are sent), so
 * the callback runs with full workspace context.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { publicOrigin } from "~/server/public-origin";
import {
    getMicrosoftOAuthApp,
    getMicrosoftRedirectUrl,
    isMicrosoft365ConnectorConfigured,
    isOutlookConnectorConfigured,
    MICROSOFT_365_OAUTH_STATE_COOKIE,
    MICROSOFT_365_SCOPES,
    OUTLOOK_OAUTH_STATE_COOKIE,
    OUTLOOK_SCOPES,
    OUTLOOK_STATE_PREFIX,
} from "~/server/services/microsoft/config";
import { buildMicrosoftAuthorizationUrl } from "~/server/services/microsoft/oauth";

function redirectToConsent(
    request: Request,
    input: { scopes: string[]; cookieName: string; statePrefix: string }
): NextResponse {
    const nonce = randomUUID();
    const url = buildMicrosoftAuthorizationUrl({
        clientId: getMicrosoftOAuthApp().clientId,
        redirectUri: getMicrosoftRedirectUrl(publicOrigin(request)),
        scopes: input.scopes,
        state: `${input.statePrefix}${nonce}`,
    });

    const response = NextResponse.redirect(url);
    response.cookies.set(input.cookieName, nonce, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        maxAge: 600,
        path: "/api/connectors/microsoft",
    });
    return response;
}

export async function GET(request: Request) {
    const provider = new URL(request.url).searchParams.get("provider");

    if (provider === "outlook") {
        if (!isOutlookConnectorConfigured()) {
            return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
        }
        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;
        return redirectToConsent(request, {
            scopes: OUTLOOK_SCOPES,
            cookieName: OUTLOOK_OAUTH_STATE_COOKIE,
            statePrefix: OUTLOOK_STATE_PREFIX,
        });
    }

    if (!isMicrosoft365ConnectorConfigured()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }
    const ctx = await requireWorkspacePermission("connectors.manage");
    if (!ctx.success) return ctx.response;
    return redirectToConsent(request, {
        scopes: MICROSOFT_365_SCOPES,
        cookieName: MICROSOFT_365_OAUTH_STATE_COOKIE,
        statePrefix: "",
    });
}
