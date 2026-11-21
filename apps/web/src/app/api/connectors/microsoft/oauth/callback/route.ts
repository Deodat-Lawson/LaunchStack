/**
 * GET /api/connectors/microsoft/oauth/callback
 *
 * Microsoft redirects here with ?code&state. The state must match the nonce
 * cookie set by /start, the code is exchanged for tokens, and the connection
 * is stored: workspace-scoped for Microsoft 365 files, owned by the member
 * for Outlook (the `outlook.` state prefix picks the flow). Ends in a
 * redirect back to the documents workspace with a query flag the UI turns
 * into a toast.
 */
import { NextResponse } from "next/server";

import { recordAuditEvent } from "~/lib/authz/audit";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { inngest } from "~/server/inngest/client";
import { publicOrigin } from "~/server/public-origin";
import {
    ensureSyncState as ensureMicrosoft365SyncState,
    listPickedItems,
} from "~/server/services/connectors/microsoft-365/store";
import { ensurePrivateOutlookFolder } from "~/server/services/connectors/outlook/folder";
import {
    ensureSyncState as ensureOutlookSyncState,
    resetSyncState as resetOutlookSyncState,
} from "~/server/services/connectors/outlook/store";
import {
    FILES_READ_SCOPE,
    getMicrosoftOAuthApp,
    getMicrosoftRedirectUrl,
    grantIncludes,
    isMicrosoft365ConnectorConfigured,
    isOutlookConnectorConfigured,
    MAIL_READ_SCOPE,
    MICROSOFT_365_OAUTH_STATE_COOKIE,
    MICROSOFT_365_SCOPES,
    OUTLOOK_OAUTH_STATE_COOKIE,
    OUTLOOK_SCOPES,
    OUTLOOK_STATE_PREFIX,
    type MicrosoftProvider,
} from "~/server/services/microsoft/config";
import {
    OutlookAccountClaimedError,
    upsertMicrosoft365Connection,
    upsertOutlookConnection,
} from "~/server/services/microsoft/connections";
import {
    decodeMicrosoftIdToken,
    exchangeMicrosoftCode,
    microsoftAccountId,
} from "~/server/services/microsoft/oauth";

/**
 * Lands on the shared connector return leg (`?connector=&result=`) so the
 * workspace shell reopens the provider's panel and toasts the outcome, the
 * same path every other connector's callback takes.
 */
function redirectToWorkspace(
    request: Request,
    provider: MicrosoftProvider,
    flag: "connected" | "cancelled" | "forbidden" | "claimed" | "error"
): NextResponse {
    const result =
        flag === "connected"
            ? "connected"
            : flag === "cancelled"
              ? "denied"
              : flag === "claimed"
                ? "claimed"
                : "error";
    const target = new URL("/employer/documents", publicOrigin(request));
    target.searchParams.set("connector", provider);
    target.searchParams.set("result", result);
    const response = NextResponse.redirect(target);
    response.cookies.set(
        provider === "outlook" ? OUTLOOK_OAUTH_STATE_COOKIE : MICROSOFT_365_OAUTH_STATE_COOKIE,
        "",
        { maxAge: 0, path: "/api/connectors/microsoft" }
    );
    return response;
}

function readCookie(header: string, name: string): string | undefined {
    return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header)?.[1];
}

/** Microsoft says `access_denied` when the person cancels, or when an administrator must consent first. */
function consentRefused(url: URL): boolean {
    return Boolean(url.searchParams.get("error"));
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (state?.startsWith(OUTLOOK_STATE_PREFIX)) return outlookCallback(request, url, state);
    return filesCallback(request, url, state);
}

// ---------------------------------------------------------------------------
// Microsoft 365 files: workspace-scoped
// ---------------------------------------------------------------------------

/**
 * A reconnect may be as an account that can open what the last one could
 * not, so start a sync now when something is picked. A runner that is down
 * must not undo a good connect: the cron retries.
 */
async function resyncAfterReconnect(connectionId: number, companyId: bigint | number) {
    try {
        await ensureMicrosoft365SyncState(connectionId);
        if ((await listPickedItems(connectionId)).length === 0) return;
        await inngest.send({
            name: "microsoft-365/sync.requested",
            data: {
                connectionId: String(connectionId),
                companyId: companyId.toString(),
                force: true,
            },
        });
    } catch (err) {
        console.warn("[microsoft-oauth] connected, but the follow-up sync did not start:", err);
    }
}

