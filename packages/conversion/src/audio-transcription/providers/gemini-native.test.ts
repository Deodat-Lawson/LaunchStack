import { describe, expect, it, vi } from "vitest";

import { TranscriptionError } from "../errors";
import {
    GeminiNativeTranscriber,
    INLINE_MAX_BYTES,
    WINDOW_SECONDS,
    gapLine,
    geminiNativeRoot,
    mergeWindows,
    nativeAudioMimeType,
    normaliseLanguage,
    planWindows,
    retryAfterSeconds,
    windowPrompt,
} from "./gemini-native";

const ROOT = "https://generativelanguage.googleapis.com";

/** A Gemini reply carrying a transcript window. */
function windowReply(
    body: { language: string; languages?: string[]; segments: object[] },
    finishReason = "STOP"
) {
    return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason }],
        usageMetadata: { totalTokenCount: 100 },
    });
}

/** Where a window prompt says its last line should end ("…the last ends by 1800"). */
function endsBy(prompt: string): number | null {
    const m = /ends by (\d+)/.exec(prompt);
    return m ? Number(m[1]) : null;
}

function countReply(seconds: number) {
    return Response.json({
        totalTokens: seconds * 32,
        promptTokensDetails: [{ modality: "AUDIO", tokenCount: seconds * 32 }],
    });
}

