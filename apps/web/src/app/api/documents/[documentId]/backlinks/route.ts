import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { documentNotes, noteLinks } from "@launchstack/core/db/schema";

/**
 * Notes that reference this document via `[[Document Title]]`. Filtered by
 * the requester's `userId` on the source note so we only show what they own.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json(
        { error: "Invalid document id" },
        { status: 400 },
      );
    }

    const rows = await db
      .select({
        sourceNoteId: noteLinks.sourceNoteId,
        sourceTitle: documentNotes.title,
        sourceMarkdown: documentNotes.contentMarkdown,
        targetTitle: noteLinks.targetTitle,
        createdAt: noteLinks.createdAt,
      })
      .from(noteLinks)
      .innerJoin(
        documentNotes,
        eq(documentNotes.id, noteLinks.sourceNoteId),
      )
      .where(
        and(
          eq(noteLinks.targetDocumentId, documentId),
          eq(documentNotes.userId, userId),
        ),
      )
      .orderBy(desc(noteLinks.createdAt));

    const incoming = rows.map((r) => ({
      sourceNoteId: r.sourceNoteId,
      title: r.sourceTitle,
      snippet: snippetOf(r.sourceMarkdown),
      linkedAs: r.targetTitle,
    }));

    return NextResponse.json({ incoming }, { status: 200 });
  } catch (err) {
    console.error("[/api/documents/:id/backlinks] failed:", err);
    return NextResponse.json({ error: "Backlinks failed" }, { status: 500 });
  }
}

function snippetOf(md: string | null): string {
  if (!md) return "";
  const t = md.trim();
  return t.length > 200 ? t.slice(0, 200) + "…" : t;
}
