import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "~/server/db";
import { studyAgentNotes } from "~/server/db/schema";
import { resolveSessionForUser } from "~/server/study-agent/session";
import { parseSessionId, serializeBigInt } from "../../shared";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: number | string;
      title?: string;
      content?: string;
      tags?: string[];
    };

    const session = await resolveSessionForUser(
      userId,
      typeof body.sessionId === "number"
        ? body.sessionId
        : typeof body.sessionId === "string"
        ? Number(body.sessionId)
        : parseSessionId(request)
    );

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const title = (body.title ?? "").trim();
    const content = body.content ?? "";
    const tags = Array.isArray(body.tags) ? body.tags : [];

    if (!title && !content) {
      return NextResponse.json(
        { error: "Title or content is required" },
        { status: 400 }
      );
    }

    const [inserted] = await db
      .insert(studyAgentNotes)
      .values({
        userId,
        sessionId: BigInt(session.id),
        title: title || "Untitled Note",
        content,
        tags,
      })
      .returning();

    if (!inserted) {
      return NextResponse.json(
        { error: "Failed to create note" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { note: serializeBigInt(inserted) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating note", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}

