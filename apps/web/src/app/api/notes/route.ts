import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { documentNotes } from "@launchstack/core/db/schema";
import { eq, and, desc, ilike, arrayContains, isNull, inArray } from "drizzle-orm";
import { validateRequestBody, CreateNoteSchema } from "~/lib/validation";
import { embedNoteAsync } from "~/server/notes/embed-note";
import { serializeNote } from "~/server/notes/serialize";
import { searchNotes } from "~/server/notes/search";
import { syncNoteLinks } from "~/server/notes/wiki-links";
import type { JSONContent } from "@tiptap/react";

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("documentId");
    const search = searchParams.get("search");
    const tagsParam = searchParams.get("tags");
    const anchorStatus = searchParams.get("anchorStatus");
    const surface = searchParams.get("surface");

    const conditions = [eq(documentNotes.userId, userId)];

    if (documentId) {
      conditions.push(eq(documentNotes.documentId, documentId));
    } else if (surface === "notebook") {
      // Freeform / cross-document notes — those without a document anchor.
      conditions.push(isNull(documentNotes.documentId));
    }

    // Semantic search path: when `search` is set we try vector first and
    // fall back to title ILIKE if no embedding key is configured. Hits come
    // back as note ids, which we then load via the same Drizzle pipeline so
    // tags/anchorStatus filters still apply on top.
    let semanticIds: number[] | null = null;
    if (search) {
      const hits = await searchNotes({
        userId,
        query: search,
        scope: documentId ? "document" : "user",
        documentId: documentId ?? undefined,
        topK: 25,
      });
      if (hits.length > 0) {
        semanticIds = hits.map((h) => h.noteId);
        conditions.push(inArray(documentNotes.id, semanticIds));
      } else {
        conditions.push(ilike(documentNotes.title, `%${search}%`));
      }
    }

    if (tagsParam) {
      const tags = tagsParam.split(",").map((t) => t.trim());
      conditions.push(arrayContains(documentNotes.tags, tags));
    }

    if (
      anchorStatus === "resolved" ||
      anchorStatus === "drifted" ||
      anchorStatus === "orphaned"
    ) {
      conditions.push(eq(documentNotes.anchorStatus, anchorStatus));
    }

    const rows = await db
      .select()
      .from(documentNotes)
      .where(and(...conditions))
      .orderBy(desc(documentNotes.createdAt));

    // When semantic search seeded the result set, restore the relevance
    // ordering rather than the raw createdAt sort.
    const notes = semanticIds
      ? semanticIds
          .map((id) => rows.find((r) => r.id === id))
          .filter((r): r is (typeof rows)[number] => r !== undefined)
      : rows;

    return NextResponse.json({ notes: notes.map(serializeNote) }, { status: 200 });
  } catch (error) {
    console.error("Error fetching notes:", error);
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await validateRequestBody(request, CreateNoteSchema);
    if (!validation.success) return validation.response;
    const body = validation.data;

    const versionIdBigint =
      body.versionId !== undefined && body.versionId !== null
        ? BigInt(body.versionId)
        : null;

    const [note] = await db
      .insert(documentNotes)
      .values({
        userId,
        documentId: body.documentId ?? null,
        companyId: body.companyId ?? null,
        versionId: versionIdBigint,
        title: body.title ?? null,
        content: body.content ?? null,
        contentRich: body.contentRich ?? null,
        contentMarkdown: body.contentMarkdown ?? null,
        anchor: body.anchor ?? null,
        anchorStatus: body.anchorStatus ?? "resolved",
        tags: body.tags ?? [],
      })
      .returning();

    if (note) {
      embedNoteAsync(note.id);
      void syncNoteLinks({
        noteId: note.id,
        rich: (note.contentRich as JSONContent | null) ?? null,
        companyId: note.companyId,
      }).catch((err) => console.error("[syncNoteLinks] failed:", err));
    }

    return NextResponse.json(
      { note: note ? serializeNote(note) : note },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
