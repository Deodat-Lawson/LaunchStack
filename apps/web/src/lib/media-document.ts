/**
 * Audio and video sources: which documents are media, and what a transcript
 * document says about the recording it was made from.
 *
 * A media upload becomes two rows (see `processDocumentUpload`): the
 * recording itself, which is stored but not indexed, and a text/plain
 * "(Transcription)" document that is indexed and cited. The transcript row's
 * `ocrMetadata` carries the link back to the recording — the recording's
 * document id for an upload, the page URL for a YouTube-style import — plus
 * the timestamped segments when the transcriber reported them. OCR
 * completion merges into that metadata rather than replacing it, so the link
 * survives indexing.
 *
 * Pure shape work, so the same module serves the upload service, the media
 * route, the display-type sniff and the player.
 */

export type MediaKind = "audio" | "video";

/** One timestamped span of a transcript, in seconds from the start of the recording. */
export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

/** Types a browser plays in `<audio>`/`<video>`, keyed by lower-case extension. */
export const MEDIA_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    weba: "audio/webm",
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
};

function extensionOf(name: string): string {
    // Ignore a query string or fragment on a URL-shaped name.
    const path = name.split(/[?#]/, 1)[0] ?? "";
    const dot = path.lastIndexOf(".");
    return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

/** The media type for a file name or URL with an audio/video extension. */
export function mediaMimeFromName(name: string | null | undefined): string | undefined {
    return name ? MEDIA_MIME_BY_EXTENSION[extensionOf(name)] : undefined;
}

/** Audio or video, by MIME type; null for anything else. */
export function mediaKindOfMime(mime: string | null | undefined): MediaKind | null {
    const essence = (mime ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (essence.startsWith("video/")) return "video";
    if (essence.startsWith("audio/")) return "audio";
    return null;
}

/** Audio or video, by file extension; null for anything else. */
export function mediaKindOfName(name: string | null | undefined): MediaKind | null {
    return mediaKindOfMime(mediaMimeFromName(name));
}

/** Where a transcript came from: an uploaded recording, or a video page imported by URL. */
export type TranscriptOrigin = "upload" | "url";

export interface TranscriptMarker {
    origin: TranscriptOrigin;
    /** The recording's own document, for an uploaded file. */
    mediaDocumentId: number | null;
    /** The uploaded recording's file name — the type hint when no MIME type was stored. */
    mediaFilename: string | null;
    /** The uploaded recording's MIME type, recorded since media previews shipped. */
    mediaMimeType: string | null;
    /** The page the transcript was pulled from, for a URL import. */
    videoUrl: string | null;
    language: string | null;
    durationSeconds: number | null;
    /** Timestamped spans, or null when the transcriber reported none. */
    segments: TranscriptSegment[] | null;
}

const MARKER_SOURCES: Record<string, TranscriptOrigin> = {
    transcription: "upload",
    "sidecar-ytdlp": "url",
};

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

function finiteOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Keep only well-formed segments, in time order. Metadata is stored JSON, so
 * nothing about its shape is taken on trust.
 */
export function normalizeSegments(value: unknown): TranscriptSegment[] | null {
    if (!Array.isArray(value)) return null;
    const segments: TranscriptSegment[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const { start, end, text } = item as Record<string, unknown>;
        if (typeof start !== "number" || !Number.isFinite(start) || start < 0) continue;
        if (typeof text !== "string" || text.trim() === "") continue;
        const safeEnd =
            typeof end === "number" && Number.isFinite(end) && end >= start ? end : start;
        segments.push({ start, end: safeEnd, text: text.trim() });
    }
    if (segments.length === 0) return null;
    return segments.sort((a, b) => a.start - b.start);
}

/** The transcript marker in a document row's `ocrMetadata`, or null when it is not a transcript. */
export function transcriptMarkerOf(ocrMetadata: unknown): TranscriptMarker | null {
    if (!ocrMetadata || typeof ocrMetadata !== "object" || Array.isArray(ocrMetadata)) {
        return null;
    }
    const record = ocrMetadata as Record<string, unknown>;
    const origin = typeof record.source === "string" ? MARKER_SOURCES[record.source] : undefined;
    if (!origin) return null;

    const mediaDocumentId = finiteOrNull(record.audioDocumentId);
    return {
        origin,
        mediaDocumentId:
            mediaDocumentId !== null && Number.isInteger(mediaDocumentId) && mediaDocumentId > 0
                ? mediaDocumentId
                : null,
        mediaFilename: stringOrNull(record.audioFilename),
        mediaMimeType: stringOrNull(record.mediaMimeType),
        videoUrl: stringOrNull(record.videoUrl),
        language: stringOrNull(record.language),
        durationSeconds: finiteOrNull(record.videoDuration) ?? finiteOrNull(record.durationSeconds),
        segments: normalizeSegments(record.segments),
    };
}

/**
 * Whether the recording behind a transcript has a picture. A URL import is a
 * video page by definition; an upload says so by its stored type, or failing
 * that its file name. Audio is the answer only when something says audio.
 */
export function transcriptMediaKind(marker: TranscriptMarker): MediaKind {
    if (marker.origin === "url") return "video";
    return (
        mediaKindOfMime(marker.mediaMimeType) ?? mediaKindOfName(marker.mediaFilename) ?? "audio"
    );
}

/** Legacy transcripts predate the marker and are recognisable only by their title. */
export function hasTranscriptTitle(title: string): boolean {
    return title.toLowerCase().includes("(transcription)");
}

/** `m:ss`, or `h:mm:ss` from an hour up. Negative and non-finite input reads as zero. */
export function formatMediaTime(totalSeconds: number): string {
    const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    const ss = seconds.toString().padStart(2, "0");
    return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/**
 * The segment to show as playing at `time`: the last one to have started, so
 * the highlight holds through a pause in speech instead of flickering off.
 * -1 before the first segment. `segments` must be in time order.
 */
export function activeSegmentIndex(segments: readonly TranscriptSegment[], time: number): number {
    let lo = 0;
    let hi = segments.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segments[mid]!.start <= time) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}

/** Where the viewer plays a media source from. */
export type MediaPlayback =
    /** Stored bytes, played in `<audio>`/`<video>` from a same-origin, ranged URL. */
    | { type: "file"; documentId: number; url: string; mimeType: string | null }
    /** A platform's own player, framed. */
    | {
          type: "embed";
          provider: string;
          label: string;
          embedUrl: string;
          watchUrl: string;
          startSeconds: number;
      }
    /** A page that cannot be framed here: link out to it. */
    | { type: "link"; url: string; label: string };

/**
 * `GET /api/documents/[id]/media` — everything the viewer needs to play a
 * media source, asked about either half of the pair: the recording or its
 * transcript.
 */
export interface MediaPreview {
    /** The document asked about. */
    documentId: number;
    /** The recording's name: the media document's title, or the transcript's without its suffix. */
    title: string;
    kind: MediaKind;
    /** Null when the recording is gone or was never linked (a legacy transcript). */
    playback: MediaPlayback | null;
    /** Null when no transcript exists (yet) for an uploaded recording. */
    transcript: {
        documentId: number;
        title: string;
        language: string | null;
        segments: TranscriptSegment[] | null;
    } | null;
    durationSeconds: number | null;
}

/** "Standup.mp3 (Transcription)" → "Standup.mp3". */
export function stripTranscriptSuffix(title: string): string {
    return title.replace(/\s*\(transcription\)\s*$/i, "").trim() || title;
}
