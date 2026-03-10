/**
 * Notes Sync API
 * Syncs study notes between the agentic workflow and the UI
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { manageNotes } from "../../agentic/tools/note-taking";
import { type StudyNote } from "../../agentic/types";

export const runtime = "nodejs";

// Helper: parse ?sessionId=31 safely
function parseSessionIdFromUrl(request: Request): number {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("sessionId");
  if (!raw) return 0;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * GET - Get all notes for the user
 * Supports:
 *  - ?sessionId=31
 *  - ?search=...
 *  - ?favorite=true
 *  - ?tags=tag1,tag2
 */
export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const sessionId = parseSessionIdFromUrl(request);

    if (!Number.isFinite(sessionId)) {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    const searchQuery = url.searchParams.get("search") ?? undefined;
    const isFavorite = url.searchParams.get("favorite") === "true" ? true : undefined;

    const tagsParam = url.searchParams.get("tags");
    const tags = tagsParam ? tagsParam.split(",").map(t => t.trim()).filter(Boolean) : undefined;

    let result;

    if (searchQuery) {
      // Search notes
      result = await manageNotes({
        action: "search",
        userId,
        searchQuery,
        sessionId,
      });
    } else {
      // List all notes
      result = await manageNotes({
        action: "list",
        userId,
        filters: {
          isFavorite,
          tags,
          isArchived: false,
        },
        sessionId,
      });
    }

    // manageNotes may return either { note } or { notes }. Support both.
    const notes =
      (result as { notes?: StudyNote[] }).notes ??
      ((result as { note?: StudyNote }).note ? [(result as { note?: StudyNote }).note] : []);

    return NextResponse.json({
      success: result.success,
      notes,
      message: result.message,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Failed to get notes");
    console.error("Error getting notes:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST - Create, update, delete, get, or summarize a note
 * Supports sessionId from either:
 *  - JSON body: { sessionId: 31 }
 *  - Query string: ?sessionId=31
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionIdFromQuery = parseSessionIdFromUrl(request);
    if (!Number.isFinite(sessionIdFromQuery)) {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    const body = (await request.json()) as {
      action?: "create" | "update" | "delete" | "get" | "summarize";
      noteId?: string;
      data?: {
        title?: string;
        content?: string;
        format?: "text" | "markdown" | "bullet_points";
        tags?: string[];
        relatedDocuments?: string[];
        relatedConcepts?: string[];
        isFavorite?: boolean;
        isArchived?: boolean;
      };
      searchQuery?: string;
      sessionId?: number;
    };

    const { action, noteId, data, searchQuery } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    // Prefer body.sessionId if provided, otherwise use query param, otherwise 0
    const sessionId =
      typeof body.sessionId === "number"
        ? body.sessionId
        : sessionIdFromQuery;

    if (!Number.isFinite(sessionId) || sessionId < 0) {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    const result = await manageNotes({
      action,
      userId,
      noteId,
      data,
      searchQuery,
      sessionId,
    });

    return NextResponse.json({
      success: result.success,
      note: result.note as unknown,
      message: result.message,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Failed to manage note");
    console.error("Error managing note:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
