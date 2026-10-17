/**
 * Start "Connect OpenRouter": send the admin to openrouter.ai to approve a key
 * for this workspace. See `~/server/workspace-models/openrouter`.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    OPENROUTER_CALLBACK_PATH,
    OPENROUTER_COOKIE,
    OPENROUTER_COOKIE_MAX_AGE,
    appOrigin,
    createPkceFlow,
    encodeFlowCookie,
    openRouterAuthorizeUrl,
} from "~/server/workspace-models/openrouter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;

    const origin = appOrigin(request);
    const flow = createPkceFlow();
    const response = NextResponse.redirect(
        openRouterAuthorizeUrl(flow, new URL(OPENROUTER_CALLBACK_PATH, origin).toString())
    );
    response.cookies.set(
        OPENROUTER_COOKIE,
        encodeFlowCookie({ v: flow.verifier, s: flow.state, c: ctx.data.companyId.toString() }),
        {
            httpOnly: true,
            sameSite: "lax",
            secure: origin.startsWith("https:"),
            path: OPENROUTER_CALLBACK_PATH,
            maxAge: OPENROUTER_COOKIE_MAX_AGE,
        }
    );
    return response;
}
