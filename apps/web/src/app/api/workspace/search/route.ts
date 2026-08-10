import { NextResponse } from "next/server";

import { searchPages } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

/** Quick Find. An empty query returns recently-edited pages. */
export async function GET(request: Request) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const query = url.searchParams.get("q") ?? "";
        const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
        const limit = Number.isNaN(limitParam) ? 25 : Math.min(Math.max(limitParam, 1), 100);

        const results = await searchPages(session.userId, query, limit);

        return NextResponse.json({ results }, { status: 200 });
    } catch (error) {
        console.error("[workspace/search] failed:", error);
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
}
