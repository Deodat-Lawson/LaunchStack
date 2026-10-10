import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.fn();
const transcribe = vi.fn();

vi.mock("@launchstack/runtime/storage", () => ({
    getStoragePort: () => ({ download }),
}));
vi.mock("@launchstack/store/credits", () => ({
    creditsDebitSafe: vi.fn(),
}));
vi.mock("./providers", () => ({
    getTranscriptionProvider: () => Promise.resolve({ name: "fake", transcribe }),
}));

import { shouldTranscribeFile, transcribeAudioFromUrl } from "./transcribe";
import { SidecarTranscriptionProvider } from "./providers/sidecar";

const SEGMENTS = [
    { start: 0, end: 1.5, text: "hello" },
    { start: 1.5, end: 3, text: "world" },
];

describe("shouldTranscribeFile", () => {
    it.each(["audio/mpeg", "audio/mp3", "video/mp4", "audio/mp4", "audio/x-m4a", "audio/m4a"])(
        "transcribes %s",
        mime => {
            expect(shouldTranscribeFile(mime, "anything")).toBe(true);
        }
    );

    it("reads the type case-insensitively", () => {
        expect(shouldTranscribeFile("Audio/X-M4A", "memo.m4a")).toBe(true);
    });

    it("trusts a specific type over the file name", () => {
        expect(shouldTranscribeFile("audio/wav", "memo.mp3")).toBe(false);
        expect(shouldTranscribeFile("application/pdf", "clip.mp4")).toBe(false);
    });

    it("decides by file name when the type is missing or a placeholder", () => {
        for (const mime of [undefined, "", "application/octet-stream"]) {
            expect(shouldTranscribeFile(mime, "memo.m4a")).toBe(true);
            expect(shouldTranscribeFile(mime, "talk.MP3")).toBe(true);
            expect(shouldTranscribeFile(mime, "clip.mp4")).toBe(true);
            expect(shouldTranscribeFile(mime, "notes.wav")).toBe(false);
        }
        expect(shouldTranscribeFile(undefined, undefined)).toBe(false);
    });
});

describe("transcription timestamps", () => {
    beforeEach(() => {
        download.mockReset();
        transcribe.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("hands back the provider's segments with the transcript", async () => {
        download.mockResolvedValue(new Response("audio-bytes"));
        transcribe.mockResolvedValue({
            data: { text: "hello world", language: "en", confidence: 0.9, segments: SEGMENTS },
            usage: { tokensUsed: 0, details: {} },
        });

        const result = await transcribeAudioFromUrl("http://app/api/files/1", "a.mp3");

        expect(result.segments).toEqual(SEGMENTS);
    });

    it("leaves segments out when the provider reports none", async () => {
        download.mockResolvedValue(new Response("audio-bytes"));
        transcribe.mockResolvedValue({
            data: { text: "hello world", language: "unknown", confidence: 0 },
            usage: { tokensUsed: 0, details: {} },
        });

        const result = await transcribeAudioFromUrl("http://app/api/files/1", "a.mp3");

        expect(result).not.toHaveProperty("segments");
    });

    it("keeps the service's segments through the self-hosted provider", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                Response.json({
                    text: "hello world",
                    language: "en",
                    confidence: 0.87,
                    filename: "a.m4a",
                    segments: SEGMENTS,
                })
            )
        );

        const { data } = await new SidecarTranscriptionProvider().transcribe(
            Buffer.from("x"),
            "a.m4a"
        );

        expect(data.segments).toEqual(SEGMENTS);
    });

    it("tolerates a service build that predates segments", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                Response.json({
                    text: "hi",
                    language: "en",
                    confidence: 0.5,
                    filename: "a.mp3",
                })
            )
        );

        const { data } = await new SidecarTranscriptionProvider().transcribe(
            Buffer.from("x"),
            "a.mp3"
        );

        expect(data).not.toHaveProperty("segments");
        expect(data.text).toBe("hi");
    });
});
