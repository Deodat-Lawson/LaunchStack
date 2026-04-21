import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { document, documentContextChunks } from "@launchstack/core/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const docId = parseInt(id, 10);
    if (isNaN(docId)) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }

    const [doc] = await db
      .select({ id: document.id, title: document.title })
      .from(document)
      .where(eq(document.id, docId));

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const chunks = await db
      .select({
        content: documentContextChunks.content,
        pageNumber: documentContextChunks.pageNumber,
      })
      .from(documentContextChunks)
      .where(eq(documentContextChunks.documentId, BigInt(docId)))
      .orderBy(
        asc(documentContextChunks.pageNumber),
        asc(documentContextChunks.id),
      );

    if (chunks.length === 0) {
      return NextResponse.json({
        html: "<p>No extracted text available for this document. It may still be processing.</p>",
        chunkCount: 0,
        documentId: docId,
      });
    }

    const html = chunks
      .map((c) => {
        const text = c.content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        const lines = text.split("\n");
        const formatted = lines
          .map((line) => {
            if (line.startsWith("--- File:") && line.endsWith("---")) {
              const filename = line.replace(/^--- File:\s*/, "").replace(/\s*---$/, "");
              return `<h3 class="file-header">${filename}</h3>`;
            }
            if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
            if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
            if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
            if (line.trim() === "") return "";
            return `<p>${line}</p>`;
          })
          .filter(Boolean)
          .join("\n");

        return formatted;
      })
      .join('\n<hr class="chunk-divider" />\n');

    return NextResponse.json({
      html,
      chunkCount: chunks.length,
      documentId: docId,
    });
  } catch (error) {
    console.error("[DocumentText] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve document text" },
      { status: 500 },
    );
  }
}
