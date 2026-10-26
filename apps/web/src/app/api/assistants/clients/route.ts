/**
 * OAuth clients for assistants that need manual OAuth setup (Gemini
 * Enterprise asks an admin for a client ID, a secret and the endpoints).
 *
 * GET — `settings.manage`. This workspace's hand-made clients, plus the
 * server URL and the endpoints an admin pastes into the assistant.
 * Clients stay listed (and deletable) while the MCP server is off.
 * POST `{ name, redirectUris, authMethod }` — `settings.manage`. Creates a
 * confidential client owned by this workspace; the secret is in this
 * response and nowhere else, ever.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { mcpAvailability } from "~/server/mcp/config";
import {
    GEMINI_ENTERPRISE_REDIRECT_URI,
    MANUAL_CLIENT_AUTH_METHODS,
    OAUTH_CLIENT_NAME_MAX,
    OAUTH_CLIENT_REDIRECTS_MAX,
    OAuthClientInputError,
    OAuthClientLimitError,
    createManualClient,
    listManualClients,
    oauthEndpoints,
} from "~/server/mcp/oauth-clients";
import { parseJsonBody } from "~/server/workspace/http";
import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { wordEnglish } from "~/i18n/translate";
import { V } from "~/i18n/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateClientSchema = z.object({
    name: z.string().trim().min(1, V.clientNameRequired).max(OAUTH_CLIENT_NAME_MAX),
    redirectUris: z
        .array(
            z
                .string()
                .trim()
                .url(V.redirectUriFullUrl)
                .refine(uri => uri.startsWith("https://"), V.redirectUriHttps)
        )
        .min(1, V.redirectUriRequired)
        .max(OAUTH_CLIENT_REDIRECTS_MAX),
    authMethod: z.enum(MANUAL_CLIENT_AUTH_METHODS).optional(),
});

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;
        try {
            const availability = mcpAvailability();
            const clients = await listManualClients({ companyId: ctx.data.companyId });
            return NextResponse.json({
                availability: availability.enabled
                    ? { enabled: true, serverUrl: availability.resource }
                    : { enabled: false, reason: availability.reason },
                endpoints: availability.enabled ? oauthEndpoints(availability.origin) : null,
                // Prefills the create form; most clients made here are for it.
                suggestedRedirectUri: GEMINI_ENTERPRISE_REDIRECT_URI,
                clients,
            });
        } catch (error) {
            console.error("[assistants clients GET] failed:", error);
            return NextResponse.json(
                {
                    error: requestTranslator(
                        request,
                        "settings.server.errors"
                    )("oauthClientsLoadFailed"),
                },
                { status: 500 }
            );
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;
        const body = await parseJsonBody(request, CreateClientSchema);
        if (!body.success) return body.response;

        const t = requestTranslator(request, "settings.server.errors");
        const availability = mcpAvailability();
        if (!availability.enabled) {
            return NextResponse.json({ error: t("assistantServerOffSignIn") }, { status: 409 });
        }

        try {
            const { client, clientSecret } = await createManualClient({
                headers: new Headers(request.headers),
                companyId: ctx.data.companyId,
                name: body.data.name,
                redirectUris: body.data.redirectUris,
                authMethod: body.data.authMethod ?? "client_secret_post",
            });
            return NextResponse.json(
                {
                    client,
                    clientSecret,
                    serverUrl: availability.resource,
                    endpoints: oauthEndpoints(availability.origin),
                },
                { status: 201 }
            );
        } catch (error) {
            if (error instanceof OAuthClientInputError) {
                return NextResponse.json({ error: error.message }, { status: 400 });
            }
            if (error instanceof OAuthClientLimitError) {
                const words = wordEnglish(
                    error.message,
                    "settings.server.errors",
                    localeOfRequest(request)
                );
                return NextResponse.json({ error: words }, { status: 409 });
            }
            console.error("[assistants clients POST] failed:", error);
            return NextResponse.json({ error: t("oauthClientCreateFailed") }, { status: 500 });
        }
    });
}
