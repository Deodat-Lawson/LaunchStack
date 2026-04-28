import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { documentNotes, noteLinks } from "@launchstack/core/db/schema";

/**
 * Incoming references for a note. Returns the source note's id + title +
 * snippet so the Backlinks panel can render compact cards. Filtered by the
 * requester's `userId` on the *source* note to avoid surfacing other users'
 * notes that happen to have linked here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { noteId } = await params;
    const id = parseInt(noteId, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
    }

    const rows = await db
      .select({
        sourceNoteId: noteLinks.sourceNoteId,
        sourceTitle: documentNotes.title,
        sourceMarkdown: documentNotes.contentMarkdown,
        sourceDocumentId: documentNotes.documentId,
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
          eq(noteLinks.targetNoteId, id),
          eq(documentNotes.userId, userId),
        ),
      )
      .orderBy(desc(noteLinks.createdAt));

    const incoming = rows.map((r) => ({
      sourceNoteId: r.sourceNoteId,
      title: r.sourceTitle,
      snippet: snippetOf(r.sourceMarkdown),
      sourceDocumentId: r.sourceDocumentId,
      linkedAs: r.targetTitle,
    }));

    return NextResponse.json({ incoming }, { status: 200 });
  } catch (err) {
    console.error("[/api/notes/:id/backlinks] failed:", err);
    return NextResponse.json({ error: "Backlinks failed" }, { status: 500 });
  }
}

function snippetOf(md: string | null): string {
  if (!md) return "";
  const t = md.trim();
  return t.length > 200 ? t.slice(0, 200) + "…" : t;
}
