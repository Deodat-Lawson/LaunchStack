/**
 * Start "Connect OpenRouter": send the admin to openrouter.ai to approve a key
 * for this workspace. See `~/server/workspace-models/openrouter`.
 */

import { NextResponse } from "next/server";

import { env } from "~/env";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { workspaceHref } from "~/lib/settings/surfaces";
import { publicOrigin } from "~/server/public-origin";
import {
    OPENROUTER_CALLBACK_PATH,
    OPENROUTER_COOKIE,
    OPENROUTER_COOKIE_MAX_AGE,
    createPkceFlow,
    encodeFlowCookie,
    openRouterAuthorizeUrl,
} from "~/server/workspace-models/openrouter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;

    // Where the admin's browser comes back to: the public origin, never
    // APP_PUBLIC_URL (the address the app's own services use, which may be
    // internal) nor `request.url` (the bind address behind the proxy).
    const origin = publicOrigin(request);

    // Without a key to seal it with, the server could not keep what OpenRouter
    // hands back; say so before sending the admin away to approve one.
    if (!env.server.EMBEDDING_SECRETS_KEY) {
        const back = new URL(
            workspaceHref("byok", { query: { openrouter: "unavailable" } }),
            origin
        );
        return NextResponse.redirect(back);
    }

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
