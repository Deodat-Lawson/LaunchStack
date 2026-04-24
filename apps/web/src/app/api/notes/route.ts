import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { documentNotes } from "@launchstack/core/db/schema";
import { eq, and, desc, ilike, arrayContains } from "drizzle-orm";
import { validateRequestBody, CreateNoteSchema } from "~/lib/validation";
import { embedNoteAsync } from "~/server/notes/embed-note";

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

    const conditions = [eq(documentNotes.userId, userId)];

    if (documentId) {
      conditions.push(eq(documentNotes.documentId, documentId));
    }

    if (search) {
      conditions.push(ilike(documentNotes.title, `%${search}%`));
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

    const notes = await db
      .select()
      .from(documentNotes)
      .where(and(...conditions))
      .orderBy(desc(documentNotes.createdAt));

    return NextResponse.json({ notes }, { status: 200 });
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

    if (note) embedNoteAsync(note.id);

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
