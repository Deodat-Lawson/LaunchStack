/**
 * Legal Document Apply Edits API
 * Integrates the Adeu layer to apply edits as Track Changes in DOCX documents
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { processDocumentBatch } from "~/lib/adeu/client";
import type { DocumentEdit } from "~/lib/adeu/types";

export const runtime = "nodejs";

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

    // Convert base64 to Buffer
    const docBuffer = Buffer.from(documentBase64, "base64");

    // If no edits provided, just return the original document
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

    // Apply edits using Adeu
    const result = await processDocumentBatch(docBuffer, {
      author_name: authorName,
      edits: edits as DocumentEdit[],
    });

    // Convert result Blob to base64
    const modifiedBuffer = Buffer.from(await result.file.arrayBuffer());
    const modifiedDocxBase64 = modifiedBuffer.toString("base64");

    return NextResponse.json({
      success: true,
      modifiedDocxBase64,
      summary: result.summary,
    });
  } catch (error) {
    console.error("Legal apply edits error:", error);
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
