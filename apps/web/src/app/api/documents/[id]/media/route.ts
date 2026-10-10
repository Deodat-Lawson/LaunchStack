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
 * the answer never says which hidden documents exist.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { document } from "@launchstack/store/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import {
    hasTranscriptTitle,
    mediaKindOfMime,
    mediaKindOfName,
    stripTranscriptSuffix,
    transcriptMarkerOf,
    transcriptMediaKind,
    type MediaKind,
    type MediaPlayback,
    type MediaPreview,
} from "~/lib/media-document";
import { mediaEmbedFor, mediaPlatformLabel } from "~/lib/media-embed";

interface RouteParams {
    params: Promise<{ id: string }>;
}

const OCTET_STREAM = "application/octet-stream";

/** The stored type, unless it is the client's "no idea" placeholder. */
function storedMime(mimeType: string | null): string | null {
    return mimeType && mimeType !== OCTET_STREAM ? mimeType : null;
}

function kindOfStored(doc: { mimeType: string | null; title: string; url: string }) {
    return (
        mediaKindOfMime(storedMime(doc.mimeType)) ??
        mediaKindOfName(doc.title) ??
        mediaKindOfName(doc.url)
    );
}

function filePlayback(doc: { id: number; mimeType: string | null }): MediaPlayback {
    return {
        type: "file",
        documentId: doc.id,
        url: `/api/documents/${doc.id}/content`,
        mimeType: storedMime(doc.mimeType),
    };
}

export async function GET(_request: Request, { params }: RouteParams) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { id } = await params;
        const docId = Number(id);
        if (!Number.isInteger(docId) || docId <= 0) {
            return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
        }

        const inScope = scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope());
        const columns = {
            id: document.id,
            title: document.title,
            url: document.url,
            mimeType: document.mimeType,
            ocrMetadata: document.ocrMetadata,
        };

        const [doc] = await db
            .select(columns)
            .from(document)
            .where(and(eq(document.id, docId), inScope));
        if (!doc) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        const marker = transcriptMarkerOf(doc.ocrMetadata);

        // The transcript: find the recording behind it.
        if (marker || hasTranscriptTitle(doc.title)) {
            let kind: MediaKind = marker ? transcriptMediaKind(marker) : "audio";
            let title = stripTranscriptSuffix(doc.title);
            let playback: MediaPlayback | null = null;

            if (marker?.origin === "url" && marker.videoUrl) {
                const embed = mediaEmbedFor(marker.videoUrl);
                if (embed) {
                    kind = embed.kind;
                    playback = {
                        type: "embed",
                        provider: embed.provider,
                        label: embed.label,
                        embedUrl: embed.embedUrl,
                        watchUrl: embed.watchUrl,
                        startSeconds: embed.startSeconds,
                    };
                } else {
                    playback = {
                        type: "link",
                        url: marker.videoUrl,
                        label: mediaPlatformLabel(marker.videoUrl),
                    };
                }
            } else if (marker?.mediaDocumentId) {
                const [media] = await db
                    .select(columns)
                    .from(document)
                    .where(and(eq(document.id, marker.mediaDocumentId), inScope));
                if (media) {
                    kind = kindOfStored(media) ?? kind;
                    title = media.title;
                    playback = filePlayback(media);
                }
            }

            const preview: MediaPreview = {
                documentId: doc.id,
                title,
                kind,
                playback,
                transcript: {
                    documentId: doc.id,
                    title: doc.title,
                    language: marker?.language ?? null,
                    segments: marker?.segments ?? null,
                },
                durationSeconds: marker?.durationSeconds ?? null,
            };
            return NextResponse.json(preview);
        }

        // The recording: play it, and find the transcript made from it.
        const kind = kindOfStored(doc);
        if (!kind) {
            return NextResponse.json(
                { error: "This document has no audio or video" },
                { status: 404 }
            );
        }

        const [transcriptDoc] = await db
            .select(columns)
            .from(document)
            .where(
                and(
                    inScope,
                    sql`${document.ocrMetadata}->>'source' = 'transcription'`,
                    sql`${document.ocrMetadata}->>'audioDocumentId' = ${String(doc.id)}`
                )
            )
            .orderBy(desc(document.id))
            .limit(1);
        const transcriptMarker = transcriptDoc
            ? transcriptMarkerOf(transcriptDoc.ocrMetadata)
            : null;

        const preview: MediaPreview = {
            documentId: doc.id,
            title: doc.title,
            kind,
            playback: filePlayback(doc),
            transcript: transcriptDoc
                ? {
                      documentId: transcriptDoc.id,
                      title: transcriptDoc.title,
                      language: transcriptMarker?.language ?? null,
                      segments: transcriptMarker?.segments ?? null,
                  }
                : null,
            durationSeconds: transcriptMarker?.durationSeconds ?? null,
        };
        return NextResponse.json(preview);
    } catch (error) {
        console.error("Error resolving document media:", error);
        return NextResponse.json({ error: "Failed to load media" }, { status: 500 });
    }
}
