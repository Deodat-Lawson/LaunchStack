import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureProviders } from "@launchstack/llm/providers/registry";
import {
    TRANSLATION_BATCH_LINES,
    echoMatches,
    languageNameOf,
    translateTranscriptLines,
} from "./translate";

/** A chat-completions reply carrying numbered translated lines (each quoting its source as `s`). */
function reply(lines: { i: number; s?: string; t: string }[]) {
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
            reply(inputLines(init).map(({ i, t }) => ({ i, s: t, t: `EN(${t})` })))
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
                { i: 3, s: "下星期。", t: "Next week." },
                { i: 0, s: "你好。", t: "Hello." },
                { i: 1, s: "系。", t: "Yes. OK." },
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

    it("asks again for just the lines a reply left out", async () => {
        const asked: number[][] = [];
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
            const lines = inputLines(init);
            asked.push(lines.map(l => l.i));
            // First reply covers two of six lines; the repair covers the rest.
            const answer = asked.length === 1 ? lines.slice(0, 2) : lines;
            return reply(answer.map(({ i, t }) => ({ i, s: t, t: t.toUpperCase() })));
        }) as unknown as typeof fetch;

        const result = await translateTranscriptLines(["a", "b", "c", "d", "e", "f"], "en", {
            fetchImpl,
            ...NO_WAIT,
        });

        expect(result.lines).toEqual(["A", "B", "C", "D", "E", "F"]);
        expect(asked).toEqual([
            [0, 1, 2, 3, 4, 5],
            [2, 3, 4, 5],
        ]);
    });

    it("re-asks lines a merged, renumbered reply put under the wrong number", async () => {
        const lines = Array.from({ length: 10 }, (_, i) => `第${i}句話`);
        const asked: number[][] = [];
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
            const items = inputLines(init);
            asked.push(items.map(x => x.i));
            if (items.length === 10) {
                // Lines 1 and 2 merged into one answer, every later line numbered one too low,
                // each quoting the line it really translated.
                return reply([
                    { i: 0, s: lines[0]!, t: "T0" },
                    { i: 1, s: lines[1]!, t: "T1 T2" },
                    ...items.slice(3).map((x, k) => ({ i: k + 2, s: x.t, t: `T${x.i}` })),
                ]);
            }
            return reply(items.map(x => ({ i: x.i, s: x.t, t: `T${x.i}` })));
        }) as unknown as typeof fetch;

        const result = await translateTranscriptLines(lines, "en", { fetchImpl, ...NO_WAIT });

        // Every line ends up with its own translation; only 0 and 1 came from the first reply.
        expect(result.lines).toEqual([
            "T0",
            "T1 T2",
            "T2",
            "T3",
            "T4",
            "T5",
            "T6",
            "T7",
            "T8",
            "T9",
        ]);
        expect(asked[1]).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("rides out a 503 burst", async () => {
        let busy = 2;
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
            busy-- > 0
                ? Response.json({ error: { message: "high demand" } }, { status: 503 })
                : reply(inputLines(init).map(({ i, t }) => ({ i, s: t, t: "ok" })))
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
        // A round that makes no progress ends the asking.
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});

describe("echoMatches", () => {
    it.each([
        ["今天的会议我们讨论第三季度的销售计划。", "今天的会议我们讨论第三", true],
        ["系。", "系", true],
        ["So today we are opening a", "So today we a", true],
        ["  Hola a todos.", "hola a todo", true],
        ["今天的会议我们讨论第三季度的销售计划。", "我们需要在11月之前完成", false],
        ["系。", "好", false],
        ["anything", "", false],
    ])("%j quoted as %j → %s", (source, echo, expected) => {
        expect(echoMatches(source, echo)).toBe(expected);
    });
});

describe("languageNameOf", () => {
    it("names languages in English", () => {
        expect(languageNameOf("yue")).toBe("Cantonese");
        expect(languageNameOf("zh-Hant")).toMatch(/Chinese/);
    });
});
