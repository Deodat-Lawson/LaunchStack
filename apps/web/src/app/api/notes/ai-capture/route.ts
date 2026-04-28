/**
 * AI-driven note capture from a text selection.
 *
 * The client sends a highlighted span + intent + optional source context;
 * the server runs a tight LLM pass to reformat it (summary / action /
 * decision), persists a `documentNotes` row, and kicks off the embed +
 * wiki-link sync pipelines just like a normal note save.
 *
 * Anchored to the source via `anchor.quote.exact` so the captured note can
 * survive document re-uploads via the existing rehydration path.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { JSONContent } from "@tiptap/react";

import { db } from "~/server/db";
import { documentNotes } from "@launchstack/core/db/schema";
import {
  captureFromSelection,
  type AiCaptureIntent,
} from "~/server/notes/ai-capture";
import { embedNoteAsync } from "~/server/notes/embed-note";
import { serializeNote } from "~/server/notes/serialize";
import { syncNoteLinks, getCompanyIdForUser } from "~/server/notes/wiki-links";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  selection?: string;
  intent?: AiCaptureIntent;
  sourceContext?: {
    documentId?: string;
    documentTitle?: string;
    versionId?: number;
    page?: number;
  };
}

const VALID_INTENTS: ReadonlySet<AiCaptureIntent> = new Set([
  "summary",
  "action",
  "decision",
]);

export async function POST(request: Request) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const body = (await request.json().catch(() => ({}))) as Body;
      const selection = (body.selection ?? "").trim();
      const intent = body.intent ?? "summary";
      if (!selection) {
        return NextResponse.json(
          { error: "Selection is required" },
          { status: 400 },
        );
      }
      if (!VALID_INTENTS.has(intent)) {
        return NextResponse.json(
          { error: "Invalid intent" },
          { status: 400 },
        );
      }

      const ctx = body.sourceContext ?? {};
      const { markdown, suggestedTitle } = await captureFromSelection({
        selection,
        intent,
        documentTitle: ctx.documentTitle ?? null,
        page: ctx.page ?? null,
      });

      // Anchor by quote (durable across re-OCR) + page when known.
      const anchor =
        ctx.documentId && selection
          ? {
              type: ctx.page ? "pdf" : "text",
              ...(ctx.page
                ? { primary: { kind: "pdf", page: ctx.page, quads: [] } }
                : {}),
              quote: { exact: selection },
            }
          : null;

      const versionIdBigint =
        ctx.versionId !== undefined && ctx.versionId !== null
          ? BigInt(ctx.versionId)
          : null;

      const companyId = await getCompanyIdForUser(userId);

      const [note] = await db
        .insert(documentNotes)
        .values({
          userId,
          companyId,
          documentId: ctx.documentId ?? null,
          versionId: versionIdBigint,
          title: suggestedTitle,
          contentMarkdown: markdown,
          contentRich: null,
          anchor: anchor as object | null,
          anchorStatus: anchor ? "resolved" : null,
          tags: ["ai-capture", intent],
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
        { note: note ? serializeNote(note) : null, markdown, intent },
        { status: 201 },
      );
    } catch (err) {
      console.error("[/api/notes/ai-capture] failed:", err);
      return NextResponse.json(
        { error: "AI capture failed" },
        { status: 500 },
      );
    }
  });
}
