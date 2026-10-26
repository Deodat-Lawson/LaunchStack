/**
 * /api/voice/speech-to-text answers in the reader's language: its own
 * refusals, and the transcription provider's sentence, which the provider
 * writes in English. API readers (no cookie) keep the English.
 */

const mockRequireWorkspaceContext = jest.fn();
const mockTranscribe = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/server/engine", () => ({ getEngine: () => undefined }));

jest.mock("@launchstack/conversion/audio-transcription", () => {
    class TranscriptionError extends Error {
        userMessage: string;
        status: number;

        constructor(message: string, userMessage: string, status = 422) {
            super(message);
            this.userMessage = userMessage;
            this.status = status;
        }
    }
    return {
        TranscriptionError,
        isTranscriptionError: (error: unknown) => error instanceof TranscriptionError,
        getTranscriptionProvider: () => Promise.resolve({ transcribe: mockTranscribe }),
    };
});

import { TranscriptionError } from "@launchstack/conversion/audio-transcription";
import { POST } from "~/app/api/voice/speech-to-text/route";

function upload(audio: Blob | null, chinese = false): Request {
    const form = new FormData();
    if (audio) form.append("audio", audio, "recording.wav");
    return new Request("http://localhost/api/voice/speech-to-text", {
        method: "POST",
        headers: chinese ? { cookie: "ls-locale=zh-CN.1" } : {},
        body: form,
    });
}

const recording = () => new Blob([new Uint8Array(200)], { type: "audio/wav" });

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: { companyId: 1n, authUserId: "user_1" },
    });
});

describe("POST /api/voice/speech-to-text", () => {
    it("asks for the audio in the reader's language", async () => {
        const english = await POST(upload(null));
        expect(await english.json()).toEqual({ error: "Audio file is required" });

        const chinese = await POST(upload(null, true));
        expect(chinese.status).toBe(400);
        expect(await chinese.json()).toEqual({ error: "需要提供音频文件" });
    });

    it("words the provider's sentence for a Chinese reader, values and all", async () => {
        mockTranscribe.mockRejectedValue(
            new TranscriptionError(
                "Gemini has no audio format for recording.wav",
                ".webm recordings can't be transcribed. Use MP3, M4A, MP4, WAV, AAC, FLAC or OGG.",
                422
            )
        );

        const english = await POST(upload(recording()));
        expect(english.status).toBe(422);
        expect(await english.json()).toEqual({
            error: ".webm recordings can't be transcribed. Use MP3, M4A, MP4, WAV, AAC, FLAC or OGG.",
        });

        const chinese = await POST(upload(recording(), true));
        expect(await chinese.json()).toEqual({
            error: "无法转录 .webm 格式的录音。请使用 MP3、M4A、MP4、WAV、AAC、FLAC 或 OGG。",
        });
    });

    it("keeps a provider sentence it has no words for as it came", async () => {
        mockTranscribe.mockRejectedValue(
            new TranscriptionError("detail", "Something the catalogue has never seen.", 502)
        );

        const chinese = await POST(upload(recording(), true));
        expect(await chinese.json()).toEqual({ error: "Something the catalogue has never seen." });
    });
});
