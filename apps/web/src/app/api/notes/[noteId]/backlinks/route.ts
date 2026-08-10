import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db } from "~/server/db";
import { documentNotes, noteLinks } from "~/server/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

/**
 * Incoming references for a note. Returns the source note's id + title +
 * snippet so the Backlinks panel can render compact cards. Both ends are
 * scoped to the requester and the active workspace: the target note must be
 * theirs to read, and source notes from another workspace stay hidden.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { noteId } = await params;
    const id = parseInt(noteId, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
    }

    const companyIdStr = String(ctx.data.companyId);
    const inWorkspace = or(
      eq(documentNotes.companyId, companyIdStr),
      isNull(documentNotes.companyId),
    )!;

    const [target] = await db
      .select({ id: documentNotes.id })
      .from(documentNotes)
      .where(
        and(
          eq(documentNotes.id, id),
          eq(documentNotes.userId, ctx.data.clerkUserId),
          inWorkspace,
        ),
      );

    if (!target) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
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
          eq(documentNotes.userId, ctx.data.clerkUserId),
          inWorkspace,
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