/** Route each Gemini call to a handler by what it asks for. */
function fakeGemini(handlers: {
    count: (body: Record<string, unknown>) => Response;
    generate: (body: Record<string, unknown>, prompt: string) => Response;
}) {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body =
            typeof init?.body === "string"
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : undefined;
        calls.push({ url, method, body });
        if (url.endsWith(":countTokens")) return handlers.count(body!);
        if (url.endsWith(":generateContent")) {
            const parts = (body!.contents as { parts: { text?: string }[] }[])[0]!.parts;
            return handlers.generate(body!, parts.find(p => p.text)?.text ?? "");
        }
        if (url === `${ROOT}/upload/v1beta/files`) {
            return new Response(null, {
                status: 200,
                headers: { "x-goog-upload-url": `${ROOT}/upload/session/1` },
            });
        }
        if (url === `${ROOT}/upload/session/1`) {
            return Response.json({
                file: {
                    name: "files/abc",
                    uri: `${ROOT}/v1beta/files/abc`,
                    mimeType: "audio/m4a",
                    state: "PROCESSING",
                },
            });
        }
        if (url === `${ROOT}/v1beta/files/abc` && method === "GET") {
            return Response.json({
                name: "files/abc",
                uri: `${ROOT}/v1beta/files/abc`,
                mimeType: "audio/m4a",
                state: "ACTIVE",
            });
        }
        if (url === `${ROOT}/v1beta/files/abc` && method === "DELETE") {
            return Response.json({});
        }
        throw new Error(`unexpected call ${method} ${url}`);
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

/** A host without ffmpeg, unless a test hands in a chunker. */
function transcriber(fetchImpl: typeof fetch, splitAudio: SplitAudio | null = null) {
    return new GeminiNativeTranscriber({
        root: ROOT,
        apiKey: "k",
        model: "gemini-3.8-flash",
        fetchImpl,
        pollMs: 0,
        splitAudio,
        retryDelaysMs: [0, 0, 0],
    });
}

type SplitAudio = NonNullable<
    ConstructorParameters<typeof GeminiNativeTranscriber>[0]["splitAudio"]
>;

describe("nativeAudioMimeType", () => {
    it.each([
        ["memo.m4a", "audio/x-m4a", "audio/m4a"],
        ["call.mp4", "video/mp4", "audio/mp4"],
        ["talk.MP3", "audio/mpeg", "audio/mp3"],
        ["notes.wav", undefined, "audio/wav"],
        ["clip.aac", undefined, "audio/aac"],
        ["clip.flac", undefined, "audio/flac"],
        ["clip.ogg", undefined, "audio/ogg"],
        ["recording", "audio/x-m4a", "audio/m4a"],
    ])("%s (%s) → %s", (name, mime, expected) => {
        expect(nativeAudioMimeType(name, mime)).toBe(expected);
    });

    it("has nothing for a type Gemini cannot read", () => {
        expect(nativeAudioMimeType("old.wma", "audio/x-ms-wma")).toBeNull();
        expect(nativeAudioMimeType("recording", undefined)).toBeNull();
    });
});

describe("geminiNativeRoot", () => {
    it("recognises Google's endpoint, however the URL was named", () => {
        expect(geminiNativeRoot(`${ROOT}/v1beta/openai`)).toBe(ROOT);
        expect(geminiNativeRoot("https://openrouter.ai/api/v1")).toBeNull();
    });
});

describe("planWindows", () => {
    it("is one window for a short recording", () => {
        expect(planWindows(300)).toEqual([{ start: 0, end: 300 }]);
    });

    it("covers a long recording with contiguous windows", () => {
        const windows = planWindows(4914);
        expect(windows[0]!.start).toBe(0);
        expect(windows.at(-1)!.end).toBe(4914);
        for (let i = 1; i < windows.length; i++) {
            expect(windows[i]!.start).toBe(windows[i - 1]!.end);
        }
        expect(windows.every(w => w.end - w.start <= WINDOW_SECONDS + 60)).toBe(true);
    });

    it("folds a sliver at the end into the last window", () => {
        const windows = planWindows(WINDOW_SECONDS * 2 + 30);
        expect(windows).toHaveLength(2);
        expect(windows[1]!.end).toBe(WINDOW_SECONDS * 2 + 30);
    });
});

describe("windowPrompt", () => {
    it("names the range of a window and forbids translating", () => {
        const prompt = windowPrompt({ start: 1200, end: 2400 }, 4914);
        expect(prompt).toContain("from 20:00 to 40:00");
        expect(prompt).toMatch(/never translate/i);
    });

    it("asks for the whole of a recording that is one window", () => {
        expect(windowPrompt({ start: 0, end: 300 }, 300)).toContain("Transcribe all of the speech");
    });
});

describe("mergeWindows", () => {
    it("orders segments, keeps a boundary line once and weighs the main language", () => {
        const merged = mergeWindows(
            [
                {
                    language: "yue",
                    languages: ["yue", "en"],
                    segments: [
                        { start: 0, end: 4, text: "大家好" },
                        { start: 1198, end: 1201, text: "同一句" },
                    ],
                    tokens: 1,
                },
                {
                    language: "en",
                    languages: [],
                    segments: [
                        { start: 1199, end: 1201, text: "同一句" },
                        { start: 1205, end: 1210, text: "OK" },
                    ],
                    tokens: 1,
                },
            ],
            2000
        );
        expect(merged.segments!.map(s => s.text)).toEqual(["大家好", "同一句", "OK"]);
        expect(merged.language).toBe("yue");
        expect(merged.languages).toEqual(["yue", "en"]);
        expect(merged.text).toBe("大家好\n同一句\nOK");
    });

    it("says unknown when nothing intelligible was said", () => {
        const merged = mergeWindows([{ language: "", languages: [], segments: [], tokens: 0 }], 10);
        expect(merged.language).toBe("unknown");
        expect(merged.segments).toEqual([]);
    });
});

describe("retryAfterSeconds", () => {
    it.each([
        ["Please retry in 7h46m39.323119948s.", 7 * 3600 + 46 * 60 + 39.323119948],
        ["Please retry in 28s.", 28],
        ["Please retry in 1m5s", 65],
        ["Resource exhausted", null],
    ])("%j → %j", (message, expected) => {
        const got = retryAfterSeconds(message);
        if (expected === null) expect(got).toBeNull();
        else expect(got).toBeCloseTo(expected, 3);
    });
});

describe("normaliseLanguage", () => {
    it.each([
        ["ZH-hant", "zh-Hant"],
        ["yue", "yue"],
        ["en_US", "en-US"],
        ["", null],
        ["und", null],
        ["not a code!", null],
    ])("%j → %j", (code, expected) => {
        expect(normaliseLanguage(code)).toBe(expected);
    });
});

describe("GeminiNativeTranscriber", () => {
    it("sends a small recording inline with its real type and returns timestamps and language", async () => {
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(9),
            generate: () =>
                windowReply({
                    language: "zh",
                    segments: [
                        { start: 0, end: 1.1, text: "大家好，" },
                        { start: 1.1, end: 8.7, text: "今天的会议我们讨论销售计划。" },
                    ],
                }),
        });

        const { result } = await transcriber(fetchImpl).transcribe(
            Buffer.from("m4a-bytes"),
            "zh.m4a",
            { mimeType: "audio/x-m4a" }
        );

        expect(result.language).toBe("zh");
        expect(result.durationSeconds).toBe(9);
        expect(result.segments).toHaveLength(2);
        expect(result.text).toBe("大家好，\n今天的会议我们讨论销售计划。");
        const generate = calls.find(c => c.url.endsWith(":generateContent"))!;
        const media = (generate.body!.contents as { parts: Record<string, unknown>[] }[])[0]!
            .parts[0]!;
        expect(media).toEqual({
            inlineData: {
                mimeType: "audio/m4a",
                data: Buffer.from("m4a-bytes").toString("base64"),
            },
        });
        // No file was stored, so none is deleted.
        expect(calls.some(c => c.method === "DELETE")).toBe(false);
    });

    it("stores a large recording through the Files API, transcribes it in windows, then deletes it", async () => {
        const prompts: string[] = [];
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(4914),
            generate: (_body, prompt) => {
                prompts.push(prompt);
                const from = Number(/about (\d+)/.exec(prompt)?.[1] ?? 0);
                const to = endsBy(prompt) ?? 4914;
                return windowReply({
                    language: "yue",
                    languages: ["yue", "en"],
                    segments: [
                        { start: from, end: from + 5, text: `line at ${from}` },
                        { start: to - 30, end: to - 1, text: `last before ${to}` },
                    ],
                });
            },
        });

        const { result } = await transcriber(fetchImpl).transcribe(
            Buffer.alloc(INLINE_MAX_BYTES + 1),
            "oct_15_3_pm_HT.m4a",
            { mimeType: "audio/x-m4a" }
        );

        expect(prompts).toHaveLength(planWindows(4914).length);
        expect(
            result.segments!.filter(s => s.text.startsWith("line at")).map(s => s.start)
        ).toEqual(planWindows(4914).map(w => w.start));
        expect(result.language).toBe("yue");
        expect(result.languages).toEqual(["yue", "en"]);
        const generate = calls.find(c => c.url.endsWith(":generateContent"))!;
        const media = (generate.body!.contents as { parts: Record<string, unknown>[] }[])[0]!
            .parts[0]!;
        expect(media).toEqual({
            fileData: { mimeType: "audio/m4a", fileUri: `${ROOT}/v1beta/files/abc` },
        });
        expect(calls.filter(c => c.method === "DELETE").map(c => c.url)).toEqual([
            `${ROOT}/v1beta/files/abc`,
        ]);
    });

    it("splits a window whose reply hit the output cap", async () => {
        let first = true;
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(600),
            generate: (_body, prompt) => {
                if (first) {
                    first = false;
                    return windowReply({ language: "en", segments: [] }, "MAX_TOKENS");
                }
                const from = Number(/about (\d+)/.exec(prompt)?.[1] ?? 0);
                const to = endsBy(prompt) ?? 600;
                return windowReply({
                    language: "en",
                    segments: [
                        { start: from, end: from + 1, text: `half from ${from}` },
                        { start: to - 10, end: to - 1, text: `end of ${to}` },
                    ],
                });
            },
        });

        const { result } = await transcriber(fetchImpl).transcribe(Buffer.from("x"), "a.mp3");

        expect(calls.filter(c => c.url.endsWith(":generateContent"))).toHaveLength(3);
        expect(result.segments!.map(s => s.text)).toEqual([
            "half from 0",
            "end of 300",
            "half from 300",
            "end of 600",
        ]);
    });

    it("still deletes the stored file when transcription fails", async () => {
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(60),
            generate: () =>
                Response.json(
                    {
                        error: {
                            code: 429,
                            message: "Resource exhausted",
                            status: "RESOURCE_EXHAUSTED",
                        },
                    },
                    { status: 429 }
                ),
        });

        await expect(
            transcriber(fetchImpl).transcribe(Buffer.alloc(INLINE_MAX_BYTES + 1), "big.m4a")
        ).rejects.toMatchObject({
            name: "TranscriptionError",
            status: 502,
            userMessage: expect.stringMatching(/busy/i),
        });
        expect(calls.some(c => c.method === "DELETE")).toBe(true);
    });

    it("asks for the rest when a reply stops well short of its window", async () => {
        const asked: string[] = [];
        const { fetchImpl } = fakeGemini({
            count: () => countReply(1800),
            generate: (_body, prompt) => {
                asked.push(prompt);
                // First answer: sections up to 18:46, then a premature stop.
                if (asked.length === 1) {
                    return windowReply({
                        language: "en",
                        segments: [
                            { start: 0, end: 2, text: "Section one." },
                            { start: 1123, end: 1126, text: "End of section thirty one." },
                        ],
                    });
                }
                return windowReply({
                    language: "en",
                    segments: [
                        { start: 1127, end: 1130, text: "Section thirty two." },
                        { start: 1795, end: 1799, text: "End of section forty eight." },
                    ],
                });
            },
        });

        const { result } = await transcriber(fetchImpl).transcribe(Buffer.from("x"), "long.m4a");

        expect(asked).toHaveLength(2);
        expect(asked[1]).toContain("from 18:46 to 30:00");
        expect(result.segments!.map(s => s.text)).toEqual([
            "Section one.",
            "End of section thirty one.",
            "Section thirty two.",
            "End of section forty eight.",
        ]);
    });

    it("does not chase silence: an empty continuation ends the window", async () => {
        let calls = 0;
        const { fetchImpl } = fakeGemini({
            count: () => countReply(1800),
            generate: () => {
                calls++;
                return windowReply({
                    language: "en",
                    segments: calls === 1 ? [{ start: 0, end: 60, text: "Short memo." }] : [],
                });
            },
        });

        const { result } = await transcriber(fetchImpl).transcribe(Buffer.from("x"), "memo.m4a");

        expect(calls).toBe(2);
        expect(result.text).toBe("Short memo.");
    });

    it("retries Gemini's high-demand 503s, then carries on", async () => {
        let busy = 2;
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(60),
            generate: () =>
                busy-- > 0
                    ? Response.json(
                          {
                              error: {
                                  message: "This model is currently experiencing high demand.",
                              },
                          },
                          { status: 503 }
                      )
                    : windowReply({ language: "en", segments: [{ start: 0, end: 2, text: "Hi" }] }),
        });

        const { result } = await transcriber(fetchImpl).transcribe(Buffer.from("x"), "a.mp3");

        expect(result.text).toBe("Hi");
        expect(calls.filter(c => c.url.endsWith(":generateContent"))).toHaveLength(3);
    });

    it("gives up on a 503 that outlasts the retries, saying Gemini is overloaded", async () => {
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(60),
            generate: () =>
                Response.json(
                    { error: { message: "This model is currently experiencing high demand." } },
                    { status: 503 }
                ),
        });

        await expect(
            transcriber(fetchImpl).transcribe(Buffer.from("x"), "a.mp3")
        ).rejects.toMatchObject({
            status: 502,
            userMessage: expect.stringMatching(/overloaded/),
        });
        // The first try and one per retry delay.
        expect(calls.filter(c => c.url.endsWith(":generateContent"))).toHaveLength(4);
    });

    it("does not retry a spent daily quota, and says so plainly", async () => {
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(60),
            generate: () =>
                Response.json(
                    {
                        error: {
                            message:
                                "You exceeded your current quota. * Quota exceeded for metric: generate_content_free_tier_requests, limit: 20\nPlease retry in 7h46m39.3s.",
                        },
                    },
                    { status: 429 }
                ),
        });

        await expect(
            transcriber(fetchImpl).transcribe(Buffer.from("x"), "a.mp3")
        ).rejects.toMatchObject({
            status: 502,
            userMessage: expect.stringMatching(/used up for today.*enable billing/),
        });
        expect(calls.filter(c => c.url.endsWith(":generateContent"))).toHaveLength(1);
    });

    it("keeps the rest of a recording when a few minutes come back empty, marking the gap", async () => {
        const { fetchImpl } = fakeGemini({
            count: () => countReply(600),
            generate: (_body, prompt) => {
                const from = Number(/about (\d+)/.exec(prompt)?.[1] ?? 0);
                // The whole and the 0–5 min halves come back with no candidate at all.
                if (!prompt.includes("about") || from < 300) {
                    return Response.json({ usageMetadata: { totalTokenCount: 9 } });
                }
                return windowReply({
                    language: "yue",
                    segments: [{ start: from, end: from + 4, text: "大家好" }],
                });
            },
        });

        const { result } = await transcriber(fetchImpl).transcribe(Buffer.from("x"), "a.m4a");

        expect(result.language).toBe("yue");
        expect(result.segments!.map(s => s.text)).toContain("大家好");
        expect(result.segments!.some(s => s.text === gapLine("00:00–02:30"))).toBe(true);
    });

    it("fails when most of the recording comes back empty", async () => {
        const { fetchImpl } = fakeGemini({
            count: () => countReply(600),
            generate: () => Response.json({ usageMetadata: { totalTokenCount: 9 } }),
        });

        await expect(
            transcriber(fetchImpl).transcribe(Buffer.from("x"), "a.m4a")
        ).rejects.toMatchObject({
            userMessage: expect.stringMatching(/nothing usable/),
        });
    });

    it("refuses a recording over Gemini's 9.5 hour limit with a reason", async () => {
        const { fetchImpl } = fakeGemini({
            count: () => countReply(10 * 3600),
            generate: () => windowReply({ language: "en", segments: [] }),
        });
        await expect(
            transcriber(fetchImpl).transcribe(Buffer.from("x"), "day.mp3")
        ).rejects.toThrow(TranscriptionError);
    });

    it("refuses a format Gemini has no type for, before any call", async () => {
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(1),
            generate: () => windowReply({ language: "en", segments: [] }),
        });
        await expect(
            transcriber(fetchImpl).transcribe(Buffer.from("x"), "old.wma", {
                mimeType: "audio/x-ms-wma",
            })
        ).rejects.toMatchObject({ userMessage: expect.stringContaining(".wma") });
        expect(calls).toHaveLength(0);
    });

    it("sends each ffmpeg chunk on its own and shifts its timestamps into place", async () => {
        const chunker = vi.fn<SplitAudio>(async () => ({
            duration: 4914,
            chunks: [
                { start: 0, end: 1800, bytes: Buffer.from("c0") },
                { start: 1800, end: 3600, bytes: Buffer.from("c1") },
                { start: 3600, end: 4914, bytes: Buffer.from("c2") },
            ],
        }));
        const sent: string[] = [];
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(0),
            generate: body => {
                const media = (
                    body.contents as { parts: { inlineData?: { data: string } }[] }[]
                )[0]!.parts[0]!;
                const name = Buffer.from(media.inlineData!.data, "base64").toString();
                sent.push(name);
                // Each chunk's reply runs to its own end, timed from its own start.
                const span = { c0: 1800, c1: 1800, c2: 1314 }[name] ?? 0;
                return windowReply({
                    language: "yue",
                    segments: [
                        { start: 0, end: 4, text: `first of ${name}` },
                        { start: 10, end: span - 1, text: `rest of ${name}` },
                    ],
                });
            },
        });

        const { result } = await transcriber(fetchImpl, chunker).transcribe(
            Buffer.alloc(INLINE_MAX_BYTES + 1),
            "oct_15_3_pm_HT.m4a",
            { mimeType: "audio/x-m4a" }
        );

        expect(chunker).toHaveBeenCalledWith(
            expect.any(Buffer),
            "oct_15_3_pm_HT.m4a",
            WINDOW_SECONDS
        );
        expect(sent.sort()).toEqual(["c0", "c1", "c2"]);
        // Nothing stored, nothing counted: the chunks went inline.
        expect(calls.some(c => c.url.includes("/files") || c.url.endsWith(":countTokens"))).toBe(
            false
        );
        expect(result.durationSeconds).toBe(4914);
        expect(result.segments!.map(s => s.start)).toEqual([0, 10, 1800, 1810, 3600, 3610]);
        expect(result.segments!.at(-1)!.end).toBe(4913);
    });

    it("says a recording ffmpeg cannot decode can't be read", async () => {
        const { fetchImpl, calls } = fakeGemini({
            count: () => countReply(1),
            generate: () => windowReply({ language: "en", segments: [] }),
        });
        const broken = vi.fn<SplitAudio>(async () => {
            throw new Error("Invalid data found when processing input");
        });

        await expect(
            transcriber(fetchImpl, broken).transcribe(Buffer.from("junk"), "memo.m4a")
        ).rejects.toMatchObject({ userMessage: expect.stringMatching(/couldn't be decoded/) });
        expect(calls).toHaveLength(0);
    });

    it("transcribes dictation in one plain call", async () => {
        const fetchImpl = vi.fn(async () =>
            Response.json({
                candidates: [{ content: { parts: [{ text: "hola a todos" }] } }],
                usageMetadata: { totalTokenCount: 12 },
            })
        ) as unknown as typeof fetch;

        const { result } = await transcriber(fetchImpl).transcribe(
            Buffer.from("wav"),
            "recording.wav",
            { timestamps: false }
        );

        expect(result.text).toBe("hola a todos");
        expect(result.segments).toBeUndefined();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
