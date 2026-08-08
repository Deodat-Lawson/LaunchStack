import { z } from "zod";

import { __resetLlmConfigForTests } from "~/lib/llm/config";
import { generateStructuredWithMetadata } from "~/lib/llm/generate";
import { __resetProviderCacheForTests } from "~/lib/llm/providers";
import { resolveModel } from "~/lib/llm/providers";

describe("Founder Weekly Review Kimi transport", () => {
    const originalEnv = { ...process.env };
    const originalFetch = global.fetch;

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            FWR_GENERATION_PROVIDER: "kimi",
            MOONSHOT_API_KEY: "test-key-not-logged",
            MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
            KIMI_MODEL_ID: "kimi-k2.6",
        };
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_MODEL_ID;
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();
    });

    afterEach(() => {
        process.env = originalEnv;
        global.fetch = originalFetch;
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();
    });

    it("uses Moonshot Chat Completions JSON mode and locally validates the result", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit) => {
            expect(String(url)).toMatch(/\/chat\/completions$/);
            expect(String(url)).not.toContain("/responses");
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            expect(body.model).toBe("kimi-k2.6");
            expect(body.max_tokens).toBe(2400);
            expect(body.messages).toEqual(expect.any(Array));
            expect(body).not.toHaveProperty("temperature");
            expect(body.response_format).toEqual({ type: "json_object" });
            expect(body.thinking).toEqual({ type: "disabled" });
            return new Response(JSON.stringify({
                id: "chatcmpl-test",
                object: "chat.completion",
                created: 0,
                model: "kimi-k2.6",
                choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content: "{\"ok\":true}" } }],
                usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }), { status: 200, headers: { "content-type": "application/json" } });
        });
        global.fetch = fetchMock as typeof fetch;

        await expect(generateStructuredWithMetadata({
            capability: "founderWeeklyReview",
            system: "Return valid JSON.",
            prompt: "Generate the object.",
            schema: z.object({ ok: z.boolean() }),
            schemaName: "founder_weekly_review",
        })).resolves.toMatchObject({ object: { ok: true }, metadata: { provider: "kimi", model: "kimi-k2.6" } });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(`${logSpy.mock.calls.flat().join(" ")} ${errorSpy.mock.calls.flat().join(" ")}`).not.toContain("test-key-not-logged");
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("defaults to OpenAI and does not infer Kimi from Moonshot credentials", () => {
        delete process.env.FWR_GENERATION_PROVIDER;
        process.env.OPENAI_API_KEY = "openai-test-key";
        process.env.OPENAI_MODEL_ID = "gpt-test";
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();
        const resolved = resolveModel("founderWeeklyReview");
        expect(resolved).toMatchObject({ provider: "openai", modelId: "gpt-test" });
        expect(resolved.temperature).toBe(0);
        expect(resolved.structuredOutputMode).toBeUndefined();
        expect(resolved).not.toHaveProperty("thinking");
    });

    it("keeps an explicit Founder Weekly Review output override", async () => {
        const fetchMock = jest.fn(async (_url: string | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            expect(body.max_tokens).toBe(777);
            return new Response(JSON.stringify({
                id: "chatcmpl-override",
                object: "chat.completion",
                created: 0,
                model: "kimi-k2.6",
                choices: [{ index: 0, message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop", logprobs: null }],
                usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }), { status: 200, headers: { "content-type": "application/json" } });
        });
        global.fetch = fetchMock as typeof fetch;
        await expect(generateStructuredWithMetadata({
            capability: "founderWeeklyReview",
            maxOutputTokens: 777,
            system: "Return valid JSON.",
            prompt: "Generate the object.",
            schema: z.object({ ok: z.boolean() }),
        })).resolves.toMatchObject({ object: { ok: true } });
    });

    it("does not apply the Founder Weekly Review default to small extraction", async () => {
        const fetchMock = jest.fn(async (_url: string | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            expect(body).not.toHaveProperty("max_tokens");
            return new Response(JSON.stringify({
                id: "chatcmpl-extraction",
                object: "chat.completion",
                created: 0,
                model: "kimi-k2.6",
                choices: [{ index: 0, message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop", logprobs: null }],
                usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }), { status: 200, headers: { "content-type": "application/json" } });
        });
        global.fetch = fetchMock as typeof fetch;
        await expect(generateStructuredWithMetadata({
            capability: "smallExtraction",
            forceProvider: "kimi",
            system: "Return valid JSON.",
            prompt: "Extract the object.",
            schema: z.object({ ok: z.boolean() }),
        })).resolves.toMatchObject({ object: { ok: true } });
    });

    it("uses explicit OpenAI without requiring Moonshot configuration", () => {
        process.env.FWR_GENERATION_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "openai-test-key";
        process.env.OPENAI_MODEL_ID = "gpt-openai";
        delete process.env.MOONSHOT_API_KEY;
        delete process.env.MOONSHOT_BASE_URL;
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();

        const resolved = resolveModel("founderWeeklyReview");
        expect(resolved).toMatchObject({ provider: "openai", modelId: "gpt-openai" });
        expect(resolved.structuredOutputMode).toBeUndefined();
    });

    it("allows an explicit Kimi smallExtraction request without changing default priority", () => {
        process.env.OPENAI_API_KEY = "openai-test-key";
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();
        const defaultExtraction = resolveModel("smallExtraction");
        const kimiExtraction = resolveModel("smallExtraction", "kimi");
        expect(defaultExtraction).toMatchObject({ provider: "openai", modelId: "gpt-4o-mini" });
        expect(kimiExtraction).toMatchObject({ provider: "kimi", modelId: "kimi-k2.6", structuredOutputMode: "json_object" });
    });

    it("fails before any request for invalid or missing selected-provider configuration", () => {
        process.env.FWR_GENERATION_PROVIDER = "other";
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();
        expect(() => resolveModel("founderWeeklyReview")).toThrow('FWR_GENERATION_PROVIDER must be "openai" or "kimi"');
        process.env.FWR_GENERATION_PROVIDER = "kimi";
        delete process.env.MOONSHOT_API_KEY;
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();
        expect(() => resolveModel("founderWeeklyReview")).toThrow("FWR_GENERATION_PROVIDER=kimi requires MOONSHOT_API_KEY");

        process.env.FWR_GENERATION_PROVIDER = "openai";
        process.env.MOONSHOT_API_KEY = "moonshot-secret-that-must-not-appear";
        delete process.env.OPENAI_API_KEY;
        __resetLlmConfigForTests();
        __resetProviderCacheForTests();
        let thrown: Error | null = null;
        try {
            resolveModel("founderWeeklyReview");
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown?.message).toContain("FWR_GENERATION_PROVIDER=openai requires OPENAI_API_KEY");
        expect(thrown?.message).not.toContain("moonshot-secret-that-must-not-appear");
    });
});
