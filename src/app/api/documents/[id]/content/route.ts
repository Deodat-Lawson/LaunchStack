import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { document } from "~/server/db/schema";
import { isPrivateBlobUrl } from "~/server/storage/vercel-blob";
import { fetchFile, isLocalStorage } from "~/lib/storage";

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

    if (!isLocalStorage() && !isPrivateBlobUrl(doc.url)) {
      return NextResponse.redirect(doc.url, { status: 307 });
    }

    const blobRes = await fetchFile(doc.url);
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
