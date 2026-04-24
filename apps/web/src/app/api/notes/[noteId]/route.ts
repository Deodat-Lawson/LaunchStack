import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { documentNotes, documentNoteEmbeddings } from "@launchstack/core/db/schema";
import { eq, and } from "drizzle-orm";
import { validateRequestBody, UpdateNoteSchema } from "~/lib/validation";
import { embedNoteAsync } from "~/server/notes/embed-note";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { noteId } = await params;
    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    const [note] = await db
      .select()
      .from(documentNotes)
      .where(and(eq(documentNotes.id, id), eq(documentNotes.userId, userId)));

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ note }, { status: 200 });
  } catch (error) {
    console.error("Error fetching note:", error);
    return NextResponse.json(
      { error: "Failed to fetch note" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { noteId } = await params;
    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    const validation = await validateRequestBody(request, UpdateNoteSchema);
    if (!validation.success) return validation.response;
    const body = validation.data;

    const [updated] = await db
      .update(documentNotes)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.content !== undefined && { content: body.content }),
        ...(body.contentRich !== undefined && { contentRich: body.contentRich }),
        ...(body.contentMarkdown !== undefined && {
          contentMarkdown: body.contentMarkdown,
        }),
        ...(body.anchor !== undefined && { anchor: body.anchor }),
        ...(body.anchorStatus !== undefined && { anchorStatus: body.anchorStatus }),
        ...(body.tags !== undefined && { tags: body.tags }),
      })
      .where(and(eq(documentNotes.id, id), eq(documentNotes.userId, userId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Re-embed whenever the embedding input might have shifted.
    if (
      body.title !== undefined ||
      body.content !== undefined ||
      body.contentMarkdown !== undefined ||
      body.contentRich !== undefined ||
      body.anchor !== undefined
    ) {
      embedNoteAsync(updated.id);
    }

    return NextResponse.json({ note: updated }, { status: 200 });
  } catch (error) {
    console.error("Error updating note:", error);
    return NextResponse.json(
      { error: "Failed to update note" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { noteId } = await params;
    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    const [deleted] = await db
      .delete(documentNotes)
      .where(and(eq(documentNotes.id, id), eq(documentNotes.userId, userId)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Notes have no FK cascade — drop their embeddings explicitly so stale
    // vectors don't leak into retrieval.
    await db
      .delete(documentNoteEmbeddings)
      .where(eq(documentNoteEmbeddings.noteId, id));

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json(
      { error: "Failed to delete note" },
      { status: 500 }
    );
  }
}
