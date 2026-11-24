/**
 * What the media viewer plays and shows for a document, asked about either
 * half of the pair an audio or video upload becomes (see
 * `processDocumentUpload`):
 *
 *   - the recording: plays it, and finds the transcript made from it;
 *   - the transcript: shows it, and finds the recording it was made from —
 *     the uploaded file, or for a URL import the platform's own player.
 *
 * Shared by `GET /api/documents/[id]/media` (the reader's scope, playback via
 * `/api/documents/{id}/content`) and the public link's twin
 * (`/api/s/<token>/media`, the shared file's own folder, playback under the
 * token). The caller says where its paired documents may come from (`where`)
 * and how its URLs read (`playbackUrl`); a paired document outside `where`
 * reads as missing, so the answer never says which hidden documents exist.
 */

import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
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
import { db } from "~/server/db";

export interface MediaDocumentRow {
    id: number;
    title: string;
    url: string;
    mimeType: string | null;
    ocrMetadata: unknown;
}

export const MEDIA_DOCUMENT_COLUMNS = {
    id: document.id,
    title: document.title,
    url: document.url,
    mimeType: document.mimeType,
    ocrMetadata: document.ocrMetadata,
};

const OCTET_STREAM = "application/octet-stream";

/** The stored type, unless it is the client's "no idea" placeholder. */
function storedMime(mimeType: string | null): string | null {
    return mimeType && mimeType !== OCTET_STREAM ? mimeType : null;
}

export function kindOfStored(doc: { mimeType: string | null; title: string; url: string }) {
    return (
        mediaKindOfMime(storedMime(doc.mimeType)) ??
        mediaKindOfName(doc.title) ??
        mediaKindOfName(doc.url)
    );
}

export interface ResolvedMedia {
    preview: MediaPreview;
    /** The document whose bytes play, when playback is a file. */
    playbackDocument: MediaDocumentRow | null;
    /** The transcript document, when there is one. */
    transcriptDocument: MediaDocumentRow | null;
}

/**
 * The preview for `doc`, or null when it is neither a transcript nor a
 * recording (nothing to play).
 */
export async function resolveMediaPreview(
    doc: MediaDocumentRow,
    options: {
        /** Where paired documents may come from (the reader's scope, or the shared file's folder). */
        where: SQL | undefined;
        /** The URL a file recording plays from. */
        playbackUrl: (media: MediaDocumentRow) => string;
    }
): Promise<ResolvedMedia | null> {
    const filePlayback = (media: MediaDocumentRow): MediaPlayback => ({
        type: "file",
        documentId: media.id,
        url: options.playbackUrl(media),
        mimeType: storedMime(media.mimeType),
    });

    const marker = transcriptMarkerOf(doc.ocrMetadata);

    // The transcript: find the recording behind it.
    if (marker || hasTranscriptTitle(doc.title)) {
        let kind: MediaKind = marker ? transcriptMediaKind(marker) : "audio";
        let title = stripTranscriptSuffix(doc.title);
        let playback: MediaPlayback | null = null;
        let playbackDocument: MediaDocumentRow | null = null;

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
                .select(MEDIA_DOCUMENT_COLUMNS)
                .from(document)
                .where(and(eq(document.id, marker.mediaDocumentId), options.where));
            if (media) {
                const row = toRow(media);
                kind = kindOfStored(row) ?? kind;
                title = row.title;
                playback = filePlayback(row);
                playbackDocument = row;
            }
        }

        return {
            preview: {
                documentId: doc.id,
                title,
                kind,
                playback,
                transcript: {
                    documentId: doc.id,
                    title: doc.title,
                    language: marker?.language ?? null,
                    languages: marker?.languages ?? null,
                    segments: marker?.segments ?? null,
                    translations: marker?.translations ?? [],
                },
                durationSeconds: marker?.durationSeconds ?? null,
            },
            playbackDocument,
            transcriptDocument: doc,
        };
    }

    // The recording: play it, and find the transcript made from it.
    const kind = kindOfStored(doc);
    if (!kind) return null;

    const [transcriptRow] = await db
        .select(MEDIA_DOCUMENT_COLUMNS)
        .from(document)
        .where(
            and(
                options.where,
                sql`${document.ocrMetadata}->>'source' = 'transcription'`,
                sql`${document.ocrMetadata}->>'audioDocumentId' = ${String(doc.id)}`
            )
        )
        .orderBy(desc(document.id))
        .limit(1);
    const transcriptDocument = transcriptRow ? toRow(transcriptRow) : null;
    const transcriptMarker = transcriptDocument
        ? transcriptMarkerOf(transcriptDocument.ocrMetadata)
        : null;

    return {
        preview: {
            documentId: doc.id,
            title: doc.title,
            kind,
            playback: filePlayback(doc),
            transcript: transcriptDocument
                ? {
                      documentId: transcriptDocument.id,
                      title: transcriptDocument.title,
                      language: transcriptMarker?.language ?? null,
                      languages: transcriptMarker?.languages ?? null,
                      segments: transcriptMarker?.segments ?? null,
                      translations: transcriptMarker?.translations ?? [],
                  }
                : null,
            durationSeconds: transcriptMarker?.durationSeconds ?? null,
        },
        playbackDocument: doc,
        transcriptDocument,
    };
}

function toRow(row: {
    id: number;
    title: string;
    url: string;
    mimeType: string | null;
    ocrMetadata: unknown;
}): MediaDocumentRow {
    return {
        id: Number(row.id),
        title: row.title,
        url: row.url,
        mimeType: row.mimeType ?? null,
        ocrMetadata: row.ocrMetadata,
    };
}
