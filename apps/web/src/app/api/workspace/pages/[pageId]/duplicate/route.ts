import { NextResponse } from "next/server";

import { duplicatePage, serializePage } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

/** Deep-copy a page and everything under it. */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const page = await duplicatePage(session.userId, session.companyId, pageId);
        if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        return NextResponse.json({ page: serializePage(page) }, { status: 201 });
    } catch (error) {
        console.error("[workspace/pages/:id/duplicate] failed:", error);
        return NextResponse.json({ error: "Failed to duplicate page" }, { status: 500 });
    }
}
