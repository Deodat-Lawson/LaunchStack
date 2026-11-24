/**
 * GET /api/documents/[id]/media
 *
 * Resolves a media source for the viewer, asked about either half of the pair
 * an audio or video upload becomes (see `processDocumentUpload`):
 *
 *   - the recording: plays it, and finds the transcript made from it;
 *   - the transcript: shows it, and finds the recording it was made from —
 *     the uploaded file, or for a URL import the platform's own player.
 *
 * Playback always goes through `/api/documents/{id}/content`: same origin,
 * scope-checked per request, and ranged, so the element can seek.
 *
 * Both lookups run inside the caller's read scope. A recording in a folder
 * the caller cannot see is reported as missing, the same as a deleted one, so
 * the answer never says which hidden documents exist. The pairing itself is
 * `~/server/media-preview`, which a public link's twin shares.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { db } from "~/server/db";
import { document } from "@launchstack/store/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { MEDIA_DOCUMENT_COLUMNS, resolveMediaPreview } from "~/server/media-preview";

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
    const locale = localeOfRequest(request);
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { id } = await params;
        const docId = Number(id);
        if (!Number.isInteger(docId) || docId <= 0) {
            return NextResponse.json(
                { error: translatorFor(locale, "errors.api")("invalidDocumentId") },
                { status: 400 }
            );
        }

        const inScope = scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope());
        const [doc] = await db
            .select(MEDIA_DOCUMENT_COLUMNS)
            .from(document)
            .where(and(eq(document.id, docId), inScope));
        if (!doc) {
            return NextResponse.json(
                { error: translatorFor(locale, "errors.api")("documentNotFound") },
                { status: 404 }
            );
        }

        const resolved = await resolveMediaPreview(
            {
                id: Number(doc.id),
                title: doc.title,
                url: doc.url,
                mimeType: doc.mimeType ?? null,
                ocrMetadata: doc.ocrMetadata,
            },
            { where: inScope, playbackUrl: media => `/api/documents/${media.id}/content` }
        );
        if (!resolved) {
            return NextResponse.json(
                { error: translatorFor(locale, "viewers.server.errors")("noMedia") },
                { status: 404 }
            );
        }
        return NextResponse.json(resolved.preview);
    } catch (error) {
        console.error("Error resolving document media:", error);
        return NextResponse.json(
            { error: translatorFor(locale, "viewers.server.errors")("mediaLoadFailed") },
            { status: 500 }
        );
    }
}
