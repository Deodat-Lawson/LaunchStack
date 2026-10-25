/**
 * Publish a mindmap into the Sources library — or update the copy already
 * there.
 *
 * The outline is rendered here from the *stored* document and pushed through
 * the existing ingestion path, so a published mindmap is chunked, embedded
 * and citable exactly like any uploaded note, and what enters the retrieval
 * corpus is what was saved rather than whatever a client chose to send.
 *
 * A map has one citable copy. The first publish creates a document with a
 * stable creation key; every later publish adds a *version* to that document,
 * which re-indexes it under the same id — citations and notes keep pointing
 * at the map, and the library does not fill up with stale outlines.
 *
 * Publishing adds a file to the library, so it takes what any upload takes
 * (ADR-014): `documents.upload`, edit access to the folder it lands in, and —
 * for a later publish — edit access to the copy it replaces. A first publish
 * into Unfiled is private to the publisher until they share it. It also writes
 * the draft's published marker, so it takes edit access to the draft itself
 * (`~/server/mindmap/access`); a draft the caller cannot see is a 404.
 */

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import { buildInternalFileUrl } from "@launchstack/store/crypto";
import { document as documentTable } from "@launchstack/store/schema";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordOr } from "~/i18n/translate";
import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { getEngine } from "~/server/engine";
import { uploadFile } from "~/lib/storage";
import { mindmapDocumentMarker } from "~/lib/mindmap-document";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { PublishMindmapSchema, serverError, validateRequestBody } from "~/lib/validation";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { processDocumentUpload, toAbsoluteUrl } from "~/server/services/document-upload";
import {
    authorizeInternalFileRef,
    UploadAuthorizationError,
} from "~/server/services/internal-file-ref";
import { canEditFolder } from "~/server/services/folder-access";
import { canEditDraftAt, draftAccess, draftReader } from "~/server/mindmap/access";
import { getMindmap, toDetail } from "~/server/mindmap/repository";
import { recordUpload } from "~/server/workspace/added-documents";
import { canEditDocument } from "~/server/workspace/item-access";
import { parseDoc, toMarkdownOutline } from "~/app/employer/documents/_mindmap/model/serialize";

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

