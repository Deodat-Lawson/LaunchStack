jest.mock("@launchstack/conversion", () => ({
    shouldTranscribeFile: jest.fn(() => true),
    transcribeAudioFromUrl: jest.fn(),
    isVideoUrl: jest.fn(() => false),
    transcribeVideoFromUrl: jest.fn(),
}));

jest.mock("@launchstack/llm/embeddings", () => ({
    resolveIngestIndexKey: jest.fn(),
}));

jest.mock("~/server/engine", () => ({
    getEngine: jest.fn(() => ({})),
}));

jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn(),
}));

jest.mock("~/server/storage/vercel-blob", () => ({
    putFile: jest.fn(),
}));

jest.mock("~/server/services/document-creation", () => ({
    createDocumentLifecycle: jest.fn(),
}));

const mockDeleteDocumentCore = jest.fn().mockResolvedValue(undefined);
jest.mock("~/server/services/document-delete", () => ({
    deleteDocumentCore: (...args: unknown[]) => mockDeleteDocumentCore(...args) as unknown,
}));

jest.mock("~/server/db", () => ({
    db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn("tx") },
}));

jest.mock("~/lib/credits", () => ({
    hasTokens: jest.fn(),
}));

// Default to a self-hosted deployment, which is what an unset DEPLOYMENT_MODE
// resolves to. Individual tests override this to exercise the cloud gate.
jest.mock("@launchstack/store/credits", () => ({
    isMeteringEnforced: jest.fn(() => false),
}));

import {
    transcribeAudioFromUrl,
    shouldTranscribeFile,
    isVideoUrl,
    transcribeVideoFromUrl,
} from "@launchstack/conversion";
import { processDocumentUpload, processVideoUrlUpload } from "~/server/services/document-upload";
import { uploadFile } from "~/lib/storage";
import { putFile } from "~/server/storage/vercel-blob";
import { createDocumentLifecycle } from "~/server/services/document-creation";
import { hasTokens } from "~/lib/credits";
import { isMeteringEnforced } from "@launchstack/store/credits";

const mockTranscribeAudioFromUrl = transcribeAudioFromUrl as jest.Mock;
const mockIsVideoUrl = isVideoUrl as jest.Mock;
const mockTranscribeVideoFromUrl = transcribeVideoFromUrl as jest.Mock;
const mockPutFile = putFile as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;
const mockCreateDocumentLifecycle = createDocumentLifecycle as jest.Mock;
const mockHasTokens = hasTokens as jest.Mock;
const mockIsMeteringEnforced = isMeteringEnforced as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockIsMeteringEnforced.mockReturnValue(false);
});

describe("processDocumentUpload audio lifecycle", () => {
    it("rejects transcript lifecycle failures instead of returning source-only success", async () => {
        const transcriptError = new Error("transcript lifecycle dispatch failed");
        const audioUrl = "https://blob.test/meeting.mp3";

        mockCreateDocumentLifecycle
            .mockResolvedValueOnce({
                document: {
                    id: 12,
                    title: "meeting.mp3",
                    url: audioUrl,
                    category: "Audio",
                },
                jobId: "audio-source-job",
                eventIds: ["audio-source-event"],
            })
            .mockRejectedValueOnce(transcriptError);
        mockTranscribeAudioFromUrl.mockResolvedValue({
            text: "Transcript text",
            language: "en",
            confidence: 0.99,
            segments: [],
        });
        mockUploadFile.mockResolvedValue({
            url: "https://blob.test/meeting-transcription.txt",
        });

        await expect(
            processDocumentUpload({
                user: { userId: "user-1", companyId: 7n },
                documentName: "meeting.mp3",
                rawDocumentUrl: audioUrl,
                requestUrl: "https://app.test/upload",
                category: "Audio",
                mimeType: "audio/mpeg",
                originalFilename: "meeting.mp3",
                creationKey: "upload:meeting",
            })
        ).rejects.toBe(transcriptError);

        expect(mockCreateDocumentLifecycle).toHaveBeenCalledTimes(2);
        expect(mockCreateDocumentLifecycle).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ creationKey: "upload:meeting:audio-source" })
        );
        expect(mockCreateDocumentLifecycle).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ creationKey: "upload:meeting:audio-transcript" })
        );
        expect(mockUploadFile).toHaveBeenCalledTimes(1);
    });
});

