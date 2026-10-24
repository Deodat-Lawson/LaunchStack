/**
 * OpenRouter's return leg. Verifies the flow cookie (state, and the workspace
 * it started in) and the admin's permission, trades the code for a key, and
 * stores it. A workspace that was already on OpenRouter keeps its chosen
 * models; otherwise none is chosen yet, so nothing switches over until an
 * admin picks one in Settings › Models.
 *
 * Every exit is a redirect back to Settings › Models with an `openrouter=`
 * code the page turns into a message: this runs as a top-level navigation,
 * where a JSON error would strand the admin on a blank page.
 */

import { NextResponse } from "next/server";

import { MissingSecretsKeyError, timingSafeStringEqual } from "@launchstack/store/crypto";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { publicOrigin } from "~/server/public-origin";
import {
    OPENROUTER_BASE_URL,
    OPENROUTER_CALLBACK_PATH,
    OPENROUTER_COOKIE,
    OpenRouterExchangeError,
    decodeFlowCookie,
    exchangeOpenRouterCode,
} from "~/server/workspace-models/openrouter";
import { invalidateWorkspaceChatModels } from "~/server/workspace-models/scope";
import { getWorkspaceEndpointRow, saveWorkspaceEndpoint } from "~/server/workspace-models/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Outcome = "connected" | "denied" | "expired" | "unavailable" | "error";

function backToSettings(request: Request, outcome: Outcome): NextResponse {
    const url = new URL("/employer/documents", publicOrigin(request));
    url.searchParams.set("feature", "settings");
    url.searchParams.set("openrouter", outcome);
    url.hash = "models";
    const response = NextResponse.redirect(url);
    response.cookies.set(OPENROUTER_COOKIE, "", { path: OPENROUTER_CALLBACK_PATH, maxAge: 0 });
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

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const code = params.get("code");
    if (!code) return backToSettings(request, "denied");

    const flow = decodeFlowCookie(readCookie(request, OPENROUTER_COOKIE));
    const state = params.get("state") ?? "";
    if (!flow || !timingSafeStringEqual(flow.s, state)) return backToSettings(request, "expired");

    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return backToSettings(request, "error");
    if (ctx.data.companyId.toString() !== flow.c) return backToSettings(request, "expired");

    let key: string;
    try {
        key = await exchangeOpenRouterCode(code, flow.v);
    } catch (error) {
        console.error(
            "[settings/models/workspace/openrouter] code exchange failed:",
            error instanceof OpenRouterExchangeError ? error.message : error
        );
        return backToSettings(request, "error");
    }

    const existing = await getWorkspaceEndpointRow(ctx.data.companyId);
    try {
        await saveWorkspaceEndpoint({
            companyId: ctx.data.companyId,
            userId: ctx.data.userPk,
            provider: "openrouter",
            baseUrl: OPENROUTER_BASE_URL,
            apiKey: key,
            models: existing?.baseUrl === OPENROUTER_BASE_URL ? (existing.models ?? null) : null,
            connectedVia: "openrouter",
        });
    } catch (error) {
        if (error instanceof MissingSecretsKeyError) return backToSettings(request, "unavailable");
        throw error;
    }
    invalidateWorkspaceChatModels(ctx.data.companyId);
    return backToSettings(request, "connected");
}
