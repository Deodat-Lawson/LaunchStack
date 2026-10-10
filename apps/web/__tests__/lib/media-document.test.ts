import {
    activeSegmentIndex,
    formatMediaTime,
    hasTranscriptTitle,
    mediaKindOfMime,
    mediaKindOfName,
    mediaMimeFromName,
    normalizeSegments,
    stripTranscriptSuffix,
    transcriptMarkerOf,
    transcriptMediaKind,
} from "~/lib/media-document";
import { getDocumentDisplayType } from "~/app/employer/documents/types/document";

/** The metadata `processDocumentUpload` writes on an uploaded recording's transcript. */
const UPLOAD_TRANSCRIPT = {
    source: "transcription",
    audioFilename: "standup.mp4",
    audioDocumentId: 12,
    audioUrl: "http://app:3000/api/files/7",
    mediaMimeType: "video/mp4",
    language: "en",
    confidence: 0.9,
    segments: [
        { start: 0, end: 3.5, text: " Welcome. " },
        { start: 3.5, end: 9, text: "Agenda." },
    ],
};

/** …and on a YouTube-style import's. */
const URL_TRANSCRIPT = {
    source: "sidecar-ytdlp",
    videoTitle: "Launch",
    videoDuration: 95,
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    language: "en",
    confidence: 0.8,
};

describe("media kinds", () => {
    it("reads the kind from a MIME type, parameters and case aside", () => {
        expect(mediaKindOfMime("video/mp4")).toBe("video");
        expect(mediaKindOfMime("Audio/MPEG; codecs=mp3")).toBe("audio");
        expect(mediaKindOfMime("audio/x-m4a")).toBe("audio");
        expect(mediaKindOfMime("application/pdf")).toBeNull();
        expect(mediaKindOfMime(undefined)).toBeNull();
    });

    it("reads the kind from a file name or URL", () => {
        expect(mediaKindOfName("Standup.MP4")).toBe("video");
        expect(mediaKindOfName("memo.m4a")).toBe("audio");
        expect(mediaKindOfName("https://cdn.test/a/clip.mov?sig=1#t=4")).toBe("video");
        expect(mediaKindOfName("notes.txt")).toBeNull();
        expect(mediaKindOfName("mp3")).toBeNull();
    });

    it("names the type a browser plays for each media extension", () => {
        expect(mediaMimeFromName("a.mp3")).toBe("audio/mpeg");
        expect(mediaMimeFromName("a.m4a")).toBe("audio/mp4");
        expect(mediaMimeFromName("a.webm")).toBe("video/webm");
        expect(mediaMimeFromName("a.pdf")).toBeUndefined();
    });
});

describe("transcriptMarkerOf", () => {
    it("reads an uploaded recording's transcript", () => {
        expect(transcriptMarkerOf(UPLOAD_TRANSCRIPT)).toEqual({
            origin: "upload",
            mediaDocumentId: 12,
            mediaFilename: "standup.mp4",
            mediaMimeType: "video/mp4",
            videoUrl: null,
            language: "en",
            durationSeconds: null,
            segments: [
                { start: 0, end: 3.5, text: "Welcome." },
                { start: 3.5, end: 9, text: "Agenda." },
            ],
        });
    });

    it("reads a URL import's transcript", () => {
        expect(transcriptMarkerOf(URL_TRANSCRIPT)).toMatchObject({
            origin: "url",
            mediaDocumentId: null,
            videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            durationSeconds: 95,
            segments: null,
        });
    });

    it("survives OCR completion merging its own keys in", () => {
        const merged = { ...UPLOAD_TRANSCRIPT, totalChunks: 3, processedAt: "2026-10-10" };
        expect(transcriptMarkerOf(merged)?.mediaDocumentId).toBe(12);
    });

    it("is null for anything that is not a transcript", () => {
        expect(transcriptMarkerOf(null)).toBeNull();
        expect(transcriptMarkerOf([])).toBeNull();
        expect(transcriptMarkerOf({ totalPages: 3 })).toBeNull();
        expect(transcriptMarkerOf({ source: "connector" })).toBeNull();
    });

    it("drops a link that is not a document id", () => {
        for (const audioDocumentId of [0, -4, 1.5, "12", null]) {
            expect(
                transcriptMarkerOf({ ...UPLOAD_TRANSCRIPT, audioDocumentId })?.mediaDocumentId
            ).toBeNull();
        }
    });
});

describe("normalizeSegments", () => {
    it("keeps well-formed segments in time order and drops the rest", () => {
        expect(
            normalizeSegments([
                { start: 5, end: 6, text: "b" },
                { start: 1, end: 2, text: "a" },
                { start: "x", end: 1, text: "bad start" },
                { start: 3, end: 4, text: "   " },
                { start: 7, end: 2, text: "end before start" },
                null,
            ])
        ).toEqual([
            { start: 1, end: 2, text: "a" },
            { start: 5, end: 6, text: "b" },
            { start: 7, end: 7, text: "end before start" },
        ]);
    });

    it("is null when nothing usable is left", () => {
        expect(normalizeSegments([])).toBeNull();
        expect(normalizeSegments("nope")).toBeNull();
        expect(normalizeSegments(undefined)).toBeNull();
    });
});

