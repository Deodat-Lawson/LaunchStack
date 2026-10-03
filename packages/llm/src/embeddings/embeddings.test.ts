import { afterEach, describe, expect, it, vi } from "vitest";

import { generateEmbeddings } from "./embeddings";

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
