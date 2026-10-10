/**
 * GET /api/documents/[id]/media — what the viewer plays for a media source,
 * asked about either half of the pair an upload becomes: the recording or
 * its transcript.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { GET } from "~/app/api/documents/[id]/media/route";
import type { MediaPreview } from "~/lib/media-document";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

// The scope predicate has its own tests; here it only feeds the fake `where`.
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: () => ({}),
}));

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
    },
}));

/**
 * One result per `db.select()` the route makes, in order. A lookup by id ends
 * at `where`; the transcript search goes on through `orderBy().limit()`.
 */
function selectReturns(...results: Record<string, unknown>[][]) {
    for (const rows of results) {
        const limit = jest.fn().mockResolvedValue(rows);
        const orderBy = jest.fn().mockReturnValue({ limit });
        const where = jest.fn().mockReturnValue(Object.assign(Promise.resolve(rows), { orderBy }));
        mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where }) });
    }
}

const SEGMENTS = [
    { start: 0, end: 4, text: "Welcome to the standup." },
    { start: 4, end: 9, text: "Billing is blocked." },
];

const VIDEO_DOC = {
    id: 1,
    title: "standup.mp4",
    url: "/api/files/1",
    mimeType: "video/mp4",
    ocrMetadata: null,
};

const VIDEO_TRANSCRIPT = {
    id: 3,
    title: "standup.mp4 (Transcription)",
    url: "/api/files/3",
    mimeType: "text/plain",
    ocrMetadata: {
        source: "transcription",
        audioDocumentId: 1,
        audioFilename: "standup.mp4",
        mediaMimeType: "video/mp4",
        language: "en",
        segments: SEGMENTS,
        totalChunks: 1,
    },
};

async function get(id: string) {
    const response = await GET(new Request(`http://localhost/api/documents/${id}/media`), {
        params: Promise.resolve({ id }),
    });
    return { status: response.status, body: (await response.json()) as MediaPreview };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: makeWorkspaceContext() });
});

describe("GET /api/documents/[id]/media", () => {
    it("plays a recording and finds the transcript made from it", async () => {
        selectReturns([VIDEO_DOC], [VIDEO_TRANSCRIPT]);

        const { status, body } = await get("1");

        expect(status).toBe(200);
        expect(body).toEqual({
            documentId: 1,
            title: "standup.mp4",
            kind: "video",
            playback: {
                type: "file",
                documentId: 1,
                url: "/api/documents/1/content",
                mimeType: "video/mp4",
            },
            transcript: {
                documentId: 3,
                title: "standup.mp4 (Transcription)",
                language: "en",
                segments: SEGMENTS,
            },
            durationSeconds: null,
        });
    });

    it("plays a recording that has no transcript yet", async () => {
        selectReturns([{ ...VIDEO_DOC, title: "memo.m4a", mimeType: "audio/x-m4a" }], []);

        const { body } = await get("1");

        expect(body.kind).toBe("audio");
        expect(body.playback).toMatchObject({ type: "file", url: "/api/documents/1/content" });
        expect(body.transcript).toBeNull();
    });

    it("tells audio from video by name when the stored type is a placeholder", async () => {
        selectReturns([{ ...VIDEO_DOC, mimeType: "application/octet-stream" }], []);

        const { body } = await get("1");

        expect(body.kind).toBe("video");
        expect(body.playback).toMatchObject({ mimeType: null });
    });

    it("opens a transcript with the recording it was made from", async () => {
        selectReturns([VIDEO_TRANSCRIPT], [VIDEO_DOC]);

        const { body } = await get("3");

        expect(body).toMatchObject({
            documentId: 3,
            title: "standup.mp4",
            kind: "video",
            playback: { type: "file", documentId: 1, url: "/api/documents/1/content" },
            transcript: { documentId: 3, segments: SEGMENTS },
        });
    });

    it("reports the recording missing when it is gone or out of the caller's scope", async () => {
        // The scoped lookup finds nothing either way — the answer must not say which.
        selectReturns([VIDEO_TRANSCRIPT], []);

        const { status, body } = await get("3");

        expect(status).toBe(200);
        expect(body.playback).toBeNull();
        expect(body.kind).toBe("video");
        expect(body.transcript).toMatchObject({ documentId: 3 });
    });

    it("frames a YouTube import in the platform's player", async () => {
        selectReturns([
            {
                id: 5,
                title: "Launch (Transcription)",
                url: "https://blob.example.test/t.txt",
                mimeType: "text/plain",
                ocrMetadata: {
                    source: "sidecar-ytdlp",
                    videoUrl: "https://youtu.be/dQw4w9WgXcQ?t=42",
                    videoDuration: 212,
                    language: "en",
                },
            },
        ]);

        const { body } = await get("5");

        expect(mockDbSelect).toHaveBeenCalledTimes(1);
        expect(body).toMatchObject({
            title: "Launch",
            kind: "video",
            durationSeconds: 212,
            playback: {
                type: "embed",
                provider: "youtube",
                embedUrl:
                    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1&start=42",
                startSeconds: 42,
            },
            transcript: { documentId: 5, segments: null },
        });
    });

    it("links out to a platform that cannot be framed", async () => {
        selectReturns([
            {
                id: 6,
                title: "Teaser (Transcription)",
                url: "https://blob.example.test/t.txt",
                mimeType: "text/plain",
                ocrMetadata: {
                    source: "sidecar-ytdlp",
                    videoUrl: "https://www.tiktok.com/@a/video/7300000000000000000",
                },
            },
        ]);

        const { body } = await get("6");

        expect(body.playback).toEqual({
            type: "link",
            url: "https://www.tiktok.com/@a/video/7300000000000000000",
            label: "TikTok",
        });
    });

    it("shows a legacy transcript, known only by its title, without a player", async () => {
        selectReturns([
            {
                id: 9,
                title: "old.mp3 (Transcription)",
                url: "/api/files/9",
                mimeType: "text/plain",
                ocrMetadata: { totalChunks: 2 },
            },
        ]);

        const { body } = await get("9");

        expect(body).toMatchObject({
            kind: "audio",
            playback: null,
            transcript: { documentId: 9, segments: null, language: null },
        });
    });

    it("is 404 for a document with no audio or video", async () => {
        selectReturns([
            { id: 2, title: "notes.pdf", url: "/api/files/2", mimeType: "application/pdf" },
        ]);

        const { status } = await get("2");

        expect(status).toBe(404);
    });

    it("is 404 for a document outside the caller's scope", async () => {
        selectReturns([]);

        const { status } = await get("1");

        expect(status).toBe(404);
    });

    it("is 400 for an id that is not a positive integer", async () => {
        for (const id of ["abc", "0", "1.5"]) {
            const { status } = await get(id);
            expect(status).toBe(400);
        }
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("requires a workspace session", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });

        const { status } = await get("1");

        expect(status).toBe(401);
        expect(mockDbSelect).not.toHaveBeenCalled();
    });
});