describe("transcriptMediaKind", () => {
    const marker = (overrides: Record<string, unknown>) =>
        transcriptMarkerOf({ ...UPLOAD_TRANSCRIPT, ...overrides })!;

    it("is video for a URL import", () => {
        expect(transcriptMediaKind(transcriptMarkerOf(URL_TRANSCRIPT)!)).toBe("video");
    });

    it("follows the recorded type, then the file name", () => {
        expect(transcriptMediaKind(marker({ mediaMimeType: "audio/mpeg" }))).toBe("audio");
        expect(
            transcriptMediaKind(marker({ mediaMimeType: undefined, audioFilename: "clip.mp4" }))
        ).toBe("video");
        expect(
            transcriptMediaKind(marker({ mediaMimeType: undefined, audioFilename: "memo.mp3" }))
        ).toBe("audio");
    });

    it("falls back to audio when nothing says otherwise (pre-marker uploads)", () => {
        expect(
            transcriptMediaKind(marker({ mediaMimeType: undefined, audioFilename: "recording" }))
        ).toBe("audio");
    });
});

describe("activeSegmentIndex", () => {
    const segments = [
        { start: 0, end: 2, text: "a" },
        { start: 2, end: 5, text: "b" },
        { start: 8, end: 10, text: "c" },
    ];

    it("is the last segment to have started", () => {
        expect(activeSegmentIndex(segments, 0)).toBe(0);
        expect(activeSegmentIndex(segments, 2)).toBe(1);
        expect(activeSegmentIndex(segments, 4.99)).toBe(1);
        expect(activeSegmentIndex(segments, 9)).toBe(2);
        expect(activeSegmentIndex(segments, 600)).toBe(2);
    });

    it("holds through a pause in speech", () => {
        expect(activeSegmentIndex(segments, 6.5)).toBe(1);
    });

    it("is -1 before the first segment or with none", () => {
        expect(activeSegmentIndex([{ start: 1, end: 2, text: "a" }], 0.5)).toBe(-1);
        expect(activeSegmentIndex([], 3)).toBe(-1);
    });
});

describe("formatMediaTime", () => {
    it("formats minutes and hours", () => {
        expect(formatMediaTime(0)).toBe("0:00");
        expect(formatMediaTime(9.9)).toBe("0:09");
        expect(formatMediaTime(75)).toBe("1:15");
        expect(formatMediaTime(3600 + 62)).toBe("1:01:02");
    });

    it("reads nonsense as zero", () => {
        expect(formatMediaTime(-5)).toBe("0:00");
        expect(formatMediaTime(Number.NaN)).toBe("0:00");
        expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    });
});

describe("transcript titles", () => {
    it("recognises and strips the suffix", () => {
        expect(hasTranscriptTitle("Standup.mp3 (Transcription)")).toBe(true);
        expect(hasTranscriptTitle("Standup.mp3")).toBe(false);
        expect(stripTranscriptSuffix("Standup.mp3 (Transcription)")).toBe("Standup.mp3");
        expect(stripTranscriptSuffix("(Transcription)")).toBe("(Transcription)");
    });
});

describe("getDocumentDisplayType for media", () => {
    it("plays an uploaded video as video and audio as audio", () => {
        expect(
            getDocumentDisplayType({ url: "/api/files/1", title: "a", mimeType: "video/mp4" })
        ).toBe("video");
        expect(
            getDocumentDisplayType({ url: "/api/files/1", title: "a", mimeType: "audio/x-m4a" })
        ).toBe("audio");
        expect(
            getDocumentDisplayType({ url: "/api/files/1", title: "clip.mov", mimeType: "" })
        ).toBe("video");
        expect(
            getDocumentDisplayType({
                url: "/api/files/1",
                title: "memo.mp3",
                mimeType: "application/octet-stream",
            })
        ).toBe("audio");
    });

    it("opens a transcript as the recording it was made from", () => {
        const base = { url: "/api/files/2", mimeType: "text/plain" };
        expect(
            getDocumentDisplayType({
                ...base,
                title: "standup.mp4 (Transcription)",
                ocrMetadata: UPLOAD_TRANSCRIPT,
            })
        ).toBe("video");
        expect(
            getDocumentDisplayType({
                ...base,
                title: "memo.mp3 (Transcription)",
                ocrMetadata: { ...UPLOAD_TRANSCRIPT, mediaMimeType: "audio/mpeg" },
            })
        ).toBe("audio");
        expect(
            getDocumentDisplayType({
                ...base,
                title: "Launch (Transcription)",
                ocrMetadata: URL_TRANSCRIPT,
            })
        ).toBe("video");
    });

    it("still recognises a legacy transcript by its title alone", () => {
        expect(
            getDocumentDisplayType({
                url: "/api/files/2",
                mimeType: "text/plain",
                title: "old.mp3 (Transcription)",
            })
        ).toBe("audio");
    });

    it("leaves plain text alone", () => {
        expect(
            getDocumentDisplayType({ url: "/api/files/2", mimeType: "text/plain", title: "x" })
        ).toBe("text");
    });
});