async function filesCallback(request: Request, url: URL, state: string | null) {
    if (!isMicrosoft365ConnectorConfigured()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    // A browser redirect, not an API call: a missing permission lands on the
    // workspace with a toast rather than a JSON 403.
    if (!ctx.data.can("connectors.manage")) {
        return redirectToWorkspace(request, "microsoft-365", "forbidden");
    }
    if (consentRefused(url)) return redirectToWorkspace(request, "microsoft-365", "cancelled");

    const code = url.searchParams.get("code");
    const nonce = readCookie(request.headers.get("cookie") ?? "", MICROSOFT_365_OAUTH_STATE_COOKIE);
    if (!code || !state || !nonce || state !== nonce) {
        console.warn("[microsoft-oauth] state mismatch or missing code: rejecting callback");
        return redirectToWorkspace(request, "microsoft-365", "error");
    }

    try {
        const token = await exchangeMicrosoftCode({
            app: getMicrosoftOAuthApp(),
            code,
            redirectUri: getMicrosoftRedirectUrl(publicOrigin(request)),
        });

        if (!token.refresh_token) {
            // No offline_access, no background sync: refuse rather than
            // half-connect something that dies within the hour.
            console.error("[microsoft-oauth] token exchange returned no refresh_token");
            return redirectToWorkspace(request, "microsoft-365", "error");
        }
        const scopes = token.scope ?? MICROSOFT_365_SCOPES.join(" ");
        if (!grantIncludes(scopes, FILES_READ_SCOPE)) {
            console.warn("[microsoft-oauth] consent granted without Files.Read.All: refusing");
            return redirectToWorkspace(request, "microsoft-365", "error");
        }

        const claims = token.id_token ? decodeMicrosoftIdToken(token.id_token) : {};
        const accountId = microsoftAccountId(claims);
        if (!accountId) {
            console.error("[microsoft-oauth] no account identity in the token response");
            return redirectToWorkspace(request, "microsoft-365", "error");
        }

        const connection = await upsertMicrosoft365Connection({
            companyId: BigInt(ctx.data.companyId),
            grantedByUserId: ctx.data.userPk,
            providerAccountId: accountId,
            providerAccountEmail: claims.email ?? null,
            refreshToken: token.refresh_token,
            scopes,
        });

        await recordAuditEvent(db, {
            companyId: ctx.data.companyId,
            actorUserId: ctx.data.authUserId,
            action: "connector.connected",
            targetType: "connector",
            targetId: "microsoft-365",
            detail: { connectionId: connection.id, accountEmail: claims.email ?? null },
        });

        await resyncAfterReconnect(connection.id, ctx.data.companyId);
        return redirectToWorkspace(request, "microsoft-365", "connected");
    } catch (err) {
        console.error("[microsoft-oauth] callback failed:", err);
        return redirectToWorkspace(request, "microsoft-365", "error");
    }
}

// ---------------------------------------------------------------------------
// Outlook: owned by the member
// ---------------------------------------------------------------------------

async function outlookCallback(request: Request, url: URL, state: string) {
    if (!isOutlookConnectorConfigured()) {
        return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    if (!ctx.data.can("documents.upload")) {
        return redirectToWorkspace(request, "outlook", "forbidden");
    }
    if (consentRefused(url)) return redirectToWorkspace(request, "outlook", "cancelled");

    const code = url.searchParams.get("code");
    const nonce = readCookie(request.headers.get("cookie") ?? "", OUTLOOK_OAUTH_STATE_COOKIE);
    if (!code || !nonce || state !== `${OUTLOOK_STATE_PREFIX}${nonce}`) {
        console.warn("[outlook-oauth] state mismatch or missing code: rejecting callback");
        return redirectToWorkspace(request, "outlook", "error");
    }

    try {
        const token = await exchangeMicrosoftCode({
            app: getMicrosoftOAuthApp(),
            code,
            redirectUri: getMicrosoftRedirectUrl(publicOrigin(request)),
        });

        if (!token.refresh_token) {
            console.error("[outlook-oauth] token exchange returned no refresh_token");
            return redirectToWorkspace(request, "outlook", "error");
        }
        // A grant without mail access is not a connection.
        const scopes = token.scope ?? OUTLOOK_SCOPES.join(" ");
        if (!grantIncludes(scopes, MAIL_READ_SCOPE)) {
            console.warn("[outlook-oauth] consent granted without Mail.Read: refusing");
            return redirectToWorkspace(request, "outlook", "error");
        }

        const claims = token.id_token ? decodeMicrosoftIdToken(token.id_token) : {};
        const accountId = microsoftAccountId(claims);
        if (!accountId) {
            console.error("[outlook-oauth] no account identity in the token response");
            return redirectToWorkspace(request, "outlook", "error");
        }

        const { connection, mailboxChanged } = await upsertOutlookConnection({
            companyId: ctx.data.companyId,
            ownerUserId: ctx.data.userPk,
            providerAccountId: accountId,
            providerAccountEmail: claims.email ?? null,
            refreshToken: token.refresh_token,
            scopes,
        });
        await ensureOutlookSyncState(connection.id);
        // A different mailbox: the old one's folders and delta links mean nothing here.
        if (mailboxChanged) await resetOutlookSyncState(connection.id);
        // The private folder exists from the moment of connecting, so the
        // member sees where their mail will land before anything syncs.
        await ensurePrivateOutlookFolder({
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
            targetId: "outlook",
            detail: { connectionId: connection.id, accountEmail: claims.email ?? null },
        });

        return redirectToWorkspace(request, "outlook", "connected");
    } catch (err) {
        if (err instanceof OutlookAccountClaimedError) {
            console.warn(`[outlook-oauth] ${err.message}`);
            return redirectToWorkspace(request, "outlook", "claimed");
        }
        console.error("[outlook-oauth] callback failed:", err);
        return redirectToWorkspace(request, "outlook", "error");
    }
}
