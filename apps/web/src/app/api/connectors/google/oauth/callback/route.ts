/**
 * GET /api/connectors/google/oauth/callback — Leg 0, second half.
 *
 * Google redirects here with ?code&state. The state must match the nonce
 * cookie set by /start, the code is exchanged for tokens, and the connection
 * is stored — workspace-scoped for Drive, owned by the member for Gmail (the
 * `gmail.` state prefix picks the flow). Ends in a redirect back to the
 * documents workspace with a query flag the UI turns into a toast.
 */
import { NextResponse } from "next/server";

import { decodeIdTokenClaims, exchangeAuthorizationCode } from "@launchstack/google-drive";

import { db } from "~/server/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import {
    GMAIL_OAUTH_STATE_COOKIE,
    GMAIL_READONLY_SCOPE,
    GMAIL_SCOPES,
    GMAIL_STATE_PREFIX,
    isGmailConnectorConfigured,
} from "~/server/services/connectors/gmail/config";
import {
    GmailAccountClaimedError,
    upsertGmailConnection,
} from "~/server/services/connectors/gmail/connections";
import { ensurePrivateGmailFolder } from "~/server/services/connectors/gmail/folder";
import { ensureSyncState as ensureGmailSyncState } from "~/server/services/connectors/gmail/store";
import {
    GOOGLE_DRIVE_SCOPES,
    GOOGLE_OAUTH_STATE_COOKIE,
    getGoogleOAuthApp,
    getOAuthRedirectUrl,
    isGoogleConnectConfigured,
} from "~/server/services/google-drive/config";
import { upsertGoogleConnection } from "~/server/services/google-drive/connections";

type Provider = "google-drive" | "gmail";

/**
 * Lands on the shared connector return leg (`?connector=&result=`) so the
 * workspace shell reopens the provider's panel and toasts the outcome — the
 * same path the Slack/GitHub callbacks take.
 */
function redirectToWorkspace(request: Request, provider: Provider, flag: string): NextResponse {
    const result = flag === "connected" ? "connected" : flag === "cancelled" ? "denied" : "error";
    const response = NextResponse.redirect(
        new URL(`/employer/documents?connector=${provider}&result=${result}`, request.url)
    );
    response.cookies.delete(
        provider === "gmail" ? GMAIL_OAUTH_STATE_COOKIE : GOOGLE_OAUTH_STATE_COOKIE
    );
    return response;
}

function readCookie(header: string, name: string): string | undefined {
    return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header)?.[1];
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (state?.startsWith(GMAIL_STATE_PREFIX)) return gmailCallback(request, url, state);
    return driveCallback(request, url, state);
}

// ---------------------------------------------------------------------------
// Google Drive — workspace-scoped
// ---------------------------------------------------------------------------

async function driveCallback(request: Request, url: URL, state: string | null) {
    if (!isGoogleConnectConfigured()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    // A browser redirect, not an API call: a missing permission lands on the
    // workspace with a toast rather than a JSON 403.
    if (!ctx.data.can("connectors.manage")) {
        return redirectToWorkspace(request, "google-drive", "forbidden");
    }

    if (url.searchParams.get("error")) {
        // The user clicked "cancel" on the consent screen — not an error.
        return redirectToWorkspace(request, "google-drive", "cancelled");
    }

    const code = url.searchParams.get("code");
    const nonce = readCookie(request.headers.get("cookie") ?? "", GOOGLE_OAUTH_STATE_COOKIE);

    if (!code || !state || !nonce || state !== nonce) {
        console.warn("[google-oauth] state mismatch or missing code — rejecting callback");
        return redirectToWorkspace(request, "google-drive", "error");
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
            return redirectToWorkspace(request, "google-drive", "error");
        }

        const claims = token.id_token ? decodeIdTokenClaims(token.id_token) : {};
        const accountId = claims.sub ?? claims.email;
        if (!accountId) {
            console.error("[google-oauth] no account identity in the token response");
            return redirectToWorkspace(request, "google-drive", "error");
        }

        const connection = await upsertGoogleConnection({
            companyId: BigInt(ctx.data.companyId),
            grantedByUserId: ctx.data.userPk,
            providerAccountId: accountId,
            providerAccountEmail: claims.email ?? null,
            refreshToken: token.refresh_token,
            scopes: token.scope ?? GOOGLE_DRIVE_SCOPES.join(" "),
        });

        await recordAuditEvent(db, {
            companyId: ctx.data.companyId,
            actorUserId: ctx.data.authUserId,
            action: "connector.connected",
            targetType: "connector",
            targetId: "google-drive",
            detail: { connectionId: connection.id, accountEmail: claims.email ?? null },
        });

        return redirectToWorkspace(request, "google-drive", "connected");
    } catch (err) {
        console.error("[google-oauth] callback failed:", err);
        return redirectToWorkspace(request, "google-drive", "error");
    }
}

