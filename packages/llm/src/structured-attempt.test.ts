import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { buildChatModelsConfig } from "./chat-config";
import { resolveChatModel } from "./chat-model-factory";
import { singleAttemptChat } from "./openai-compatible-transport";
import {
    invokeStructuredAttempt,
    InvalidStructuredAttemptError,
    StructuredAttemptSetupError,
} from "./structured-attempt";

function resolved(fetch: typeof globalThis.fetch, cap = 800) {
    const config = buildChatModelsConfig({
        endpoint: { baseUrl: "https://synthetic.invalid/v1", apiKey: "synthetic-test-key" },
        file: {
            version: 1,
            models: { test: { id: "test-model", preset: "openai/gpt-4o" } },
            routes: { default: "test" },
        },
    });
    const model = resolveChatModel({
        config,
        maxOutputTokens: cap,
        temperature: 0,
        timeoutMs: 12000,
    });
    // Install an in-memory HTTP fixture, not a provider mock, before cloning the transport.
    model.chat.lc_kwargs.configuration = { baseURL: config.endpoint.baseUrl, fetch };
    return model;
}
const options = () => ({
    signal: new AbortController().signal,
    timeoutMs: 20000,
    maxOutputTokens: 2400,
});
const response = (content: string) =>
    new Response(
        JSON.stringify({
            id: "test",
            object: "chat.completion",
            created: 0,
            model: "test-model",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 25, completion_tokens: 5, total_tokens: 30 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );

describe("single-attempt structured transport", () => {
    it("uses the actual SDK request, preserves endpoint/model, caps tokens, and reads usage", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValue(response('{"answer":"yes"}'));
        const model = resolved(fetch);
        const result = await invokeStructuredAttempt(
            model,
            z.object({ answer: z.string() }),
            [new HumanMessage("Synthetic input")],
            options()
        );
        expect(result.result).toEqual({ answer: "yes" });
        expect(result.usage).toMatchObject({ inputTokens: 25, outputTokens: 5, totalTokens: 30 });
        expect(fetch).toHaveBeenCalledTimes(1);
        const call = fetch.mock.calls[0]!;
        expect(call[0]).toBe("https://synthetic.invalid/v1/chat/completions");
        const bodyText = call[1]?.body;
        if (typeof bodyText !== "string") throw new Error("Expected a serialized request body.");
        const body = JSON.parse(bodyText);
        expect(body.model).toBe("test-model");
        expect(body.max_tokens).toBe(800);
        expect(body.messages.some((m: { content: string }) => m.content.includes('"answer"'))).toBe(
            true
        );
        expect(body.stream).toBe(false);
        expect(model.chat.lc_kwargs.maxRetries).toBeUndefined();
        expect(singleAttemptChat(model.chat, model.behavior, options()).lc_kwargs.maxRetries).toBe(
            0
        );
    });
    it("disables hidden SDK retries on 429 and does not mutate shared configuration", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        error: { message: "rate limit", type: "rate_limit_error" },
                    }),
                    { status: 429, headers: { "Content-Type": "application/json" } }
                )
        );
        const model = resolved(fetch),
            before = { ...model.chat.lc_kwargs };
        await expect(
            invokeStructuredAttempt(model, z.object({ answer: z.string() }), [], options())
        ).rejects.toMatchObject({ status: 429 });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(model.chat.lc_kwargs).toEqual(before);
    });
    it("does not perform an implicit repair call on malformed JSON", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response("not JSON"));
        await expect(
            invokeStructuredAttempt(
                resolved(fetch),
                z.object({ answer: z.string() }),
                [],
                options()
            )
        ).rejects.toBeInstanceOf(InvalidStructuredAttemptError);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it("passes cancellation to the SDK transport", async () => {
        const controller = new AbortController();
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        "abort",
                        () => reject(new DOMException("Aborted", "AbortError")),
                        { once: true }
                    );
                    controller.abort();
                })
        );
        await expect(
            invokeStructuredAttempt(resolved(fetch), z.object({ answer: z.string() }), [], {
                ...options(),
                signal: controller.signal,
            })
        ).rejects.toThrow();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it("rejects oversized prompts before sending a request", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>();
        await expect(
            invokeStructuredAttempt(
                resolved(fetch),
                z.object({ answer: z.string() }),
                [new HumanMessage("字".repeat(9000))],
                options()
            )
        ).rejects.toBeInstanceOf(StructuredAttemptSetupError);
        expect(fetch).not.toHaveBeenCalled();
    });
});
