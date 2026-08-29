import { NextResponse } from "next/server";
import { searchWikiLinkCandidates } from "~/server/notes/wiki-links";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { searchParams } = new URL(request.url);
    const title = searchParams.get("title") ?? "";
    if (!title.trim()) {
      return NextResponse.json({ candidates: [] }, { status: 200 });
    }

    const companyId = String(ctx.data.companyId);
    const candidates = await searchWikiLinkCandidates(title, {
      companyId,
      userId: ctx.data.authUserId,
      limit: 10,
    });

    return NextResponse.json({ candidates }, { status: 200 });
  } catch (err) {
    console.error("[/api/notes/resolve] failed:", err);
    return NextResponse.json({ error: "Resolve failed" }, { status: 500 });
  }
}
