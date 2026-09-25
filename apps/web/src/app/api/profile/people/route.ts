/**
 * How a set of people appear in the active workspace — for surfaces that
 * learn who is involved from a stream (meeting transcripts) rather than from
 * a list endpoint that could attach it server-side.
 *
 * GET ?ids=<authUserId>,<authUserId>… → { people: { [authUserId]: PersonLook } }
 *
 * Only current members of the active workspace come back: an id someone
 * picked up elsewhere reveals nothing about a person outside it. Emails are
 * blanked unless the caller may view the member list.
 */

import { NextResponse } from "next/server";

import type { PersonLook } from "~/lib/profile/resolve";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { LOOKS_MAX_IDS, workspaceLooks } from "~/server/profile/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const ids = (new URL(request.url).searchParams.get("ids") ?? "")
        .split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0 && id.length <= 256);
    if (ids.length > LOOKS_MAX_IDS) {
        return NextResponse.json(
            { error: `Ask for at most ${LOOKS_MAX_IDS} people at once.` },
            { status: 400 }
        );
    }

    try {
        const looks = await workspaceLooks(ctx.data.companyId, ids);
        const showEmail = ctx.data.can("members.view");
        const people: Record<string, PersonLook> = {};
        for (const [id, look] of looks) {
            if (!look.member) continue;
            people[id] = showEmail ? look : { ...look, email: "" };
        }
        return NextResponse.json({ people });
    } catch (error) {
        console.error("[profile/people GET] failed:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
