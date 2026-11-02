import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithChatModelsScope } from "../chat-scope";
import type { ChatUsageEvent } from "../usage-meter";
import { estimateEmbeddingTokens, generateEmbeddings } from "./embeddings";

const config = {
    apiKey: "k",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-embedding-001",
    dimensions: 3,
    maxRetries: 1,
};

function respondWith(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("generateEmbeddings", () => {
    it("accepts Gemini's response, which has no usage and drops the zero index", async () => {
        // Shape observed from Google's OpenAI-compatible /embeddings on 2026-10-04.
        respondWith({
            object: "list",
            model: "gemini-embedding-001",
            data: [
                { object: "embedding", embedding: [1, 1, 1] },
                { object: "embedding", index: 1, embedding: [2, 2, 2] },
                { object: "embedding", index: 2, embedding: [3, 3, 3] },
            ],
        });

        const result = await generateEmbeddings(["a", "b", "c"], config);

        expect(result.embeddings).toEqual([
            [1, 1, 1],
            [2, 2, 2],
            [3, 3, 3],
        ]);
        expect(result.totalTokens).toBe(0);
    });

    it("orders by index and counts usage when the endpoint reports them", async () => {
        respondWith({
            object: "list",
            model: "text-embedding-3-large",
            data: [
                { object: "embedding", index: 1, embedding: [2, 2, 2, 9] },
                { object: "embedding", index: 0, embedding: [1, 1, 1, 9] },
            ],
            usage: { prompt_tokens: 7, total_tokens: 7 },
        });

        const result = await generateEmbeddings(["a", "b"], config);

        expect(result.embeddings).toEqual([
            [1, 1, 1],
            [2, 2, 2],
        ]);
        expect(result.totalTokens).toBe(7);
    });
});

describe("counting embedding requests", () => {
    function counted() {
        const events: ChatUsageEvent[] = [];
        return { events, usage: { record: (event: ChatUsageEvent) => events.push(event) } };
    }

    /** Answers each request with one vector per input and the given usage block. */
    function respondPerBatch(usage?: (inputs: string[]) => { total_tokens: number }) {
        const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
            const { input } = JSON.parse(init!.body as string) as { input: string[] };
            return new Response(
                JSON.stringify({
                    object: "list",
                    model: "m",
                    data: input.map((_, index) => ({ index, embedding: [1, 2, 3] })),
                    ...(usage ? { usage: { prompt_tokens: 0, ...usage(input) } } : {}),
                }),
                { status: 200 }
            );
        });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("reports each successful batch with the provider's count, on the deployment by default", async () => {
        respondPerBatch(input => ({ total_tokens: input.length * 10 }));
        const { events, usage } = counted();

        const result = await runWithChatModelsScope({ source: "deployment", usage }, () =>
            generateEmbeddings(["a", "b", "c"], {
                ...config,
                model: "text-embedding-3-large",
                batchSize: 2,
            })
        );

        expect(result.totalTokens).toBe(30);
        expect(events).toHaveLength(2);
        expect(events).toEqual(
            expect.arrayContaining([
                {
                    kind: "embedding",
                    modelId: "text-embedding-3-large",
                    owner: "deployment",
                    inputTokens: 20,
                    outputTokens: 0,
                },
                {
                    kind: "embedding",
                    modelId: "text-embedding-3-large",
                    owner: "deployment",
                    inputTokens: 10,
                    outputTokens: 0,
                },
            ])
        );
    });

    it("estimates four characters a token when the provider reports none (Gemini)", async () => {
        respondPerBatch();
        const { events, usage } = counted();

        const result = await runWithChatModelsScope({ source: "workspace", usage }, () =>
            // Nine characters, then one: ceil(10 / 4) = 3.
            generateEmbeddings(["123456789", "x"], { ...config, owner: "workspace" })
        );

        // The provider's own figure stays what it said: nothing.
        expect(result.totalTokens).toBe(0);
        expect(events).toEqual([
            {
                kind: "embedding",
                modelId: "gemini-embedding-001",
                owner: "workspace",
                inputTokens: 3,
                outputTokens: 0,
            },
        ]);
    });

    it("estimates when the provider reports zero, from the text it was sent", async () => {
        respondPerBatch(() => ({ total_tokens: 0 }));
        const { events, usage } = counted();

        await runWithChatModelsScope({ source: "deployment", usage }, () =>
            // Trimmed before sending: "abcdefgh" is eight characters, two tokens.
            generateEmbeddings(["  abcdefgh  "], config)
        );

        expect(events.map(event => event.inputTokens)).toEqual([2]);
    });

    it("reports nothing for a request that failed", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("quota exceeded", { status: 429 }))
        );
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { events, usage } = counted();

        await expect(
            runWithChatModelsScope({ source: "deployment", usage }, () =>
                generateEmbeddings(["a"], config)
            )
        ).rejects.toThrow(/429/);
        expect(events).toEqual([]);
        warn.mockRestore();
    });

    it("embeds outside any scope without counting or failing", async () => {
        respondPerBatch(() => ({ total_tokens: 4 }));
        const result = await generateEmbeddings(["a"], config);
        expect(result.embeddings).toEqual([[1, 2, 3]]);
    });
});

describe("estimateEmbeddingTokens", () => {
    it("rounds characters over four up, and is never below one", () => {
        expect(estimateEmbeddingTokens(["abcd", "e"])).toBe(2);
        expect(estimateEmbeddingTokens(["abcdefgh"])).toBe(2);
        expect(estimateEmbeddingTokens([""])).toBe(1);
        expect(estimateEmbeddingTokens([])).toBe(1);
    });
});
