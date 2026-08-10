import { NextResponse } from "next/server";

import { restorePage } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

/** Bring a trashed page (and its subtree) back. */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const ids = await restorePage(session.userId, pageId);
        if (ids.length === 0) {
            return NextResponse.json({ error: "Page not found" }, { status: 404 });
        }

        return NextResponse.json({ restored: ids }, { status: 200 });
    } catch (error) {
        console.error("[workspace/pages/:id/restore] failed:", error);
        return NextResponse.json({ error: "Failed to restore page" }, { status: 500 });
    }
}
