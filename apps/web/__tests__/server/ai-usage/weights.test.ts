/**
 * Chat-token equivalents: a chat token counts one, and an embedding token or
 * a paid web search counts what it costs over what a standard chat token
 * costs. These pin the defaults, the three AI_USAGE_* overrides and the
 * Standard model's declared price as the reference.
 */

const mockEnv = {
    server: {
        AI_USAGE_CHAT_PRICE_PER_MTOK: undefined as string | undefined,
        AI_USAGE_EMBEDDING_PRICE_PER_MTOK: undefined as string | undefined,
        AI_USAGE_WEB_SEARCH_PRICE_PER_1K: undefined as string | undefined,
        AI_USAGE_PRICES: undefined as string | undefined,
    },
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));

const mockChatModelsConfig = jest.fn();
jest.mock("~/server/chat-models", () => ({
    getAppChatModelsConfig: (...args: unknown[]) => mockChatModelsConfig(...args) as unknown,
}));

import type { ChatUsageEvent } from "@launchstack/llm";

import {
    conversionRates,
    embeddingPricePerMillion,
    embeddingTokensAsChat,
    standardChatPrice,
    weighUsage,
    webUnitPrice,
} from "~/server/ai-usage/weights";

type Pricing = { input: number; output: number; cachedInput?: number };

/** A chat-models config whose Standard route is `primary`, priced as given. */
function modelsConfig(primary?: Pricing) {
    return {
        models: new Map<string, { pricing?: Pricing }>([
            ["primary", primary ? { pricing: primary } : {}],
            // A cheaper model on another route must not set the reference.
            ["quick", { pricing: { input: 0.1, output: 0.4 } }],
        ]),
        routes: { default: "primary", fast: "quick" },
    };
}

const embedding = (modelId: string | undefined, inputTokens: number): ChatUsageEvent => ({
    kind: "embedding",
    modelId,
    owner: "deployment",
    inputTokens,
    outputTokens: 0,
});

const search = (
    modelId: string,
    kind: "web_search" | "web_contents" = "web_search",
    calls?: number
): ChatUsageEvent => ({
    kind,
    modelId,
    owner: "deployment",
    inputTokens: 0,
    outputTokens: 0,
    ...(calls === undefined ? {} : { calls }),
});

beforeEach(() => {
    mockEnv.server.AI_USAGE_CHAT_PRICE_PER_MTOK = undefined;
    mockEnv.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK = undefined;
    mockEnv.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K = undefined;
    mockChatModelsConfig.mockReset();
    // The shipped config/chat-models.yaml declares no price.
    mockChatModelsConfig.mockReturnValue(modelsConfig());
});

describe("standardChatPrice", () => {
    it("is $1.00 per million when neither the operator nor the Standard model sets one", () => {
        expect(standardChatPrice()).toEqual({ perMillion: 1, source: "default" });
    });

    it("falls back to the default when the model file cannot be read", () => {
        mockChatModelsConfig.mockImplementation(() => {
            throw new Error("CHAT_MODELS_CONFIG points at a missing file");
        });
        expect(standardChatPrice()).toEqual({ perMillion: 1, source: "default" });
    });

    it("blends the Standard model's declared price, three input tokens to one output", () => {
        mockChatModelsConfig.mockReturnValue(modelsConfig({ input: 1.25, output: 4.25 }));
        // (3 × 1.25 + 4.25) / 4 = 2.00
        expect(standardChatPrice()).toEqual({ perMillion: 2, source: "model" });
    });

    it("takes AI_USAGE_CHAT_PRICE_PER_MTOK over the model's price", () => {
        mockChatModelsConfig.mockReturnValue(modelsConfig({ input: 1.25, output: 4.25 }));
        mockEnv.server.AI_USAGE_CHAT_PRICE_PER_MTOK = " 2.50 ";
        expect(standardChatPrice()).toEqual({ perMillion: 2.5, source: "setting" });
    });

    it("ignores a setting that is empty, zero, negative or not a number", () => {
        mockChatModelsConfig.mockReturnValue(modelsConfig({ input: 1.25, output: 4.25 }));
        for (const value of ["", "  ", "0", "-1", "cheap"]) {
            mockEnv.server.AI_USAGE_CHAT_PRICE_PER_MTOK = value;
            expect(standardChatPrice()).toEqual({ perMillion: 2, source: "model" });
        }
    });
});

