import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { searchNotes, type NoteSearchScope } from "~/server/notes/search";

interface Body {
  query?: string;
  scope?: NoteSearchScope;
  documentId?: string;
  companyId?: string;
  topK?: number;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const query = (body.query ?? "").trim();
    if (!query) {
      return NextResponse.json({ hits: [] }, { status: 200 });
    }

    const scope: NoteSearchScope = body.scope ?? "user";
    const topK = Math.min(Math.max(body.topK ?? 8, 1), 25);

    const hits = await searchNotes({
      userId,
      query,
      scope,
      documentId: body.documentId,
      companyId: body.companyId,
      topK,
    });

    return NextResponse.json({ hits }, { status: 200 });
  } catch (err) {
    console.error("[/api/notes/search] failed:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
