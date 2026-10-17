/**
 * Records which workspace an assistant's OAuth connection is for — the
 * /oauth/workspace screen posts here, then resumes the flow. better-auth reads
 * the choice back (keyed by this browser session and this authorization
 * request) when it asks which workspace the consent and token belong to.
 * See ~/server/mcp/oauth-workspace.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerSession } from "~/server/auth";
import { db } from "~/server/db";
import { activeWorkspaceOptions } from "~/server/mcp/connect-request";
import { flowKeyOf, recordWorkspaceChoice } from "~/server/mcp/oauth-workspace";

const Body = z.object({
    companyId: z.string().regex(/^\d+$/),
    /** The picker page's query string: the authorization request this pick is for. */
    oauthQuery: z.string().max(8192),
});

export async function POST(request: Request) {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // JSON only: a cross-site form can post text/plain with a session cookie
    // attached, but cannot send application/json without a CORS preflight.
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    }
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Pick a workspace" }, { status: 400 });
    const { companyId, oauthQuery } = parsed.data;
    const flowKey = flowKeyOf(oauthQuery);
    if (!flowKey)
        return NextResponse.json(
            { error: "Start connecting again from your assistant" },
            { status: 400 }
        );
    const options = await activeWorkspaceOptions(session.user.id);
    if (!options.some(o => o.id === companyId)) {
        return NextResponse.json(
            { error: "You're not an active member of that workspace" },
            { status: 403 }
        );
    }
    await recordWorkspaceChoice(db, session.session.id, flowKey, BigInt(companyId));
    return NextResponse.json({ ok: true });
}
