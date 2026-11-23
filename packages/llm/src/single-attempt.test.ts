import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleChat, singleAttemptChat } from "./openai-compatible-transport";
import { getChatModelPreset } from "./presets";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ResolvedChatModel } from "./chat-model-factory";
import { applyMessageBehavior } from "./messages";
import { invokeStructuredAttempt } from "./structured-attempt";
import { longWaitFetch } from "./long-wait-fetch";

vi.mock("./long-wait-fetch", () => ({ longWaitFetch: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe("single attempt on main transport", () => {
    it.each([false, true])(
        "retains long-wait, workspace redirect protection and captured metering (guarded=%s)",
        async guarded => {
            const behavior = getChatModelPreset("google/gemini-3.8-flash")!.behavior;
            const record = vi.fn();
            vi.mocked(longWaitFetch).mockResolvedValue(
                new Response(
                    JSON.stringify({
                        id: "test",
                        object: "chat.completion",
                        created: 1,
                        model: "injected",
                        choices: [
                            {
                                index: 0,
                                message: { role: "assistant", content: '{"ok":true}' },
                                finish_reason: "stop",
                            },
                        ],
                        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
                    }),
                    { headers: { "content-type": "application/json" } }
                )
            );
            const original = createOpenAiCompatibleChat({
                endpoint: {
                    owner: "workspace",
                    baseUrl: "https://injected.invalid/v1",
                    apiKey: "synthetic",
                },
                modelId: "injected",
                behavior,
                longWait: true,
                timeoutMs: 600000,
                maxRetries: 2,
                maxOutputTokens: 1000,
                usage: { route: "reasoning", recorder: { record } },
            });
            const bounded = singleAttemptChat(original, behavior, {
                timeoutMs: 1000,
                maxOutputTokens: 100,
            });
            expect(bounded.lc_kwargs.configuration).toBe(original.lc_kwargs.configuration);
            expect(bounded).toHaveProperty("timeout", 1000);
            expect(bounded.lc_kwargs.maxRetries).toBe(0);
            expect(original.lc_kwargs.maxRetries).toBe(2);
            expect(original).toHaveProperty("timeout", 600000);
            if (guarded) {
                const marker = vi.fn(async () => {});
                await invokeStructuredAttempt(
                    {
                        chat: original,
                        behavior,
                        modelId: "injected",
                        prepareMessages: messages => applyMessageBehavior(behavior, messages),
                    } as ResolvedChatModel,
                    z.object({ ok: z.boolean() }),
                    [new HumanMessage("hello")],
                    {
                        signal: new AbortController().signal,
                        timeoutMs: 1000,
                        maxOutputTokens: 100,
                        maxInputBytes: 200000,
                        beforeDispatch: marker,
                    }
                );
                expect(marker).toHaveBeenCalledTimes(1);
            } else await bounded.invoke("hello");
            expect(longWaitFetch).toHaveBeenCalledTimes(1);
            expect(vi.mocked(longWaitFetch).mock.calls[0]![1]?.redirect).toBe("error");
            expect(record).toHaveBeenCalledWith(
                expect.objectContaining({ inputTokens: 12, outputTokens: 4, route: "reasoning" })
            );
        }
    );

    it("retains long-wait, redirect protection and metering during opt-in physical retries", async () => {
        const behavior = getChatModelPreset("google/gemini-3.8-flash")!.behavior;
        const record = vi.fn();
        const settle = vi.fn(async () => undefined);
        const journal = vi.fn(async () => settle);
        vi.mocked(longWaitFetch)
            .mockResolvedValueOnce(
                new Response("temporarily unavailable", {
                    status: 503,
                    headers: { "retry-after": "0" },
                })
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        id: "test",
                        object: "chat.completion",
                        created: 1,
                        model: "injected",
                        choices: [
                            {
                                index: 0,
                                message: { role: "assistant", content: "hello" },
                                finish_reason: "stop",
                            },
                        ],
                        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
                    }),
                    { headers: { "content-type": "application/json" } }
                )
            );
        const chat = createOpenAiCompatibleChat({
            endpoint: {
                owner: "workspace",
                baseUrl: "https://injected.invalid/v1",
                apiKey: "synthetic",
            },
            behavior,
            modelId: "injected",
            longWait: true,
            maxRetries: 7,
            providerRetry: { deadlineAt: Date.now() + 1000, beforeAttempt: journal },
            usage: { route: "reasoning", recorder: { record } },
        });
        await singleAttemptChat(chat, behavior, { timeoutMs: 1000, maxOutputTokens: 100 }).invoke(
            "hello"
        );
        expect(longWaitFetch).toHaveBeenCalledTimes(2);
        for (const [, init] of vi.mocked(longWaitFetch).mock.calls)
            expect(init?.redirect).toBe("error");
        expect(journal).toHaveBeenCalledTimes(2);
        expect(settle).toHaveBeenCalledTimes(2);
        expect(record).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ inputTokens: 12, outputTokens: 4, route: "reasoning" })
        );
    });
});
