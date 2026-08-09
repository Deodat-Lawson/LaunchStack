jest.mock("@launchstack/features/voice", () => ({
    shouldTranscribeFile: jest.fn(() => true),
    transcribeAudioFromUrl: jest.fn(),
    isVideoUrl: jest.fn(() => false),
    transcribeVideoFromUrl: jest.fn(),
}));

jest.mock("@launchstack/core/embeddings", () => ({
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

jest.mock("~/lib/credits", () => ({
    hasTokens: jest.fn(),
}));

jest.mock("@launchstack/core/providers/registry", () => ({
    isCloudMode: jest.fn(() => false),
}));

import { transcribeAudioFromUrl } from "@launchstack/features/voice";
import { processDocumentUpload } from "~/server/services/document-upload";
import { uploadFile } from "~/lib/storage";
import { createDocumentLifecycle } from "~/server/services/document-creation";

const mockTranscribeAudioFromUrl = transcribeAudioFromUrl as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;
const mockCreateDocumentLifecycle = createDocumentLifecycle as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
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