describe("processDocumentUpload when transcription fails", () => {
    it("creates no document at all, so a retry starts clean", async () => {
        const failure = new Error("Gemini said no");
        mockTranscribeAudioFromUrl.mockRejectedValue(failure);

        await expect(
            processDocumentUpload({
                user: { userId: "user-1", companyId: 7n },
                documentName: "oct_15_3_pm_HT.m4a",
                rawDocumentUrl: "https://files.test/oct_15_3_pm_HT.m4a",
                requestUrl: "https://app.test/upload",
                mimeType: "audio/x-m4a",
                originalFilename: "oct_15_3_pm_HT.m4a",
            })
        ).rejects.toBe(failure);

        expect(mockCreateDocumentLifecycle).not.toHaveBeenCalled();
        expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("removes the recording row it made when the transcript row then fails", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const rowFailure = new Error("transcript row insert failed");
        mockTranscribeAudioFromUrl.mockResolvedValue({
            text: "大家好",
            language: "yue",
            confidence: 0,
            segments: [{ start: 0, end: 1, text: "大家好" }],
        });
        mockUploadFile.mockResolvedValue({ url: "/api/files/9" });
        mockCreateDocumentLifecycle
            .mockResolvedValueOnce({
                document: { id: 41, title: "memo.m4a", url: "/api/files/8", category: "" },
                created: true,
                jobId: null,
                eventIds: [],
            })
            .mockRejectedValueOnce(rowFailure);

        try {
            await expect(
                processDocumentUpload({
                    user: { userId: "user-1", companyId: 7n },
                    documentName: "memo.m4a",
                    rawDocumentUrl: "https://files.test/memo.m4a",
                    requestUrl: "https://app.test/upload",
                    mimeType: "audio/x-m4a",
                    originalFilename: "memo.m4a",
                })
            ).rejects.toBe(rowFailure);

            expect(mockDeleteDocumentCore).toHaveBeenCalledWith("tx", 41);
            // The transcript text was stored before either row.
            expect(mockUploadFile.mock.invocationCallOrder[0]).toBeLessThan(
                mockCreateDocumentLifecycle.mock.invocationCallOrder[0]!
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it("leaves an earlier upload's recording row alone when this attempt fails", async () => {
        mockTranscribeAudioFromUrl.mockResolvedValue({
            text: "hi",
            language: "en",
            confidence: 0,
            segments: [],
        });
        mockUploadFile.mockResolvedValue({ url: "/api/files/9" });
        mockCreateDocumentLifecycle
            .mockResolvedValueOnce({
                document: { id: 42, title: "memo.m4a", url: "/api/files/8", category: "" },
                created: false,
                jobId: null,
                eventIds: [],
            })
            .mockRejectedValueOnce(new Error("insert failed"));

        await expect(
            processDocumentUpload({
                user: { userId: "user-1", companyId: 7n },
                documentName: "memo.m4a",
                rawDocumentUrl: "https://files.test/memo.m4a",
                requestUrl: "https://app.test/upload",
                mimeType: "audio/x-m4a",
                originalFilename: "memo.m4a",
            })
        ).rejects.toThrow("insert failed");
        expect(mockDeleteDocumentCore).not.toHaveBeenCalled();
    });

    it("hands the browser's type to the transcriber", async () => {
        mockTranscribeAudioFromUrl.mockRejectedValue(new Error("stop here"));

        await processDocumentUpload({
            user: { userId: "user-1", companyId: 7n },
            documentName: "memo",
            rawDocumentUrl: "https://files.test/memo",
            requestUrl: "https://app.test/upload",
            mimeType: "audio/x-m4a",
            originalFilename: "memo.m4a",
        }).catch(() => undefined);

        expect(mockTranscribeAudioFromUrl).toHaveBeenCalledWith(
            "https://files.test/memo",
            "memo.m4a",
            7n,
            "audio/x-m4a"
        );
    });
});

/**
 * The transcript row's metadata is what the media viewer reads: which
 * recording to play, whether it has a picture, and the timestamped lines.
 */
describe("transcript metadata for the media viewer", () => {
    const SEGMENTS = [{ start: 0, end: 2.5, text: "Hello." }];

    function lifecycle(id: number, title: string, url: string) {
        return {
            document: { id, title, url, category: "Media" },
            jobId: `job-${id}`,
            eventIds: [`event-${id}`],
        };
    }

    it("links an upload's transcript to the recording, its type and its timestamps", async () => {
        mockCreateDocumentLifecycle
            .mockResolvedValueOnce(lifecycle(12, "standup.mp4", "/api/files/4"))
            .mockResolvedValueOnce(lifecycle(13, "standup.mp4 (Transcription)", "/api/files/5"));
        mockTranscribeAudioFromUrl.mockResolvedValue({
            text: "Hello.",
            language: "en",
            confidence: 0.9,
            segments: SEGMENTS,
        });
        mockUploadFile.mockResolvedValue({ url: "/api/files/5" });

        await processDocumentUpload({
            user: { userId: "user-1", companyId: 7n },
            documentName: "standup.mp4",
            rawDocumentUrl: "https://blob.test/standup.mp4",
            requestUrl: "https://app.test/upload",
            category: "Media",
            mimeType: "video/mp4",
            originalFilename: "standup.mp4",
        });

        expect(mockCreateDocumentLifecycle).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                mimeType: "text/plain",
                ocrMetadata: expect.objectContaining({
                    source: "transcription",
                    audioDocumentId: 12,
                    mediaMimeType: "video/mp4",
                    segments: SEGMENTS,
                }) as unknown,
            })
        );
    });

    it("reports both rows of a media upload as new, and neither on a converged retry", async () => {
        const upload = () =>
            processDocumentUpload({
                user: { userId: "user-1", companyId: 7n },
                documentName: "standup.mp4",
                rawDocumentUrl: "https://blob.test/standup.mp4",
                requestUrl: "https://app.test/upload",
                category: "Media",
                mimeType: "video/mp4",
                originalFilename: "standup.mp4",
            });
        mockTranscribeAudioFromUrl.mockResolvedValue({
            text: "Hello.",
            language: "en",
            confidence: 0.9,
            segments: SEGMENTS,
        });
        mockUploadFile.mockResolvedValue({ url: "/api/files/5" });

        mockCreateDocumentLifecycle
            .mockResolvedValueOnce({
                ...lifecycle(12, "standup.mp4", "/api/files/4"),
                created: true,
            })
            .mockResolvedValueOnce({
                ...lifecycle(13, "standup.mp4 (Transcription)", "/api/files/5"),
                created: true,
            });
        const first = await upload();
        expect(first.document.id).toBe(12);
        expect(first.createdDocuments.map(d => d.id)).toEqual([12, 13]);

        mockCreateDocumentLifecycle
            .mockResolvedValueOnce({
                ...lifecycle(12, "standup.mp4", "/api/files/4"),
                created: false,
            })
            .mockResolvedValueOnce({
                ...lifecycle(13, "standup.mp4 (Transcription)", "/api/files/5"),
                created: false,
            });
        const retry = await upload();
        expect(retry.createdDocuments).toEqual([]);
    });

    it("keeps a URL import's timestamps beside the page it came from", async () => {
        mockIsVideoUrl.mockReturnValue(true);
        mockTranscribeVideoFromUrl.mockResolvedValue({
            text: "Hello.",
            language: "en",
            confidence: 0.8,
            title: "Launch",
            duration: 95,
            source_url: "https://youtu.be/dQw4w9WgXcQ",
            segments: SEGMENTS,
        });
        mockPutFile.mockResolvedValue({ url: "https://blob.test/launch.txt" });
        mockCreateDocumentLifecycle.mockResolvedValueOnce(
            lifecycle(20, "Launch (Transcription)", "https://blob.test/launch.txt")
        );

        await processVideoUrlUpload({
            user: { userId: "user-1", companyId: 7n },
            videoUrl: "https://youtu.be/dQw4w9WgXcQ",
            requestUrl: "https://app.test/upload",
            category: "Media",
        });

        expect(mockCreateDocumentLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                ocrMetadata: expect.objectContaining({
                    source: "sidecar-ytdlp",
                    videoUrl: "https://youtu.be/dQw4w9WgXcQ",
                    videoDuration: 95,
                    segments: SEGMENTS,
                }) as unknown,
            })
        );
    });
});