describe("the defaults, against a $1.00 chat token", () => {
    it("counts a million text-embedding-3-large tokens as 130,000", () => {
        const weighed = weighUsage(embedding("text-embedding-3-large", 1_000_000));
        expect(weighed.weightedTokens).toBe(130_000);
        expect(weighed.costUsd).toBeCloseTo(0.13, 10);
    });

    it("prices each listed embedding model at its list price", () => {
        expect(weighUsage(embedding("text-embedding-3-small", 1_000_000)).weightedTokens).toBe(
            20_000
        );
        expect(weighUsage(embedding("text-embedding-ada-002", 1_000_000)).weightedTokens).toBe(
            100_000
        );
        expect(weighUsage(embedding("gemini-embedding-001", 1_000_000)).weightedTokens).toBe(
            150_000
        );
    });

    it("counts one Exa search as 7,000, one Serper search as 1,000", () => {
        const exa = weighUsage(search("exa"));
        expect(exa.weightedTokens).toBe(7_000);
        expect(exa.costUsd).toBeCloseTo(0.007, 10);
        expect(weighUsage(search("serper")).weightedTokens).toBe(1_000);
    });

    it("counts each page Exa read as 2,000", () => {
        expect(weighUsage(search("exa", "web_contents", 1)).weightedTokens).toBe(2_000);
        const pages = weighUsage(search("exa", "web_contents", 3));
        expect(pages.weightedTokens).toBe(6_000);
        expect(pages.costUsd).toBeCloseTo(0.006, 10);
    });

    it("prices a search from a provider it does not list at Exa's rate", () => {
        expect(weighUsage(search("brave")).weightedTokens).toBe(7_000);
        expect(webUnitPrice("web_search", undefined)).toBeCloseTo(0.007, 10);
    });

    it("prices no pages for a provider with no contents endpoint", () => {
        expect(webUnitPrice("web_contents", "serper")).toBe(0);
        expect(weighUsage(search("serper", "web_contents", 4)).weightedTokens).toBe(0);
    });
});

describe("the overrides", () => {
    it("AI_USAGE_CHAT_PRICE_PER_MTOK moves every other kind, never chat itself", () => {
        mockEnv.server.AI_USAGE_CHAT_PRICE_PER_MTOK = "2";
        expect(weighUsage(embedding("text-embedding-3-large", 1_000_000)).weightedTokens).toBe(
            65_000
        );
        expect(weighUsage(search("exa")).weightedTokens).toBe(3_500);
        expect(
            weighUsage({ owner: "deployment", inputTokens: 900, outputTokens: 100 }).weightedTokens
        ).toBe(1_000);
    });

    it("AI_USAGE_EMBEDDING_PRICE_PER_MTOK replaces every embedding model's list price", () => {
        mockEnv.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK = "0.02";
        expect(embeddingPricePerMillion("text-embedding-3-large")).toBe(0.02);
        expect(embeddingPricePerMillion("some-new-embedder")).toBe(0.02);
        const weighed = weighUsage(embedding("text-embedding-3-large", 1_000_000));
        expect(weighed.weightedTokens).toBe(20_000);
        expect(weighed.costUsd).toBeCloseTo(0.02, 10);
    });

    it("AI_USAGE_WEB_SEARCH_PRICE_PER_1K prices every search, not the pages read", () => {
        mockEnv.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K = "5";
        expect(weighUsage(search("exa")).weightedTokens).toBe(5_000);
        expect(weighUsage(search("serper")).weightedTokens).toBe(5_000);
        expect(weighUsage(search("exa", "web_contents", 1)).weightedTokens).toBe(2_000);
    });

    it("ignores an override that is not a number", () => {
        mockEnv.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK = "cheap";
        mockEnv.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K = "";
        expect(embeddingPricePerMillion("text-embedding-3-small")).toBe(0.02);
        expect(webUnitPrice("web_search", "serper")).toBeCloseTo(0.001, 10);
    });
});

describe("against the Standard model's declared price", () => {
    it("weighs embeddings and searches by that price instead of $1.00", () => {
        mockChatModelsConfig.mockReturnValue(modelsConfig({ input: 1.25, output: 4.25 }));
        expect(weighUsage(embedding("text-embedding-3-large", 1_000_000)).weightedTokens).toBe(
            65_000
        );
        expect(weighUsage(search("exa")).weightedTokens).toBe(3_500);
    });

    it("uses the price it is handed, when the caller already has one", () => {
        expect(
            weighUsage(search("exa"), { perMillion: 0.5, source: "setting" }).weightedTokens
        ).toBe(14_000);
        expect(mockChatModelsConfig).not.toHaveBeenCalled();
    });
});

