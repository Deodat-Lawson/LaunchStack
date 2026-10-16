/**
 * Records which workspace an assistant's OAuth connection is for — the
 * /oauth/workspace screen posts here, then resumes the flow. better-auth reads
 * the choice back (keyed by this browser session) when it asks which
 * workspace the consent and token belong to. See ~/server/mcp/oauth-workspace.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerSession } from "~/server/auth";
import { db } from "~/server/db";
import { activeWorkspaceOptions } from "~/server/mcp/connect-request";
import { recordWorkspaceChoice } from "~/server/mcp/oauth-workspace";

const Body = z.object({ companyId: z.string().regex(/^\d+$/) });

export async function POST(request: Request) {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Pick a workspace" }, { status: 400 });
    const { companyId } = parsed.data;
    const options = await activeWorkspaceOptions(session.user.id);
    if (!options.some(o => o.id === companyId)) {
        return NextResponse.json(
            { error: "You're not an active member of that workspace" },
            { status: 403 }
        );
    }
    await recordWorkspaceChoice(db, session.session.id, BigInt(companyId));
    return NextResponse.json({ ok: true });
}