// ---------------------------------------------------------------------------
// Gmail — owned by the member
// ---------------------------------------------------------------------------

async function gmailCallback(request: Request, url: URL, state: string) {
    if (!isGmailConnectorConfigured()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    if (!ctx.data.can("documents.upload")) {
        return redirectToWorkspace(request, "gmail", "forbidden");
    }

    if (url.searchParams.get("error")) {
        return redirectToWorkspace(request, "gmail", "cancelled");
    }

    const code = url.searchParams.get("code");
    const nonce = readCookie(request.headers.get("cookie") ?? "", GMAIL_OAUTH_STATE_COOKIE);

    if (!code || !nonce || state !== `${GMAIL_STATE_PREFIX}${nonce}`) {
        console.warn("[gmail-oauth] state mismatch or missing code — rejecting callback");
        return redirectToWorkspace(request, "gmail", "error");
    }

    try {
        const token = await exchangeAuthorizationCode({
            app: getGoogleOAuthApp(),
            code,
            redirectUri: getOAuthRedirectUrl(url.origin),
        });

        if (!token.refresh_token) {
            console.error("[gmail-oauth] token exchange returned no refresh_token");
            return redirectToWorkspace(request, "gmail", "error");
        }

        // Google lets people untick individual scopes on the consent screen.
        // A grant without mail access is not a connection.
        const granted = (token.scope ?? "").split(/\s+/);
        if (!granted.includes(GMAIL_READONLY_SCOPE)) {
            console.warn("[gmail-oauth] consent granted without gmail.readonly — refusing");
            return redirectToWorkspace(request, "gmail", "error");
        }

        const claims = token.id_token ? decodeIdTokenClaims(token.id_token) : {};
        const accountId = claims.sub ?? claims.email;
        if (!accountId) {
            console.error("[gmail-oauth] no account identity in the token response");
            return redirectToWorkspace(request, "gmail", "error");
        }

        const { connection } = await upsertGmailConnection({
            companyId: ctx.data.companyId,
            ownerUserId: ctx.data.userPk,
            providerAccountId: accountId,
            providerAccountEmail: claims.email ?? null,
            refreshToken: token.refresh_token,
            scopes: token.scope ?? GMAIL_SCOPES.join(" "),
        });
        await ensureGmailSyncState(connection.id);
        // The private folder exists from the moment of connecting, so the
        // member sees where their mail will land before anything syncs.
        await ensurePrivateGmailFolder({
            companyId: ctx.data.companyId,
            ownerUserPk: ctx.data.userPk,
            ownerAuthUserId: ctx.data.authUserId,
            accountEmail: claims.email ?? accountId,
        });

        await recordAuditEvent(db, {
            companyId: ctx.data.companyId,
            actorUserId: ctx.data.authUserId,
            action: "connector.connected",
            targetType: "connector",
            targetId: "gmail",
            detail: { connectionId: connection.id, accountEmail: claims.email ?? null },
        });

        return redirectToWorkspace(request, "gmail", "connected");
    } catch (err) {
        if (err instanceof GmailAccountClaimedError) {
            console.warn(`[gmail-oauth] ${err.message}`);
        } else {
            console.error("[gmail-oauth] callback failed:", err);
        }
        return redirectToWorkspace(request, "gmail", "error");
    }
}
