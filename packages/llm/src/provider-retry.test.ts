import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createEndpointFetch, guardEndpointFetch } from "./endpoint-fetch";
import { getChatModelPreset } from "./presets";
import { createOpenAiCompatibleChat } from "./openai-compatible-transport";
import { applyMessageBehavior } from "./messages";
import { invokeStructuredAttempt, type InvalidStructuredAttemptError } from "./structured-attempt";
import type { ResolvedChatModel } from "./chat-model-factory";
import type {
    ChatProviderAttemptOutcome,
    ChatProviderAttemptUsageIdentity,
    ChatProviderRetryPolicy,
} from "./provider-retry";

const endpoint = {
    owner: "workspace" as const,
    baseUrl: "https://synthetic.invalid/v1",
    apiKey: "synthetic",
    systemInstructions: "operator policy 中文",
};
const behavior = getChatModelPreset("google/gemini-3.8-flash")!.behavior;
const url = `${endpoint.baseUrl}/chat/completions`;
const body = JSON.stringify({ messages: [{ role: "user", content: "hello 世界" }] });
const json = (status = 200, headers?: HeadersInit, content: unknown = {}) =>
    new Response(JSON.stringify(content), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
const socketReset = () => new TypeError("socket reset", { cause: { code: "ECONNRESET" } });

function harness(base: typeof fetch, signal?: AbortSignal, deadlineMs = 20_000) {
    const outcomes: ChatProviderAttemptOutcome[] = [];
    const identities: (ChatProviderAttemptUsageIdentity | undefined)[] = [];
    const attempts: { attempt: number; messageBytes: number }[] = [];
    const listeners: (() => void)[] = [];
    const policy: ChatProviderRetryPolicy = {
        deadlineAt: Date.now() + deadlineMs,
        beforeAttempt: vi.fn(async info => {
            attempts.push(info);
            return async (
                outcome: ChatProviderAttemptOutcome,
                usageIdentity?: ChatProviderAttemptUsageIdentity
            ) => {
                outcomes.push(outcome);
                identities.push(usageIdentity);
                listeners.splice(0).forEach(resolve => resolve());
            };
        }),
    };
    return {
        policy,
        outcomes,
        identities,
        attempts,
        settled: () => new Promise<void>(resolve => listeners.push(resolve)),
        fetch: createEndpointFetch(endpoint, behavior, base, undefined, undefined, policy),
        init: { method: "POST", body, signal },
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("opt-in journaled provider retries", () => {
    it.each([429, 503])(
        "retries HTTP %i, journal first, and records reported usage",
        async status => {
            const base = vi.fn(async () => {
                expect(h.attempts).toHaveLength(base.mock.calls.length);
                return base.mock.calls.length === 1
                    ? json(status, { "retry-after": "0" }, { usage: { total_tokens: 2 } })
                    : json(200, undefined, {
                          usage: {
                              prompt_tokens: 5,
                              completion_tokens: 3,
                              total_tokens: 8,
                              completion_tokens_details: { reasoning_tokens: 1 },
                              prompt_tokens_details: { cached_tokens: 2 },
                          },
                      });
            });
            const h = harness(base);
            expect((await h.fetch(url, h.init)).status).toBe(200);
            expect(base).toHaveBeenCalledTimes(2);
            expect(h.outcomes).toEqual([
                {
                    statusClass: status === 429 ? "rate_limited" : "unavailable",
                    httpStatus: status,
                    retryAfterMs: 0,
                    usage: { totalTokens: 2 },
                },
                {
                    statusClass: "success",
                    httpStatus: 200,
                    usage: {
                        inputTokens: 5,
                        outputTokens: 3,
                        totalTokens: 8,
                        reasoningTokens: 1,
                        cachedInputTokens: 2,
                    },
                },
            ]);
        }
    );

    it.each([undefined, "not a date"])(
        "uses bounded fallback for missing/invalid Retry-After (%s)",
        async header => {
            vi.useFakeTimers();
            const base = vi.fn(async () =>
                base.mock.calls.length < 3
                    ? json(429, header ? { "retry-after": header } : undefined)
                    : json()
            );
            const h = harness(base);
            const first = h.settled();
            const result = h.fetch(url, h.init);
            await first;
            await vi.advanceTimersByTimeAsync(999);
            expect(base).toHaveBeenCalledTimes(1);
            const second = h.settled();
            await vi.advanceTimersByTimeAsync(1);
            await second;
            await vi.advanceTimersByTimeAsync(1999);
            expect(base).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            await result;
            expect(base).toHaveBeenCalledTimes(3);
        }
    );

    it.each(["2", "date"])("honors Retry-After %s before sending again", async header => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
        const value = header === "date" ? new Date(Date.now() + 2000).toUTCString() : header;
        const base = vi.fn(async () =>
            base.mock.calls.length === 1 ? json(429, { "retry-after": value }) : json()
        );
        const h = harness(base);
        const first = h.settled();
        const result = h.fetch(url, h.init);
        await first;
        expect(h.outcomes[0]?.retryAfterMs).toBe(2000);
        await vi.advanceTimersByTimeAsync(1999);
        expect(base).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await result;
        expect(base).toHaveBeenCalledTimes(2);
    });

    it("retries only demonstrably pre-send connection failure", async () => {
        vi.useFakeTimers();
        const base = vi.fn(async () => {
            if (base.mock.calls.length === 1)
                throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
            return json();
        });
        const h = harness(base);
        const first = h.settled();
        const result = h.fetch(url, h.init);
        await first;
        expect(h.outcomes[0]).toEqual({ statusClass: "connection_failed", httpStatus: null });
        await vi.advanceTimersByTimeAsync(1000);
        await result;
        expect(base).toHaveBeenCalledTimes(2);
    });

    it.each([null, 200])(
        "retries a socket reset before body bytes (HTTP status %s)",
        async status => {
            vi.useFakeTimers();
            const base = vi.fn(async () => {
                if (base.mock.calls.length > 1) return json();
                if (status === null) throw socketReset();
                return new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.error(socketReset());
                        },
                    }),
                    { status, headers: { "content-type": "application/json", "retry-after": "1" } }
                );
            });
            const h = harness(base);
            const first = h.settled();
            const result = h.fetch(url, h.init);
            void result.catch(() => undefined);
            await first;
            expect(h.outcomes[0]).toMatchObject({
                statusClass: "connection_failed",
                httpStatus: status,
            });
            await vi.advanceTimersByTimeAsync(999);
            expect(base).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect((await result).status).toBe(200);
            expect(h.attempts.map(attempt => attempt.attempt)).toEqual([1, 2]);
            expect(h.outcomes.map(outcome => outcome.statusClass)).toEqual([
                "connection_failed",
                "success",
            ]);
        }
    );

    it("keeps a reset after a body chunk terminal even for HTTP 503", async () => {
        const base = vi.fn(async () => {
            if (base.mock.calls.length > 1) return json();
            let sent = false;
            return new Response(
                new ReadableStream({
                    async pull(controller) {
                        if (!sent) {
                            sent = true;
                            controller.enqueue(new TextEncoder().encode('{"choices":['));
                            return;
                        }
                        // The first chunk must be readable before the stream errors.
                        await new Promise<void>(resolve => setImmediate(resolve));
                        controller.error(socketReset());
                    },
                }),
                { status: 503, headers: { "content-type": "application/json", "retry-after": "0" } }
            );
        });
        const h = harness(base);
        await expect(h.fetch(url, h.init)).rejects.toThrow("socket reset");
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.outcomes).toEqual([{ statusClass: "unknown", httpStatus: 503 }]);
    });

    it.each(["ETIMEDOUT", "UND_ERR_SOCKET", undefined])(
        "does not retry ambiguous connection error %s",
        async code => {
            const base = vi.fn(async () => {
                throw new TypeError("fetch failed", { cause: { code } });
            });
            const h = harness(base);
            await expect(h.fetch(url, h.init)).rejects.toThrow("fetch failed");
            expect(base).toHaveBeenCalledTimes(1);
            expect(h.outcomes).toEqual([{ statusClass: "unknown", httpStatus: null }]);
        }
    );

    it.each([400, 401, 403, 408, 500, 502, 504])(
        "does not retry HTTP %i or log its body",
        async status => {
            const log = vi.spyOn(console, "error").mockImplementation(() => {});
            const base = vi.fn(async () =>
                json(status, undefined, { error: "private provider detail" })
            );
            const h = harness(base);
            const response = await h.fetch(url, h.init);
            expect(response.status).toBe(status);
            expect(await response.text()).not.toContain("private provider detail");
            expect(base).toHaveBeenCalledTimes(1);
            expect(log).not.toHaveBeenCalled();
        }
    );

    it("stops after two retries and settles every send", async () => {
        const base = vi.fn(async () => json(503, { "retry-after": "0" }));
        const h = harness(base);
        expect((await h.fetch(url, h.init)).status).toBe(503);
        expect(base).toHaveBeenCalledTimes(3);
        expect(h.attempts.map(info => info.attempt)).toEqual([1, 2, 3]);
        expect(h.outcomes).toHaveLength(3);
    });

    it.each([
        { usage: { completion_tokens: 1 } },
        { usage: { completion_tokens_details: { reasoning_tokens: 1 } } },
        { choices: [{ message: { content: "already generated" } }] },
        { output: [{ content: "already generated" }] },
        { output: { text: "already generated" } },
    ])("does not repeat a rejected response containing generation evidence %j", async content => {
        const base = vi.fn(async () => json(503, { "retry-after": "0" }, content));
        const h = harness(base);
        expect((await h.fetch(url, h.init)).status).toBe(503);
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.outcomes).toHaveLength(1);
    });

    it("does not retry a rejected response when its body fails before completion", async () => {
        const base = vi.fn(
            async () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode('{"choices":['));
                            controller.error(new Error("response interrupted"));
                        },
                    }),
                    { status: 503, headers: { "retry-after": "0" } }
                )
        );
        const h = harness(base);
        await expect(h.fetch(url, h.init)).rejects.toThrow("response interrupted");
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.outcomes).toEqual([{ statusClass: "unknown", httpStatus: 503 }]);
    });

    it("can retry an ordinary complete HTML rejection", async () => {
        const base = vi.fn(async () =>
            base.mock.calls.length === 1
                ? new Response("<html>temporarily unavailable</html>", {
                      status: 503,
                      headers: { "retry-after": "0", "content-type": "text/html" },
                  })
                : json()
        );
        const h = harness(base);
        expect((await h.fetch(url, h.init)).status).toBe(200);
        expect(base).toHaveBeenCalledTimes(2);
    });

    it("cancels a retry wait without another journal or send", async () => {
        const controller = new AbortController();
        const base = vi.fn(async () => json(429, { "retry-after": "60" }));
        const h = harness(base, controller.signal);
        const first = h.settled();
        const result = h.fetch(url, h.init);
        const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
        await first;
        controller.abort();
        await rejected;
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.attempts).toHaveLength(1);
        expect(h.outcomes).toHaveLength(1);
    });

    it("settles cancellation of an in-flight physical send exactly once", async () => {
        const controller = new AbortController();
        let started: () => void = () => {};
        const sending = new Promise<void>(resolve => {
            started = resolve;
        });
        const base = vi.fn(async () => {
            started();
            return new Promise<Response>(() => {});
        });
        const h = harness(base, controller.signal);
        const result = h.fetch(url, h.init);
        const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
        await sending;
        controller.abort();
        await rejected;
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.outcomes).toEqual([{ statusClass: "aborted", httpStatus: null }]);
    });

    it.each(["aborted", "deadline"])("does not journal or send when already %s", async reason => {
        const controller = new AbortController();
        if (reason === "aborted") controller.abort();
        const base = vi.fn(async () => json());
        const h = harness(base, controller.signal, reason === "deadline" ? -1 : 20_000);
        await expect(h.fetch(url, h.init)).rejects.toMatchObject({
            name: reason === "deadline" ? "TimeoutError" : "AbortError",
        });
        expect(base).not.toHaveBeenCalled();
        expect(h.attempts).toHaveLength(0);
    });

    it("settles a journal if cancellation arrives before the physical send", async () => {
        const controller = new AbortController();
        const base = vi.fn(async () => json());
        const h = harness(base, controller.signal);
        const settle = vi.fn(async (_outcome: ChatProviderAttemptOutcome) => {});
        h.policy.beforeAttempt = async () => {
            controller.abort();
            return settle;
        };
        await expect(h.fetch(url, h.init)).rejects.toMatchObject({ name: "AbortError" });
        expect(base).not.toHaveBeenCalled();
        expect(settle).toHaveBeenCalledExactlyOnceWith({
            statusClass: "aborted",
            httpStatus: null,
        });
    });

    it("limits Retry-After wait to the absolute deadline", async () => {
        vi.useFakeTimers();
        const base = vi.fn(async () => json(503, { "retry-after": "60" }));
        const h = harness(base, undefined, 2000);
        const first = h.settled();
        const result = h.fetch(url, h.init);
        const rejected = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
        await first;
        await vi.advanceTimersByTimeAsync(2000);
        await rejected;
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.outcomes).toHaveLength(1);
    });

    it("uses the deadline narrowed by logical authorization and settles an in-flight timeout", async () => {
        vi.useFakeTimers();
        let sentSignal: AbortSignal | null | undefined;
        const base = vi.fn(async (_input, init) => {
            sentSignal = init?.signal;
            return new Promise<Response>(() => {});
        });
        const h = harness(base);
        const guarded = guardEndpointFetch(h.fetch, async () => {
            h.policy.deadlineAt = Date.now() + 100;
        });
        const result = guarded(url, h.init);
        const rejected = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        expect(sentSignal?.aborted).toBe(true);
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.outcomes).toEqual([{ statusClass: "deadline", httpStatus: null }]);
    });

    it("rechecks final prepared UTF-8 bytes before every journal and send", async () => {
        const base = vi.fn(async () => json(429, { "retry-after": "0" }));
        const h = harness(base);
        const guard = vi.fn(async prepared => {
            const messages = JSON.parse(prepared).messages;
            expect(JSON.stringify(messages)).toContain(endpoint.systemInstructions);
            expect(Buffer.byteLength(JSON.stringify(messages), "utf8")).toBeGreaterThan(
                JSON.stringify(messages).length
            );
            if (guard.mock.calls.length === 2) throw new Error("byte guard refused");
        });
        await expect(guardEndpointFetch(h.fetch, guard)(url, h.init)).rejects.toThrow(
            "byte guard refused"
        );
        expect(guard).toHaveBeenCalledTimes(2);
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.attempts).toHaveLength(1);
    });

    it("fails closed when journaling or settlement fails", async () => {
        const base = vi.fn(async () => json(503, { "retry-after": "0" }));
        const h = harness(base);
        h.policy.beforeAttempt = async () => {
            throw new Error("journal unavailable");
        };
        await expect(h.fetch(url, h.init)).rejects.toThrow("journal unavailable");
        expect(base).not.toHaveBeenCalled();
        h.policy.beforeAttempt = async () => async () => {
            throw new Error("settlement unavailable");
        };
        await expect(h.fetch(url, h.init)).rejects.toThrow("settlement unavailable");
        expect(base).toHaveBeenCalledTimes(1);
    });

    it("never retries malformed HTTP 200", async () => {
        const base = vi.fn(
            async () =>
                new Response("not json", { headers: { "content-type": "application/json" } })
        );
        const h = harness(base);
        expect(await (await h.fetch(url, h.init)).text()).toBe("not json");
        expect(base).toHaveBeenCalledTimes(1);
        expect(h.outcomes).toEqual([{ statusClass: "success", httpStatus: 200 }]);
    });

    it.each([undefined, "settlement"] as const)(
        "keeps one structured authorization and accounts usage through %s",
        async usageAccounting => {
            const h = harness(async () => json());
            h.policy.usageAccounting = usageAccounting;
            const base = vi.fn(async (_input, init) => {
                expect(init.redirect).toBe("error");
                return base.mock.calls.length === 1
                    ? json(
                          503,
                          { "retry-after": "0" },
                          {
                              usage: { prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 },
                          }
                      )
                    : json(200, undefined, {
                          id: "synthetic",
                          object: "chat.completion",
                          created: 1,
                          model: "synthetic",
                          choices: [
                              {
                                  index: 0,
                                  message: { role: "assistant", content: '{"ok":false}' },
                                  finish_reason: "stop",
                              },
                          ],
                          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
                      });
            });
            vi.stubGlobal("fetch", base);
            const recorder = { record: vi.fn() };
            const pricing = { input: 0.25, output: 1.25 };
            const chat = createOpenAiCompatibleChat({
                endpoint,
                behavior,
                modelId: "synthetic",
                maxRetries: 8,
                providerRetry: h.policy,
                usage: { recorder, route: "default", pricing },
            });
            expect(chat.lc_kwargs.maxRetries).toBe(0);
            const model = {
                behavior,
                chat,
                prepareMessages: messages => applyMessageBehavior(behavior, messages),
            } as ResolvedChatModel;
            const authorizer = vi.fn(async () => {});
            await expect(
                invokeStructuredAttempt(
                    model,
                    z.object({ ok: z.literal(true) }),
                    [new HumanMessage("hello")],
                    {
                        signal: new AbortController().signal,
                        timeoutMs: 5000,
                        maxOutputTokens: 256,
                        maxInputBytes: 200000,
                        beforeDispatch: authorizer,
                    }
                )
            ).rejects.toMatchObject({
                name: "InvalidStructuredAttemptError",
                reason: "schema_invalid",
            } satisfies Partial<InvalidStructuredAttemptError>);
            expect(base).toHaveBeenCalledTimes(2);
            expect(authorizer).toHaveBeenCalledTimes(1);
            expect(h.outcomes).toHaveLength(2);
            expect(h.outcomes[0]).toMatchObject({
                httpStatus: 503,
                usage: { inputTokens: 3, outputTokens: 0, totalTokens: 3 },
            });
            expect(h.outcomes[1]?.usage).toMatchObject({ totalTokens: 7 });
            if (usageAccounting === "settlement") {
                const identity = {
                    owner: "workspace",
                    modelId: "synthetic",
                    route: "default",
                    pricing,
                };
                expect(h.identities).toEqual([identity, identity]);
                expect(recorder.record).not.toHaveBeenCalled();
            } else {
                expect(h.identities).toEqual([undefined, undefined]);
                expect(recorder.record).toHaveBeenCalledTimes(1);
            }
        }
    );
});