/** Stable per map: the first publish's document is the map's document for good. */
function creationKeyFor(mindmapId: number): string {
    return `mindmap:${mindmapId}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "mindmap.server.errors");
    const sources = translatorFor(locale, "sources.server.errors");
    try {
        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        const id = Number.parseInt((await params).id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json(
                { error: translatorFor(locale, "errors.api")("invalidId") },
                { status: 400 }
            );
        }

        const validation = await validateRequestBody(request, PublishMindmapSchema);
        if (!validation.success) return validation.response;
        const { category } = validation.data;
        // Blank is not "unset" for a folder name, so `??` would let "" through.
        const trimmedCategory = category?.trim();
        const requestedCategory =
            trimmedCategory === undefined || trimmedCategory === "" ? undefined : trimmedCategory;

        const map = await getMindmap(id, await draftReader(ctx.data));
        if (!map) return NextResponse.json({ error: t("notFound") }, { status: 404 });
        if (!canEditDraftAt((await draftAccess(ctx.data, map)).level)) {
            return NextResponse.json({ error: t("editDenied") }, { status: 403 });
        }

        const documentCategory = requestedCategory ?? map.folder;
        if (!(await canEditFolder(ctx.data, documentCategory))) {
            return NextResponse.json({ error: sources("folderEditDenied") }, { status: 403 });
        }
        if (map.publishedDocumentId !== null) {
            // A later publish replaces the citable copy's content: a new
            // version, which takes edit access to that document.
            const [published] = await db
                .select({ category: documentTable.category })
                .from(documentTable)
                .where(
                    and(
                        eq(documentTable.id, Number(map.publishedDocumentId)),
                        eq(documentTable.companyId, ctx.data.companyId)
                    )
                )
                .limit(1);
            if (
                published &&
                !(await canEditDocument(ctx.data, {
                    id: Number(map.publishedDocumentId),
                    category: published.category,
                }))
            ) {
                return NextResponse.json({ error: sources("documentEditDenied") }, { status: 403 });
            }
        }

        // One heading per branch: the chunker stamps each chunk with its
        // heading path, so a chunk cut out of a large map still says which
        // branch it came from, not only which map.
        const markdown = toMarkdownOutline(parseDoc(map.doc, map.title), { sections: true });
        const filename = safeFilename(map.title);
        const stored = await uploadFile({
            filename,
            data: Buffer.from(markdown, "utf8"),
            contentType: "text/markdown",
            userId: ctx.data.authUserId,
            companyId: ctx.data.companyId,
        });

        const marker = mindmapDocumentMarker({ mindmapId: id, revision: map.revision });

        let documentId: number;
        let jobId: string;

        if (map.publishedDocumentId === null) {
            const upload = await processDocumentUpload({
                user: { userId: ctx.data.authUserId, companyId: ctx.data.companyId },
                documentName: map.title,
                rawDocumentUrl: stored.url,
                creationKey: creationKeyFor(id),
                category: documentCategory,
                explicitStorageType: stored.provider,
                mimeType: "text/markdown",
                originalFilename: filename,
                requestUrl: request.url,
                ocrMetadata: { ...marker },
            });
            await recordUpload(ctx.data, upload);
            documentId = upload.document.id;
            jobId = upload.jobId;
        } else {
            // Same cold-start ordering as processDocumentUpload: configure the
            // engine before reading provider config or authorising file refs.
            getEngine();
            const provider = getOcrConfig().defaultProvider;
            const internalFileId = await authorizeInternalFileRef(
                stored.url,
                ctx.data.companyId,
                provider
            );
            const processingUrl =
                internalFileId !== null
                    ? buildInternalFileUrl(
                          getOcrConfig().appPublicUrl ?? new URL(request.url).origin,
                          internalFileId
                      )
                    : toAbsoluteUrl(stored.url, request.url);

            const lifecycle = await createDocumentVersionLifecycle({
                documentId: Number(map.publishedDocumentId),
                companyId: ctx.data.companyId,
                userId: ctx.data.authUserId,
                title: map.title,
                category: documentCategory,
                url: stored.url,
                processingUrl,
                // One version per map revision; a retry converges on it.
                creationKey: `${creationKeyFor(id)}:r${map.revision}`,
                mimeType: "text/markdown",
                fileSize: Buffer.byteLength(markdown, "utf8"),
                changelog: `Published revision ${map.revision}`,
                originalFilename: filename,
            });
            documentId = lifecycle.document.id;
            jobId = lifecycle.jobId;

            // The marker records which revision the citable copy came from.
            // A version carries no metadata of its own at creation, so the
            // document row is where the viewer reads it.
            await db.execute(
                sql`UPDATE ${documentTable} SET ocr_metadata = COALESCE(ocr_metadata, '{}'::jsonb) || ${JSON.stringify(marker)}::jsonb WHERE id = ${documentId}`
            );
        }

        const [row] = await db
            .update(mindmaps)
            .set({
                publishedDocumentId: BigInt(documentId),
                publishedAt: new Date(),
                publishedRevision: map.revision,
                updatedByUserId: ctx.data.authUserId,
            })
            .where(and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId)))
            .returning();

        return NextResponse.json(
            {
                mindmap: row ? toDetail(row) : null,
                document: { id: documentId },
                jobId,
            },
            { status: 201 }
        );
    } catch (error) {
        if (error instanceof UploadAuthorizationError) {
            return NextResponse.json(
                { error: wordOr(error.copy, error.message, locale) },
                { status: 403 }
            );
        }
        console.error("[mindmaps] publish failed:", error);
        return serverError(t("publishFailed"));
    }
}
