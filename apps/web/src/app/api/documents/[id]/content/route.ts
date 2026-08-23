import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { document } from "@launchstack/core/db/schema";
import { fetchFile, isS3Storage } from "~/lib/storage";
import { checkDocumentServable } from "~/server/services/document-servable";
import { getEngine } from "~/server/engine";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".md": "text/markdown",
};

function inferMime(name: string): string {
  const match = /(\.[a-z0-9]+)(?:\?|#|$)/i.exec(name);
  return (match?.[1] && EXTENSION_TO_MIME[match[1].toLowerCase()]) ?? "application/octet-stream";
}

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
      .select({ url: document.url, title: document.title })
      .from(document)
      .where(eq(document.id, docId));

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // B6 serve-gating: the row still exists while a delete is in flight, so
    // existence is not permission to serve.
    const gate = await checkDocumentServable(docId);
    if (!gate.servable) {
      return NextResponse.json({ error: gate.message }, { status: gate.status });
    }

    let promoted: ReturnType<typeof promoteLegacyUrlToRef> | undefined;
    try {
      promoted = promoteLegacyUrlToRef({ value: doc.url });
    } catch {
      // Missing provider configuration is treated like any other legacy
      // promotion miss; fetchFile provides the compatibility fallback.
      promoted = undefined;
    }
    let blobRes: Response;

    if (
      promoted?.ok &&
      (promoted.ref.adapter === "vercel-blob" ||
        promoted.ref.adapter === "uploadthing")
    ) {
      // Private vendor objects must be read by the adapter so provider auth
      // and URL construction stay behind the storage port.
      blobRes = await getEngine().storage.get(promoted.ref);
    } else {
      // Preserve the existing S3/database redirect-vs-proxy behaviour. An
      // unpromotable legacy URL takes the string shim once as a last resort.
      if (promoted?.ok && !isS3Storage()) {
        return NextResponse.redirect(doc.url, { status: 307 });
      }
      blobRes = await fetchFile(doc.url);
    }

    if (!blobRes.ok) {
      return NextResponse.json(
        { error: "Failed to retrieve document from storage" },
        { status: 502 },
      );
    }

    const mimeType =
      blobRes.headers.get("content-type") ?? inferMime(doc.title);

    return new NextResponse(blobRes.body, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        ...(blobRes.headers.get("content-length")
          ? { "Content-Length": blobRes.headers.get("content-length")! }
          : {}),
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.title)}"; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error serving document content:", error);
    return NextResponse.json(
      { error: "Failed to serve document" },
      { status: 500 },
    );
  }
}
