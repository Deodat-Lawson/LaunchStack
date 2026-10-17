import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureProviders } from "@launchstack/llm/providers/registry";
import { TRANSLATION_BATCH_LINES, languageNameOf, translateTranscriptLines } from "./translate";

/** A chat-completions reply that "translates" by tagging each line. */
function reply(lines: string[]) {
    return Response.json({
        choices: [{ message: { content: JSON.stringify({ lines }) } }],
        usage: { total_tokens: 10 },
    });
}

function inputLines(init?: RequestInit): string[] {
    const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
    return (JSON.parse(body.messages[1]!.content) as { lines: string[] }).lines;
}

describe("translateTranscriptLines", () => {
    beforeEach(() => {
        delete process.env.TRANSCRIPTION_API_BASE_URL;
        delete process.env.TRANSCRIPTION_API_KEY;
        delete process.env.TRANSCRIPTION_MODEL;
        configureProviders({ googleApiKey: "g" });
    });

    afterEach(() => {
        configureProviders({});
    });

    it("translates in batches and keeps every line in its place", async () => {
        const lines = Array.from({ length: TRANSLATION_BATCH_LINES * 2 + 5 }, (_, i) => `第${i}句`);
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
            reply(inputLines(init).map(l => `EN(${l})`))
        ) as unknown as typeof fetch;

        const result = await translateTranscriptLines(lines, "en", { fetchImpl });

        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(result.lines).toEqual(lines.map(l => `EN(${l})`));
        expect(result.model).toBe("gemini-3.8-flash");
        const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
        expect(url).toBe(
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        );
        const body = JSON.parse(init!.body as string) as Record<string, unknown>;
        expect(body.reasoning_effort).toBe("low");
        expect(JSON.stringify(body.messages)).toContain("English (en)");
    });

    it("retries a batch whose reply does not line up, once", async () => {
        let calls = 0;
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
            calls++;
            const lines = inputLines(init);
            return reply(calls === 1 ? lines.slice(1) : lines.map(l => l.toUpperCase()));
        }) as unknown as typeof fetch;

        const result = await translateTranscriptLines(["a", "b"], "en", {
            fetchImpl,
            retryDelayMs: 0,
        });

        expect(result.lines).toEqual(["A", "B"]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("fails rather than store a translation with lines missing", async () => {
        const fetchImpl = vi.fn(async () => reply(["only one"])) as unknown as typeof fetch;
        await expect(
            translateTranscriptLines(["a", "b"], "en", { fetchImpl, retryDelayMs: 0 })
        ).rejects.toMatchObject({
            name: "TranscriptionError",
            userMessage: expect.stringMatching(/incomplete/),
        });
    });

    it("keeps the original for a line the model left blank", async () => {
        const fetchImpl = vi.fn(async () => reply(["Hello", ""])) as unknown as typeof fetch;
        const result = await translateTranscriptLines(["你好", "OK"], "en", { fetchImpl });
        expect(result.lines).toEqual(["Hello", "OK"]);
    });
});

describe("languageNameOf", () => {
    it("names languages in English", () => {
        expect(languageNameOf("yue")).toBe("Cantonese");
        expect(languageNameOf("zh-Hant")).toMatch(/Chinese/);
    });
});
