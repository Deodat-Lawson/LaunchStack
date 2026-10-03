import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureProviders } from "@launchstack/llm/providers/registry";
import { GeminiTranscriptionProvider } from "./gemini";

// A host without ffmpeg: the whole-file path. Chunking has its own tests.
vi.mock("./ffmpeg-chunks", () => ({ splitAudio: () => Promise.resolve(null) }));

const ENV_KEYS = ["TRANSCRIPTION_API_BASE_URL", "TRANSCRIPTION_API_KEY", "TRANSCRIPTION_MODEL"];

describe("GeminiTranscriptionProvider", () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        configureProviders({});
        vi.unstubAllGlobals();
    });

    it("sends an .m4a to Gemini's native API, not the wav/mp3-only compatibility layer", async () => {
        configureProviders({ googleApiKey: "g" });
        const fetchMock = vi.fn(async (input: string) =>
            input.endsWith(":countTokens")
                ? Response.json({ promptTokensDetails: [{ modality: "AUDIO", tokenCount: 320 }] })
                : Response.json({
                      candidates: [
                          {
                              content: {
                                  parts: [
                                      {
                                          text: JSON.stringify({
                                              language: "es",
                                              segments: [
                                                  { start: 0, end: 6, text: "Buenos días." },
                                              ],
                                          }),
                                      },
                                  ],
                              },
                              finishReason: "STOP",
                          },
                      ],
                      usageMetadata: { totalTokenCount: 400 },
                  })
        );
        vi.stubGlobal("fetch", fetchMock);

        const { data, usage } = await new GeminiTranscriptionProvider().transcribe(
            Buffer.from("m4a"),
            "es.m4a",
            { mimeType: "audio/x-m4a" }
        );

        const urls = fetchMock.mock.calls.map(c => c[0]);
        expect(urls.every(u => !u.includes("/openai/"))).toBe(true);
        expect(urls[0]).toBe(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens"
        );
        expect(data.language).toBe("es");
        expect(data.segments).toEqual([{ start: 0, end: 6, text: "Buenos días." }]);
        expect(data.durationSeconds).toBe(10);
        expect(usage.tokensUsed).toBe(400);
    });

    it("uses the default model when TRANSCRIPTION_MODEL is blank, as Compose passes it", () => {
        configureProviders({ googleApiKey: "g" });
        process.env.TRANSCRIPTION_MODEL = "";
        expect(new GeminiTranscriptionProvider().name).toBe("transcription:gemini-3.8-flash");
    });

    it("tells the uploader why another vendor's endpoint cannot take an .m4a", async () => {
        configureProviders({ aiBaseUrl: "https://openrouter.ai/api/v1", aiApiKey: "o" });
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            new GeminiTranscriptionProvider().transcribe(Buffer.from("x"), "memo.m4a")
        ).rejects.toMatchObject({
            name: "TranscriptionError",
            userMessage: expect.stringContaining("only accepts MP3 and WAV"),
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("still sends mp3 to another vendor's endpoint as input_audio", async () => {
        configureProviders({ aiBaseUrl: "https://openrouter.ai/api/v1", aiApiKey: "o" });
        const fetchMock = vi.fn(async () =>
            Response.json({ choices: [{ message: { content: "hello" } }] })
        );
        vi.stubGlobal("fetch", fetchMock);

        const { data } = await new GeminiTranscriptionProvider().transcribe(
            Buffer.from("x"),
            "talk.mp3"
        );

        expect(data.text).toBe("hello");
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(init.body as string).toContain('"format":"mp3"');
    });

    it("says transcription is not set up when there is no key", async () => {
        configureProviders({});
        await expect(
            new GeminiTranscriptionProvider().transcribe(Buffer.from("x"), "a.mp3")
        ).rejects.toMatchObject({ userMessage: expect.stringMatching(/no API key/) });
    });
});