/**
 * The credit gate, in both directions.
 *
 * This is the check that used to run unconditionally, because isCloudMode()
 * was hardcoded to `true`. On a self-hosted instance that made uploads fail
 * permanently once a workspace exhausted its signup grant — with no way to add
 * credits from anywhere in the product.
 *
 * Note these are Jest tests rather than compose-smoke ones on purpose: the
 * smoke script (scripts/ci/e2e-ingest.mjs) calls createDocumentLifecycle
 * directly and never enters processDocumentUpload, so it cannot catch a
 * regression here in either direction.
 */
describe("processDocumentUpload credit gate", () => {
    const upload = () =>
        processDocumentUpload({
            user: { userId: "user-1", companyId: 7n },
            documentName: "notes.txt",
            rawDocumentUrl: "https://blob.test/notes.txt",
            requestUrl: "https://app.test/upload",
            category: "Docs",
            mimeType: "text/plain",
            originalFilename: "notes.txt",
            creationKey: "upload:notes",
        });

    beforeEach(() => {
        (shouldTranscribeFile as jest.Mock).mockReturnValue(false);
        mockCreateDocumentLifecycle.mockResolvedValue({
            document: {
                id: 1,
                title: "notes.txt",
                url: "https://blob.test/notes.txt",
                category: "Docs",
            },
            jobId: "job-1",
            eventIds: ["event-1"],
        });
    });

    it("does not consult the balance when metering only records", async () => {
        mockIsMeteringEnforced.mockReturnValue(false);
        // Zero balance. A self-hosted instance must still accept the upload.
        mockHasTokens.mockResolvedValue(false);

        await expect(upload()).resolves.toBeDefined();

        expect(mockHasTokens).not.toHaveBeenCalled();
        expect(mockCreateDocumentLifecycle).toHaveBeenCalled();
    });

    it("still refuses to overdraw when metering is enforced", async () => {
        mockIsMeteringEnforced.mockReturnValue(true);
        mockHasTokens.mockResolvedValue(false);

        await expect(upload()).rejects.toThrow(/run out of processing credits/);

        expect(mockCreateDocumentLifecycle).not.toHaveBeenCalled();
    });

    it("proceeds under enforcement when the balance covers the estimate", async () => {
        mockIsMeteringEnforced.mockReturnValue(true);
        mockHasTokens.mockResolvedValue(true);

        await expect(upload()).resolves.toBeDefined();

        expect(mockHasTokens).toHaveBeenCalledWith(7n, expect.any(Number));
        expect(mockCreateDocumentLifecycle).toHaveBeenCalled();
    });
});
