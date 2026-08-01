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
import type { JSONContent } from "@tiptap/react";

import { db } from "~/server/db";
import { documentNotes } from "@launchstack/core/db/schema";
import {
  captureFromSelection,
  type AiCaptureIntent,
} from "~/server/notes/ai-capture";
import { embedNoteAsync } from "~/server/notes/embed-note";
import { serializeNote } from "~/server/notes/serialize";
import { syncNoteLinks } from "~/server/notes/wiki-links";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

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
      const ctx = await requireWorkspaceContext();
      if (!ctx.success) return ctx.response;

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

      const sourceCtx = body.sourceContext ?? {};
      const { markdown, suggestedTitle } = await captureFromSelection({
        selection,
        intent,
        documentTitle: sourceCtx.documentTitle ?? null,
        page: sourceCtx.page ?? null,
      });

      // Anchor by quote (durable across re-OCR) + page when known.
      const anchor =
        sourceCtx.documentId && selection
          ? {
              type: sourceCtx.page ? "pdf" : "text",
              ...(sourceCtx.page
                ? { primary: { kind: "pdf", page: sourceCtx.page, quads: [] } }
                : {}),
              quote: { exact: selection },
            }
          : null;

      const versionIdBigint =
        sourceCtx.versionId !== undefined && sourceCtx.versionId !== null
          ? BigInt(sourceCtx.versionId)
          : null;

      const companyId = String(ctx.data.companyId);

      const [note] = await db
        .insert(documentNotes)
        .values({
          userId: ctx.data.clerkUserId,
          companyId,
          documentId: sourceCtx.documentId ?? null,
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