describe("embedding model ids", () => {
    it("prices a model it does not list, or none, like text-embedding-3-large", () => {
        expect(embeddingPricePerMillion("some-new-embedder")).toBe(0.13);
        expect(embeddingPricePerMillion(undefined)).toBe(0.13);
        expect(weighUsage(embedding("some-new-embedder", 1_000_000)).weightedTokens).toBe(130_000);
    });

    it("reads a provider-prefixed id as the bare model, ignoring case and spaces", () => {
        expect(embeddingPricePerMillion("openai/text-embedding-3-small")).toBe(0.02);
        expect(embeddingPricePerMillion("models/gemini-embedding-001")).toBe(0.15);
        expect(embeddingPricePerMillion(" OpenAI/Text-Embedding-3-Small ")).toBe(0.02);
        expect(
            weighUsage(embedding("openai/text-embedding-3-small", 1_000_000)).weightedTokens
        ).toBe(20_000);
    });
});

describe("weighUsage", () => {
    it("keeps a chat call's declared cost and counts its tokens one for one", () => {
        expect(
            weighUsage({
                owner: "deployment",
                inputTokens: 1_000,
                outputTokens: 200,
                reasoningTokens: 50,
                cachedInputTokens: 600,
                costUsd: 0.0042,
            })
        ).toEqual({ weightedTokens: 1_200, costUsd: 0.0042 });
    });

    it("leaves an unpriced chat call unpriced", () => {
        expect(
            weighUsage({ kind: "chat", owner: "workspace", inputTokens: 5, outputTokens: 7 })
        ).toEqual({ weightedTokens: 12 });
    });

    it("weighs an embedding on a workspace's own endpoint but leaves it unpriced", () => {
        expect(
            weighUsage({ ...embedding("text-embedding-3-large", 1_000_000), owner: "workspace" })
        ).toEqual({ weightedTokens: 130_000 });
    });

    it("rounds an embedding up to a whole token", () => {
        // Ten text-embedding-3-small tokens cost 0.2 of a chat token.
        expect(weighUsage(embedding("text-embedding-3-small", 10)).weightedTokens).toBe(1);
        // 123,456 × $0.13 / 1M = $0.01604928 → 16,049.28.
        expect(weighUsage(embedding("text-embedding-3-large", 123_456)).weightedTokens).toBe(
            16_050
        );
    });

    it("counts searches by calls, never below zero", () => {
        expect(weighUsage(search("exa", "web_search", 3)).weightedTokens).toBe(21_000);
        expect(weighUsage(search("exa", "web_search", 0))).toEqual({
            weightedTokens: 0,
            costUsd: 0,
        });
        expect(weighUsage(search("exa", "web_search", -2)).weightedTokens).toBe(0);
    });
});

describe("embeddingTokensAsChat", () => {
    it("is the embedding's weight", () => {
        expect(embeddingTokensAsChat(1_000_000, "text-embedding-3-large")).toBe(130_000);
        expect(embeddingTokensAsChat(1_000, undefined)).toBe(130);
    });

    it("is always at least 1", () => {
        expect(embeddingTokensAsChat(1, "text-embedding-3-small")).toBe(1);
        expect(embeddingTokensAsChat(0, "text-embedding-3-large")).toBe(1);
    });
});

const chat = (over: Partial<ChatUsageEvent> = {}): ChatUsageEvent => ({
    modelId: "vendor/model",
    owner: "deployment",
    inputTokens: 3000,
    outputTokens: 1000,
    ...over,
});

describe("chat weighed by its price against the Standard model's", () => {
    beforeEach(() => {
        mockEnv.server.AI_USAGE_PRICES = undefined;
        mockEnv.server.AI_USAGE_CHAT_PRICE_PER_MTOK = undefined;
        mockChatModelsConfig.mockReset();
    });

    it("counts an unpriced model one for one, as before", () => {
        mockChatModelsConfig.mockReturnValue(modelsConfig({ input: 0.3, output: 2.5 }));
        expect(weighUsage(chat()).weightedTokens).toBe(4000);
    });

    it("counts the Standard model itself one for one, and a dearer one by its ratio", () => {
        // Standard blends to (3 × 0.3 + 2.5) / 4 = 0.85 per 1M.
        mockChatModelsConfig.mockReturnValue(modelsConfig({ input: 0.3, output: 2.5 }));
        const standard = weighUsage(
            chat({ pricing: { input: 0.3, output: 2.5 }, costUsd: 0.0034 })
        );
        expect(standard.weightedTokens).toBe(4000);
        expect(standard.costUsd).toBe(0.0034);
        // Four times the blended price (3.4 per 1M) counts four per token.
        const dear = weighUsage(chat({ pricing: { input: 1.2, output: 10 } }));
        expect(dear.weightedTokens).toBe(16_000);
        // No meter cost on the event: priced from the declared price.
        expect(dear.costUsd).toBeCloseTo((3000 * 1.2 + 1000 * 10) / 1_000_000, 12);
    });

    it("prices a model the model file doesn't, from AI_USAGE_PRICES (with or without a vendor prefix)", () => {
        mockChatModelsConfig.mockReturnValue(modelsConfig());
        mockEnv.server.AI_USAGE_PRICES = JSON.stringify({
            chat: { "gpt-5-mini": { input: 0.25, output: 2 }, "llama3.1:8b": { ratio: 0 } },
        });
        // No Standard price anywhere: a chat token costs $1.00 per 1M.
        // gpt-5-mini blends to (3 × 0.25 + 2) / 4 = 0.6875.
        const priced = weighUsage(chat({ modelId: "openai/gpt-5-mini" }));
        expect(priced.weightedTokens).toBe(2750);
        expect(priced.costUsd).toBeCloseTo((3000 * 0.25 + 1000 * 2) / 1_000_000, 12);
        // A local model at ratio 0: free toward limits, and no invented cost.
        const local = weighUsage(chat({ modelId: "llama3.1:8b" }));
        expect(local).toEqual({ weightedTokens: 0 });
    });

    it("lets a model's own declared price win over the table", () => {
        mockChatModelsConfig.mockReturnValue(modelsConfig());
        mockEnv.server.AI_USAGE_PRICES = JSON.stringify({ chat: { model: { ratio: 9 } } });
        const declared = weighUsage(chat({ pricing: { input: 1, output: 1 } }));
        expect(declared.weightedTokens).toBe(4000);
    });

    it("takes the Standard price from the table when the model file declares none", () => {
        mockChatModelsConfig.mockReturnValue({
            models: new Map([["primary", { id: "vendor/standard" }]]),
            routes: { default: "primary" },
        });
        mockEnv.server.AI_USAGE_PRICES = JSON.stringify({
            chat: { standard: { input: 2, output: 4 } },
        });
        expect(standardChatPrice()).toEqual({ perMillion: 2.5, source: "model" });
    });
});

