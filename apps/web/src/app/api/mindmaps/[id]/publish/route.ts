/**
 * Publish a mindmap into the Sources library.
 *
 * The map is rendered to a Markdown outline by the editor (which owns the
 * document model) and pushed through the *existing* ingestion path — store the
 * file, then `processDocumentUpload` — so a published mindmap is chunked,
 * embedded and citable exactly like any uploaded note. Nothing about ingestion
 * is special-cased for diagrams.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { uploadFile } from "~/lib/storage";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { PublishMindmapSchema, serverError, validateRequestBody } from "~/lib/validation";
import { processDocumentUpload } from "~/server/services/document-upload";
import { UploadAuthorizationError } from "~/server/services/internal-file-ref";
import { getMindmap, toDetail } from "~/server/mindmap/repository";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeFilename(title: string): string {
    const base =
        title
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 100) || "mindmap";
    return `${base}.md`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = Number.parseInt((await params).id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        const validation = await validateRequestBody(request, PublishMindmapSchema);
        if (!validation.success) return validation.response;
        const { markdown, category } = validation.data;
        // Blank is not "unset" for a folder name, so `??` would let "" through.
        const trimmedCategory = category?.trim();
        const requestedCategory =
            trimmedCategory === undefined || trimmedCategory === "" ? undefined : trimmedCategory;

        const map = await getMindmap(id, ctx.data.companyId);
        if (!map) return NextResponse.json({ error: "Mindmap not found" }, { status: 404 });

        const filename = safeFilename(map.title);
        const stored = await uploadFile({
            filename,
            data: Buffer.from(markdown, "utf8"),
            contentType: "text/markdown",
            userId: ctx.data.authUserId,
            companyId: ctx.data.companyId,
        });

        const upload = await processDocumentUpload({
            user: { userId: ctx.data.authUserId, companyId: ctx.data.companyId },
            documentName: map.title,
            rawDocumentUrl: stored.url,
            // Re-publishing the same revision must not create a second source.
            creationKey: `mindmap:${id}:${map.revision}`,
            category: requestedCategory ?? map.folder,
            explicitStorageType: stored.provider,
            mimeType: "text/markdown",
            originalFilename: filename,
            requestUrl: request.url,
        });

        const [row] = await db
            .update(mindmaps)
            .set({
                publishedDocumentId: BigInt(upload.document.id),
                publishedAt: new Date(),
                updatedByUserId: ctx.data.authUserId,
            })
            .where(and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId)))
            .returning();

        return NextResponse.json(
            {
                mindmap: row ? toDetail(row) : null,
                document: upload.document,
                jobId: upload.jobId,
            },
            { status: 201 }
        );
    } catch (error) {
        if (error instanceof UploadAuthorizationError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        console.error("[mindmaps] publish failed:", error);
        return serverError("Failed to publish mindmap");
    }
}
