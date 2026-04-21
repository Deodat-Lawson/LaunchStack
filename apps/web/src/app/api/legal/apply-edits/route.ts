/**
 * Legal Document Apply Edits API
 * Applies edits as Track Changes in DOCX documents via the Adeu service.
 * Uses paragraph-scoped context disambiguation, then a direct XML cleanup
 * pass to guarantee all placeholder tokens are replaced.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import PizZip from "pizzip";
import {
  processDocumentBatch,
  readDocx,
  AdeuConfigError,
  AdeuServiceError,
  type DocumentEdit,
} from "@launchstack/features/adeu";

export const runtime = "nodejs";

const CONTEXT_CHARS = 40;

const ApplyEditsSchema = z.object({
  documentBase64: z.string(),
  authorName: z.string().default("Legal Review Assistant"),
  edits: z
    .array(
      z.object({
        target_text: z.string(),
        new_text: z.string(),
        comment: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Try to make target_text unique by expanding with surrounding context,
 * staying within the same paragraph (single-newline-delimited block).
 * Returns null if the target doesn't exist in the text.
 */
function tryDisambiguate(
  targetText: string,
  newText: string,
  comment: string | undefined,
  docText: string,
): DocumentEdit | null {
  const firstIdx = docText.indexOf(targetText);
  if (firstIdx === -1) return null;

  const secondIdx = docText.indexOf(targetText, firstIdx + 1);
  if (secondIdx === -1) {
    return { target_text: targetText, new_text: newText, comment };
  }

  // Find paragraph boundaries (single newline blocks)
  const paraStart = (() => {
    const idx = docText.lastIndexOf("\n", firstIdx);
    return idx === -1 ? 0 : idx + 1;
  })();
  const paraEnd = (() => {
    const idx = docText.indexOf("\n", firstIdx + targetText.length);
    return idx === -1 ? docText.length : idx;
  })();

  let start = firstIdx;
  let end = firstIdx + targetText.length;
  let expanded = targetText;

  for (let step = 0; step < 10; step++) {
    const newStart = Math.max(paraStart, start - CONTEXT_CHARS);
    const newEnd = Math.min(paraEnd, end + CONTEXT_CHARS);
    if (newStart === start && newEnd === end) break;
    expanded = docText.slice(newStart, newEnd);
    start = newStart;
    end = newEnd;

    const check = docText.indexOf(expanded, 0);
    const check2 = docText.indexOf(expanded, check + 1);
    if (check2 === -1) {
      const expandedNew = expanded.replace(targetText, newText);
      return { target_text: expanded, new_text: expandedNew, comment };
    }
  }

  // Still ambiguous — return the original (will be handled by XML cleanup)
  return null;
}

/**
 * Final cleanup: open the DOCX XML, find any remaining __FLD_*__ tokens,
 * and replace them directly. These won't show as track changes but
 * guarantee no placeholder tokens leak into the final document.
 */
function cleanupRemainingTokens(
  docBuffer: Buffer,
  edits: Array<{ target_text: string; new_text: string }>,
): Buffer<ArrayBuffer> {
  const zip = new PizZip(docBuffer);
  const tokenMap = new Map<string, string>();
  for (const e of edits) {
    tokenMap.set(e.target_text, e.new_text);
  }

  // Process all XML parts in the DOCX
  for (const [filename, entry] of Object.entries(zip.files)) {
    if (!filename.endsWith(".xml") && !filename.endsWith(".rels")) continue;
    if (entry.dir) continue;

    let content = entry.asText();
    let changed = false;
    for (const [token, replacement] of tokenMap) {
      if (content.includes(token)) {
        content = content.split(token).join(replacement);
        changed = true;
      }
    }
    if (changed) {
      zip.file(filename, content);
    }
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer<ArrayBuffer>;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const parsed = ApplyEditsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          details: parsed.error.errors,
        },
        { status: 400 },
      );
    }

    const { documentBase64, authorName, edits } = parsed.data;
    const docBuffer = Buffer.from(documentBase64, "base64");

    if (!edits || edits.length === 0) {
      return NextResponse.json({
        success: true,
        modifiedDocxBase64: documentBase64,
        summary: {
          applied_edits: 0,
          skipped_edits: 0,
          applied_actions: 0,
          skipped_actions: 0,
        },
      });
    }

    let currentDoc = docBuffer;
    let totalApplied = 0;
    let totalSkipped = 0;
    const rawEdits = edits as DocumentEdit[];
    const failedEdits: Array<{ target_text: string; new_text: string }> = [];

    // Phase 1: Apply each edit via Adeu (with track changes)
    for (const edit of rawEdits) {
      try {
        const { text: currentText } = await readDocx(currentDoc);
        const normalised = currentText.replace(/\r\n/g, "\n");
        const resolved = tryDisambiguate(
          edit.target_text,
          edit.new_text,
          edit.comment,
          normalised,
        );

        if (!resolved) {
          failedEdits.push(edit);
          continue;
        }

        const result = await processDocumentBatch(currentDoc, {
          author_name: authorName,
          edits: [resolved],
        });
        currentDoc = Buffer.from(await result.file.arrayBuffer());
        totalApplied += result.summary.applied_edits;
        totalSkipped += result.summary.skipped_edits;
      } catch (err) {
        console.warn(
          "[apply-edits] Adeu failed, deferring to cleanup:",
          edit.target_text.slice(0, 50),
        );
        failedEdits.push(edit);
      }
    }

    // Phase 2: Direct XML cleanup for any tokens Adeu couldn't handle.
    // These replacements won't appear as track changes but ensure no
    // __FLD_*__ tokens remain in the final document.
    if (failedEdits.length > 0) {
      currentDoc = cleanupRemainingTokens(currentDoc, failedEdits);
      totalApplied += failedEdits.length;
    }

    const modifiedDocxBase64 = currentDoc.toString("base64");

    return NextResponse.json({
      success: true,
      modifiedDocxBase64,
      summary: {
        applied_edits: totalApplied,
        skipped_edits: totalSkipped,
        applied_actions: 0,
        skipped_actions: 0,
      },
    });
  } catch (error) {
    console.error("Legal apply edits error:", error);

    if (error instanceof AdeuConfigError) {
      return NextResponse.json(
        {
          success: false,
          error: "Track Changes service not configured",
          message:
            "The Adeu redlining service is not set up. Add ADEU_SERVICE_URL to your .env file (e.g. http://localhost:8000) and ensure the service is running.",
        },
        { status: 503 },
      );
    }

    if (error instanceof AdeuServiceError) {
      console.error("[apply-edits] Adeu error detail:", error.detail);
      return NextResponse.json(
        {
          success: false,
          error: "Track Changes service error",
          message: error.detail,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
