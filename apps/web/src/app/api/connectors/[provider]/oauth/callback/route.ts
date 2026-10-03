/**
 * OAuth return leg for Slack/GitHub (Google Drive has its own at
 * /api/connectors/google/oauth/callback). Session-gated: the auth session
 * cookie is SameSite=Lax, so it rides along on the provider's top-level GET
 * redirect — no middleware allowlist entry is needed. The state must verify
 * (HMAC + TTL), match the nonce cookie, AND name the signed-in user — three
 * separate forgeries required to bind someone else's account to a workspace.
 *
 * Every exit is a redirect back to the documents workspace with
 * `connector=` / `result=` queries the UI turns into a toast; OAuth
 * callbacks render in a top-level navigation, so JSON errors would strand
 * the user on a blank page. LinkedIn is connected from Growth › Brand, so
 * it returns into that tab's Accounts screen, after its Pages have been
 * read and turned into channels.
 */

import { NextResponse } from "next/server";

import { timingSafeStringEqual } from "@launchstack/store/crypto";

import {
    getConnectorConfig,
    isOAuthProvider,
    PROVIDER_MODULES,
    type OAuthProvider,
} from "~/server/services/connectors/config";
import { discoverLinkedInChannels } from "~/server/brand/channels";
import { upsertConnection } from "~/server/services/connectors/connection-store";
import { oauthNonceCookieName, verifyState } from "~/server/services/connectors/oauth-state";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";
import { publicOrigin } from "~/server/public-origin";

export const runtime = "nodejs";

/** LinkedIn returns that Brand › Accounts explains (its CONNECT_PROBLEMS owns the words). */
const LINKEDIN_RETURN_PROBLEMS: ReadonlySet<string> = new Set([
    "denied",
    "error",
    "partial",
    "no-channels",
]);

function backToDocuments(
    request: Request,
    provider: OAuthProvider | null,
    result: string
): NextResponse {
    const url = new URL("/employer/documents", publicOrigin(request));
    if (provider === "linkedin") {
        url.searchParams.set("feature", "growth");
        // A code, never text: a crafted link cannot put words in the app's mouth.
        url.searchParams.set(
            "at",
            LINKEDIN_RETURN_PROBLEMS.has(result)
                ? `/brand/accounts?${new URLSearchParams({ connect: result })}`
                : "/brand/accounts"
        );
    }
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
    if (!isOAuthProvider(provider)) {
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

    const config = getConnectorConfig(provider, publicOrigin(request));
    if (!config) return backToDocuments(request, provider, "error");

    try {
        const grant = await PROVIDER_MODULES[provider].exchangeCode(config, code);

        const connection = await upsertConnection({
            companyId: guard.ctx.companyId,
            provider,
            grantedByUserId: guard.ctx.userPk,
            grant,
        });

        if (provider === "linkedin") {
            // The grant is stored either way; a failed Page read is retried
            // from Accounts ("Refresh Pages"), so it must not lose the sign-in.
            try {
                const channels = await discoverLinkedInChannels(connection);
                if (channels.length === 0) return backToDocuments(request, provider, "no-channels");
            } catch (discoverError) {
                console.error("[connectors] LinkedIn Page discovery failed:", discoverError);
                return backToDocuments(request, provider, "partial");
            }
        }

        return backToDocuments(request, provider, "connected");
    } catch (error) {
        console.error(`[connectors] ${provider} OAuth callback failed:`, error);
        return backToDocuments(request, provider, "error");
    }
}
