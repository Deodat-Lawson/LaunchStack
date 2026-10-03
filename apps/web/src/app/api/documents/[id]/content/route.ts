import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "~/server/db";
import { document } from "@launchstack/store/schema";
import { isPrivateBlobUrl } from "~/server/storage/vercel-blob";
import { fetchFile, isS3Storage } from "~/lib/storage";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { storedFileHeaders } from "~/server/security/stored-file-headers";
import { forwardRangeInit, relayedRangeResponse } from "~/server/storage/byte-range";
import { mediaMimeFromName } from "~/lib/media-document";

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
    return (
        (match?.[1] && EXTENSION_TO_MIME[match[1].toLowerCase()]) ??
        mediaMimeFromName(name) ??
        "application/octet-stream"
    );
}

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { id } = await params;
        const docId = parseInt(id, 10);
        if (isNaN(docId)) {
            return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
        }

        const [doc] = await db
            .select({ url: document.url, title: document.title })
            .from(document)
            .where(
                and(
                    eq(document.id, docId),
                    scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
                )
            );

        // Out of scope reads exactly like missing — the distinction would leak
        // which ids exist in folders the caller cannot see.
        if (!doc) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        if (!isS3Storage() && !isPrivateBlobUrl(doc.url)) {
            // Database storage records the same-origin path `/api/files/{id}`,
            // which NextResponse.redirect rejects as malformed. A relative
            // Location is valid HTTP and resolves against this request. A
            // media element re-sends its Range to wherever this points.
            // (`//host` is not a path: it would leave the origin.)
            return doc.url.startsWith("/") && !doc.url.startsWith("//")
                ? new NextResponse(null, { status: 307, headers: { Location: doc.url } })
                : NextResponse.redirect(doc.url, { status: 307 });
        }

        // A media element's Range goes on to storage, which slices.
        const blobRes = await fetchFile(doc.url, forwardRangeInit(request));
        const relayed = relayedRangeResponse(blobRes);
        if (relayed.status === 416) {
            return new NextResponse(null, relayed);
        }
        if (!blobRes.ok) {
            return NextResponse.json(
                { error: "Failed to retrieve document from storage" },
                { status: 502 }
            );
        }

        const mimeType = blobRes.headers.get("content-type") ?? inferMime(doc.title);

        return new NextResponse(blobRes.body, {
            status: relayed.status,
            headers: {
                // The storage type is the uploader's claim, same as /api/files.
                ...storedFileHeaders(mimeType),
                ...relayed.headers,
                "Content-Disposition": `inline; filename="${encodeURIComponent(doc.title)}"; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
                "Cache-Control": "private, max-age=3600",
            },
        });
    } catch (error) {
        console.error("Error serving document content:", error);
        return NextResponse.json({ error: "Failed to serve document" }, { status: 500 });
    }
}