describe("AI_USAGE_PRICES for embeddings and search", () => {
    beforeEach(() => {
        mockEnv.server.AI_USAGE_PRICES = undefined;
        mockEnv.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK = undefined;
        mockEnv.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K = undefined;
        mockEnv.server.AI_USAGE_CHAT_PRICE_PER_MTOK = "1";
    });

    it("prices models and providers the built-in list doesn't know, ahead of the blanket variables", () => {
        mockEnv.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK = "0.5";
        mockEnv.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K = "9";
        mockEnv.server.AI_USAGE_PRICES = JSON.stringify({
            embedding: { "voyage-3": 0.06 },
            search: { brave: 5 },
        });
        expect(weighUsage(embedding("voyage-3", 1_000_000)).weightedTokens).toBe(60_000);
        // Not in the table: the blanket variable.
        expect(weighUsage(embedding("text-embedding-3-large", 1_000_000)).weightedTokens).toBe(
            500_000
        );
        expect(weighUsage(search("brave")).weightedTokens).toBe(5_000);
        expect(weighUsage(search("exa")).weightedTokens).toBe(9_000);
    });

    it("weighs a ratio entry without inventing a cost", () => {
        mockEnv.server.AI_USAGE_PRICES = JSON.stringify({
            embedding: { "nomic-embed-text": { ratio: 0.01 } },
            search: { searxng: { ratio: 0 } },
        });
        expect(weighUsage(embedding("nomic-embed-text", 1_000_000))).toEqual({
            weightedTokens: 10_000,
        });
        expect(weighUsage(search("searxng"))).toEqual({ weightedTokens: 0 });
    });

    it("ignores an invalid table, says which entry, and keeps the built-in prices", () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockEnv.server.AI_USAGE_PRICES = JSON.stringify({ embedding: { "voyage-3": -1 } });
        expect(weighUsage(embedding("text-embedding-3-large", 1_000_000)).weightedTokens).toBe(
            130_000
        );
        expect(error).toHaveBeenCalledWith(expect.stringContaining("embedding.voyage-3"));
        error.mockRestore();
    });
});

describe("conversionRates", () => {
    beforeEach(() => {
        mockEnv.server.AI_USAGE_PRICES = undefined;
        mockEnv.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK = undefined;
        mockEnv.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K = undefined;
        mockEnv.server.AI_USAGE_CHAT_PRICE_PER_MTOK = "1";
    });

    it("reports what a window was weighed at, else today's rates", () => {
        expect(
            conversionRates({
                embeddedTokens: 1_500_000,
                embeddedWeighted: 85_000,
                searches: 4,
                searchWeighted: 22_000,
            })
        ).toMatchObject({ embeddingPerMillion: 56_667, perSearch: 5_500 });
        expect(
            conversionRates({
                embeddedTokens: 0,
                embeddedWeighted: 0,
                searches: 0,
                searchWeighted: 0,
            })
        ).toMatchObject({
            chat: { perMillion: 1, source: "setting" },
            embeddingPerMillion: 130_000,
        });
    });
});
