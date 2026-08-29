import { NextResponse } from "next/server";
import { searchNotes, type NoteSearchScope } from "~/server/notes/search";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

interface Body {
  query?: string;
  scope?: NoteSearchScope;
  documentId?: string;
  companyId?: string;
  topK?: number;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const body = (await request.json().catch(() => ({}))) as Body;
    const query = (body.query ?? "").trim();
    if (!query) {
      return NextResponse.json({ hits: [] }, { status: 200 });
    }

    const scope: NoteSearchScope = body.scope ?? "user";
    const topK = Math.min(Math.max(body.topK ?? 8, 1), 25);

    const hits = await searchNotes({
      userId: ctx.data.authUserId,
      query,
      scope,
      documentId: body.documentId,
      companyId: String(ctx.data.companyId),
      topK,
    });

    return NextResponse.json({ hits }, { status: 200 });
  } catch (err) {
    console.error("[/api/notes/search] failed:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
