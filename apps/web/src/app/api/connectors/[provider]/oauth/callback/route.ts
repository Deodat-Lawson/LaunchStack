/**
 * OAuth return leg. Session-gated: the Clerk `__session` cookie is
 * SameSite=Lax, so it rides along on the provider's top-level GET redirect —
 * no middleware allowlist entry is needed. The state must verify (HMAC +
 * TTL), match the nonce cookie, AND name the signed-in user — three separate
 * forgeries required to bind someone else's account to a workspace.
 *
 * Every exit is a redirect back to the documents workspace with
 * `connector=` / `result=` queries the UI turns into a toast; OAuth
 * callbacks render in a top-level navigation, so JSON errors would strand
 * the user on a blank page.
 */

import { NextResponse } from "next/server";

import { createDriveClient } from "@launchstack/pipelines/connectors/google-drive";
import { timingSafeStringEqual } from "@launchstack/store/crypto";

import { isConnectorProvider, type ConnectorProvider } from "~/server/db/schema/connectors";
import { getConnectorConfig, PROVIDER_MODULES } from "~/server/services/connectors/config";
import { upsertConnection } from "~/server/services/connectors/connection-store";
import { ensureSyncState } from "~/server/services/connectors/google-drive/store";
import { oauthNonceCookieName, verifyState } from "~/server/services/connectors/oauth-state";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

function backToDocuments(
    request: Request,
    provider: ConnectorProvider | null,
    result: string
): NextResponse {
    const url = new URL("/employer/documents", new URL(request.url).origin);
    if (provider) url.searchParams.set("connector", provider);
    url.searchParams.set("result", result);
    const response = NextResponse.redirect(url);
    if (provider) response.cookies.delete(oauthNonceCookieName(provider));
    return response;
}

function readCookie(request: Request, name: string): string | null {
    const header = request.headers.get("cookie") ?? "";
    for (const part of header.split(";")) {
        const [key, ...rest] = part.trim().split("=");
        if (key === name) return decodeURIComponent(rest.join("="));
    }
    return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    const { provider } = await params;
    if (!isConnectorProvider(provider)) {
        return backToDocuments(request, null, "error");
    }

    const { searchParams } = new URL(request.url);

    if (searchParams.get("error")) {
        // The user clicked "cancel" on the consent screen. Not an error state.
        return backToDocuments(request, provider, "denied");
    }

    const guard = await requireConnectorAdmin();
    if (!guard.ok) return backToDocuments(request, provider, "error");

    const code = searchParams.get("code");
    const stateParam = searchParams.get("state");
    if (!code || !stateParam) return backToDocuments(request, provider, "error");

    const state = verifyState(stateParam);
    if (!state || state.provider !== provider) {
        return backToDocuments(request, provider, "error");
    }

    const cookieNonce = readCookie(request, oauthNonceCookieName(provider));
    if (!cookieNonce || !timingSafeStringEqual(cookieNonce, state.nonce)) {
        return backToDocuments(request, provider, "error");
    }
    if (
        state.companyId !== guard.ctx.companyId.toString() ||
        state.userPk !== Number(guard.ctx.userPk)
    ) {
        return backToDocuments(request, provider, "error");
    }

    const config = getConnectorConfig(provider, new URL(request.url).origin);
    if (!config) return backToDocuments(request, provider, "error");

    try {
        const grant = await PROVIDER_MODULES[provider].exchangeCode(config, code);

        const connection = await upsertConnection({
            companyId: guard.ctx.companyId,
            provider,
            grantedByUserPk: Number(guard.ctx.userPk),
            grant,
        });

        if (provider === "google-drive") {
            // Seed the changes-feed cursor now so the first sync's dirty-check
            // starts from the moment of connection, not from a fabricated past.
            const client = createDriveClient({ accessToken: grant.accessToken });
            await ensureSyncState(connection.id, await client.getStartPageToken());
        }

        return backToDocuments(request, provider, "connected");
    } catch (error) {
        console.error(`[connectors] ${provider} OAuth callback failed:`, error);
        return backToDocuments(request, provider, "error");
    }
}
