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
import { documentNotes } from "~/server/db/schema";
import {
  captureFromSelection,
  type AiCaptureIntent,
} from "~/server/notes/ai-capture";
import { requestNoteEmbedding } from "~/server/notes/embed-note";
import { serializeNote } from "~/server/notes/serialize";
import { syncNoteLinks } from "~/server/notes/wiki-links";
import { validateNoteTarget } from "~/server/notes/validate-note-target";
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

      // Validate before spending an LLM call on a source the caller cannot see.
      const scope = await ctx.data.documentScope();
      const target = await validateNoteTarget({
        documentId: sourceCtx.documentId,
        versionId: sourceCtx.versionId,
        companyId: ctx.data.companyId,
        scope,
      });
      if (!target.ok) return target.response;

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
          userId: ctx.data.authUserId,
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
        // Post-commit side effects: the note row is already persisted, so a
        // failed outbox enqueue (or link sync) must log loudly but never
        // fail the response — parity with the old fire-and-forget path.
        // Tradeoff: the embedding may lag until the next edit re-enqueues it.
        try {
          // `companyId` (the acting user's company, resolved above) doubles
          // as the hint for rows where it came back null.
          await requestNoteEmbedding(note.id, "created", note.companyId ?? companyId);
        } catch (err) {
          console.error(
            `[notes] requestNoteEmbedding failed for note ${note.id} (note saved; embedding deferred to next edit):`,
            err,
          );
        }
        await syncNoteLinks({
          noteId: note.id,
          rich: (note.contentRich as JSONContent | null) ?? null,
          companyId: note.companyId,
          scope,
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
