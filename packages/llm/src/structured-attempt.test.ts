import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { applyMessageBehavior } from "./messages";
import { createOpenAiCompatibleChat } from "./openai-compatible-transport";
import { getChatModelPreset } from "./presets";
import type { ResolvedChatModel } from "./chat-model-factory";
import { invokeStructuredAttempt, StructuredAttemptSetupError } from "./structured-attempt";

afterEach(() => vi.unstubAllGlobals());

function injectedModel(instructions = "endpoint policy") {
    const behavior = getChatModelPreset("google/gemini-3.8-flash")!.behavior;
    return {
        modelId: "injected",
        behavior,
        chat: createOpenAiCompatibleChat({
            endpoint: {
                owner: "workspace",
                baseUrl: "https://injected.invalid/v1",
                apiKey: "synthetic",
                systemInstructions: instructions,
            },
            modelId: "injected",
            behavior,
            maxRetries: 2,
        }),
        prepareMessages: messages => applyMessageBehavior(behavior, messages),
    } as ResolvedChatModel;
}

const schema = z.object({ ok: z.boolean() });
const completion = (content = '{"ok":true}') =>
    new Response(
        JSON.stringify({
            id: "injected",
            object: "chat.completion",
            created: 1,
            model: "injected",
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content },
                    finish_reason: "stop",
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
        { headers: { "content-type": "application/json" } }
    );

describe("final prepared structured input", () => {
    it.each([
        { content: "PRIVATE_PROVIDER_RESPONSE", reason: "json_invalid" },
        { content: '{"ok":"PRIVATE_PROVIDER_RESPONSE"}', reason: "schema_invalid" },
        { content: "x".repeat(32_000) + "PRIVATE_PROVIDER_RESPONSE", reason: "output_too_large" },
    ])("classifies a structured response failure as $reason", async ({ content, reason }) => {
        const send = vi.fn(async () => completion(content));
        vi.stubGlobal("fetch", send);
        await expect(
            invokeStructuredAttempt(injectedModel(), schema, [new HumanMessage("hello")], {
                signal: new AbortController().signal,
                timeoutMs: 1000,
                maxOutputTokens: 256,
            })
        ).rejects.toMatchObject({
            name: "InvalidStructuredAttemptError",
            message: "The model returned invalid structured output.",
            reason,
        });
        expect(send).toHaveBeenCalledTimes(1);
    });
    it.each([24000, 200000, 240000])(
        "admits exactly %i bytes and rejects one more before dispatch",
        async maximum => {
            let bytes = 0;
            const fetch = vi.fn(async (_input, init) => {
                bytes = Buffer.byteLength(JSON.stringify(JSON.parse(init.body).messages), "utf8");
                expect(init.redirect).toBe("error");
                return completion();
            });
            vi.stubGlobal("fetch", fetch);
            const model = injectedModel('policy ????"\\');
            const marker = vi.fn(async () => {});
            const options = {
                signal: new AbortController().signal,
                timeoutMs: 1000,
                maxOutputTokens: 256,
                maxInputBytes: maximum,
                beforeDispatch: marker,
            };
            await invokeStructuredAttempt(model, schema, [new HumanMessage('????"\\')], options);
            const overhead = bytes;
            fetch.mockClear();
            marker.mockClear();
            const payload = '????"\\' + "x".repeat(maximum - overhead);
            const result = await invokeStructuredAttempt(
                model,
                schema,
                [new HumanMessage(payload)],
                options
            );
            expect(result.result).toEqual({ ok: true });
            expect(bytes).toBe(maximum);
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(marker).toHaveBeenCalledTimes(1);
            fetch.mockClear();
            marker.mockClear();
            await expect(
                invokeStructuredAttempt(model, schema, [new HumanMessage(payload + "x")], options)
            ).rejects.toBeInstanceOf(StructuredAttemptSetupError);
            expect(fetch).not.toHaveBeenCalled();
            expect(marker).not.toHaveBeenCalled();
        }
    );
    it("preserves the default content-only 24000-byte limit including non-factory ChatOpenAI", async () => {
        let finalBytes = 0;
        const fetch = vi.fn(async (_input, init) => {
            finalBytes = Buffer.byteLength(JSON.stringify(JSON.parse(init.body).messages));
            return completion();
        });
        vi.stubGlobal("fetch", fetch);
        const model = injectedModel("endpoint-policy".repeat(100));
        const options = {
            signal: new AbortController().signal,
            timeoutMs: 1000,
            maxOutputTokens: 256,
        };
        const { structuredSchemaInstruction } = await import("./structured-attempt");
        const overhead = Buffer.byteLength(
            JSON.stringify([structuredSchemaInstruction(schema), ""])
        );
        const payload = "x".repeat(24000 - overhead);
        await invokeStructuredAttempt(model, schema, [new HumanMessage(payload)], options);
        expect(finalBytes).toBeGreaterThan(24000);
        expect(fetch).toHaveBeenCalledTimes(1);
        await expect(
            invokeStructuredAttempt(model, schema, [new HumanMessage(payload + "x")], options)
        ).rejects.toBeInstanceOf(StructuredAttemptSetupError);
        expect(fetch).toHaveBeenCalledTimes(1);
        // Clone only the SDK configuration to produce a non-factory endpoint fetch.
        const original = model.chat.lc_kwargs.configuration as { fetch: typeof globalThis.fetch };
        model.chat.lc_kwargs.configuration = { ...original, fetch: globalThis.fetch };
        await invokeStructuredAttempt(model, schema, [new HumanMessage("hello")], options);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it("keeps one provider attempt on failure", async () => {
        const fetch = vi.fn(async () => new Response("synthetic failure", { status: 503 }));
        vi.stubGlobal("fetch", fetch);
        const marker = vi.fn(async () => {});
        await expect(
            invokeStructuredAttempt(injectedModel(), schema, [new HumanMessage("hello")], {
                signal: new AbortController().signal,
                timeoutMs: 1000,
                maxOutputTokens: 256,
                maxInputBytes: 200000,
                beforeDispatch: marker,
            })
        ).rejects.toThrow();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(marker).toHaveBeenCalledTimes(1);
    });
    it("does not dispatch after authorization cancels the attempt", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const controller = new AbortController();
        await expect(
            invokeStructuredAttempt(injectedModel(), schema, [new HumanMessage("hello")], {
                signal: controller.signal,
                timeoutMs: 1000,
                maxOutputTokens: 256,
                beforeDispatch: async () => controller.abort(),
            })
        ).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
});
