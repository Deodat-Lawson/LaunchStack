import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureProviders } from "@launchstack/llm/providers/registry";
import { TRANSLATION_BATCH_LINES, languageNameOf, translateTranscriptLines } from "./translate";

/** A chat-completions reply carrying numbered translated lines. */
function reply(lines: { i: number; t: string }[]) {
    return Response.json({
        choices: [{ message: { content: JSON.stringify({ lines }) } }],
        usage: { total_tokens: 10 },
    });
}

function inputLines(init?: RequestInit): { i: number; t: string }[] {
    const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
    return (JSON.parse(body.messages[1]!.content) as { lines: { i: number; t: string }[] }).lines;
}

const NO_WAIT = { retryDelaysMs: [0, 0, 0, 0] };

describe("translateTranscriptLines", () => {
    beforeEach(() => {
        delete process.env.TRANSCRIPTION_API_BASE_URL;
        delete process.env.TRANSCRIPTION_API_KEY;
        delete process.env.TRANSCRIPTION_MODEL;
        configureProviders({ googleApiKey: "g" });
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        configureProviders({});
        vi.restoreAllMocks();
    });

    it("translates in batches and keeps every line in its place", async () => {
        const lines = Array.from({ length: TRANSLATION_BATCH_LINES * 2 + 5 }, (_, i) => `第${i}句`);
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
            reply(inputLines(init).map(({ i, t }) => ({ i, t: `EN(${t})` })))
        ) as unknown as typeof fetch;

        const result = await translateTranscriptLines(lines, "en", { fetchImpl, ...NO_WAIT });

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

    it("matches lines by number, so a merged reply cannot shift the rest", async () => {
        // The model answers out of order and folds two short replies into one
        // line, leaving index 2 out: index 3 must still land on line 3.
        const fetchImpl = vi.fn(async () =>
            reply([
                { i: 3, t: "Next week." },
                { i: 0, t: "Hello." },
                { i: 1, t: "Yes. OK." },
            ])
        ) as unknown as typeof fetch;

        const result = await translateTranscriptLines(
            ["你好。", "系。", "好。", "下星期。"],
            "en",
            {
                fetchImpl,
                ...NO_WAIT,
            }
        );

        expect(result.lines).toEqual(["Hello.", "Yes. OK.", "好。", "Next week."]);
    });

    it("asks again when too many lines are missing, then takes the full answer", async () => {
        let calls = 0;
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
            calls++;
            const lines = inputLines(init);
            return reply(
                calls === 1
                    ? lines.slice(0, 2)
                    : lines.map(({ i, t }) => ({ i, t: t.toUpperCase() }))
            );
        }) as unknown as typeof fetch;

        const result = await translateTranscriptLines(["a", "b", "c", "d", "e", "f"], "en", {
            fetchImpl,
            ...NO_WAIT,
        });

        expect(result.lines).toEqual(["A", "B", "C", "D", "E", "F"]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("rides out a 503 burst", async () => {
        let busy = 2;
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
            busy-- > 0
                ? Response.json({ error: { message: "high demand" } }, { status: 503 })
                : reply(inputLines(init).map(({ i }) => ({ i, t: "ok" })))
        ) as unknown as typeof fetch;

        const result = await translateTranscriptLines(["x"], "en", { fetchImpl, ...NO_WAIT });

        expect(result.lines).toEqual(["ok"]);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("does not retry a spent daily quota, and says so", async () => {
        const fetchImpl = vi.fn(async () =>
            Response.json(
                { error: { message: "Quota exceeded … Please retry in 6h20m49.9s." } },
                { status: 429 }
            )
        ) as unknown as typeof fetch;

        await expect(
            translateTranscriptLines(["x"], "en", { fetchImpl, ...NO_WAIT })
        ).rejects.toMatchObject({ userMessage: expect.stringMatching(/used up for today/) });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("fails rather than store a translation with most lines missing", async () => {
        const fetchImpl = vi.fn(async () => reply([])) as unknown as typeof fetch;
        await expect(
            translateTranscriptLines(["a", "b", "c", "d"], "en", { fetchImpl, ...NO_WAIT })
        ).rejects.toMatchObject({
            name: "TranscriptionError",
            userMessage: expect.stringMatching(/incomplete/),
        });
        expect(fetchImpl).toHaveBeenCalledTimes(5);
    });
});

describe("languageNameOf", () => {
    it("names languages in English", () => {
        expect(languageNameOf("yue")).toBe("Cantonese");
        expect(languageNameOf("zh-Hant")).toMatch(/Chinese/);
    });
});
