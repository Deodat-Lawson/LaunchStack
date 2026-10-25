import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatModelsConfig } from "./chat-config";
import { resolveChatModel } from "./chat-model-factory";
import { runWithChatModelsScope } from "./chat-scope";
import { createEndpointFetch } from "./endpoint-fetch";
import { getChatModelPreset } from "./presets";
import {
    createUsageMeteringFetch,
    priceUsage,
    readReportedUsage,
    type ChatUsageEvent,
} from "./usage-meter";

const COMPLETIONS = "https://models.example.com/v1/chat/completions";
const behavior = getChatModelPreset("google/gemini-3.8-flash")!.behavior;

function recorder() {
    const events: ChatUsageEvent[] = [];
    return { events, usage: { record: (event: ChatUsageEvent) => events.push(event) } };
}

/** Let the clone-and-parse of a JSON body settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

/** An SSE body delivered in the given byte-chunks. */
function sseResponse(chunks: string[]) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("readReportedUsage", () => {
    it("reads the chat-completions block with its breakdowns", () => {
        expect(
            readReportedUsage({
                prompt_tokens: 1200,
                completion_tokens: 300,
                total_tokens: 1500,
                prompt_tokens_details: { cached_tokens: 1000 },
                completion_tokens_details: { reasoning_tokens: 120 },
            })
        ).toEqual({
            inputTokens: 1200,
            outputTokens: 300,
            cachedInputTokens: 1000,
            reasoningTokens: 120,
        });
    });

    it("leaves a missing breakdown absent and refuses a block with no counts", () => {
        expect(readReportedUsage({ input_tokens: 5, output_tokens: 7 })).toEqual({
            inputTokens: 5,
            outputTokens: 7,
        });
        expect(readReportedUsage(null)).toBeNull();
        expect(readReportedUsage({ total_tokens: 9 })).toBeNull();
    });
});

describe("priceUsage", () => {
    it("bills cached input at its own rate and output at the output rate", () => {
        const cost = priceUsage(
            { inputTokens: 2_000_000, outputTokens: 1_000_000, cachedInputTokens: 1_000_000 },
            { input: 1.25, output: 4.25, cachedInput: 0.15 }
        );
        expect(cost).toBeCloseTo(1.25 + 0.15 + 4.25);
    });

    it("bills cached input as fresh input when no cached rate is declared", () => {
        expect(
            priceUsage(
                { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 400_000 },
                { input: 2, output: 8 }
            )
        ).toBeCloseTo(2);
    });
});

describe("createEndpointFetch metering", () => {
    const endpoint = { baseUrl: "https://models.example.com/v1" };

    it("reports a JSON completion's usage, priced, and leaves the body readable", async () => {
        const { events, usage } = recorder();
        const base = vi.fn(async () =>
            jsonResponse({
                model: "served-id",
                choices: [{ message: { content: "hi" } }],
                usage: { prompt_tokens: 100, completion_tokens: 50 },
            })
        );
        const fetch = createEndpointFetch(endpoint, behavior, base, {
            route: "fast",
            modelId: "configured-id",
            pricing: { input: 1, output: 2 },
        });

        const response = await runWithChatModelsScope({ source: "deployment", usage }, () =>
            fetch(COMPLETIONS, { method: "POST", body: "{}" })
        );
        const body = (await response.json()) as { choices: unknown[] };
        await settle();

        expect(body.choices).toHaveLength(1);
        expect(events).toEqual([
            {
                route: "fast",
                modelId: "configured-id",
                owner: "deployment",
                inputTokens: 100,
                outputTokens: 50,
                costUsd: (100 * 1 + 50 * 2) / 1_000_000,
            },
        ]);
    });

    it("passes a stream through byte for byte and reports the usage event at its end", async () => {
        const { events, usage } = recorder();
        const chunks = [
            'data: {"choices":[{"delta":{"content":"Hel"}}],"usage":null}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}],"usage":null}\n\ndata: {"model":"m-1","choices":[],"us',
            'age":{"prompt_tokens":40,"completion_tokens":2,"completion_tokens_details":{"reasoning_tokens":1}}}\n\n',
            "data: [DONE]\n\n",
        ];
        const fetch = createEndpointFetch({ ...endpoint, owner: "workspace" }, behavior, async () =>
            sseResponse(chunks)
        );

        const response = await runWithChatModelsScope({ source: "workspace", usage }, () =>
            fetch(COMPLETIONS, { method: "POST", body: "{}" })
        );
        const text = await response.text();

        expect(text).toBe(chunks.join(""));
        expect(events).toEqual([
            {
                modelId: "m-1",
                owner: "workspace",
                inputTokens: 40,
                outputTokens: 2,
                reasoningTokens: 1,
            },
        ]);
    });

    it("returns the response untouched when nobody is counting", async () => {
        const original = jsonResponse({ usage: { prompt_tokens: 1, completion_tokens: 1 } });
        const fetch = createEndpointFetch(endpoint, behavior, async () => original);
        expect(await fetch(COMPLETIONS, { method: "POST", body: "{}" })).toBe(original);
    });

    it("counts neither failed calls nor other endpoints", async () => {
        const { events, usage } = recorder();
        const failing = createEndpointFetch(endpoint, behavior, async () =>
            jsonResponse({ error: { message: "nope" } }, 500)
        );
        const embeddings = createUsageMeteringFetch({}, async () =>
            jsonResponse({ usage: { prompt_tokens: 9, total_tokens: 9 } })
        );
        await runWithChatModelsScope({ source: "deployment", usage }, async () => {
            await failing(COMPLETIONS, { method: "POST", body: "{}" });
            await embeddings("https://models.example.com/v1/embeddings", { method: "POST" });
        });
        await settle();
        expect(events).toEqual([]);
    });

    it("reads the recorder from the scope a shared client's request is made in", async () => {
        const first = recorder();
        const second = recorder();
        const fetch = createUsageMeteringFetch({ route: "auxiliary" }, async () =>
            jsonResponse({ model: "aux", usage: { prompt_tokens: 3, completion_tokens: 4 } })
        );
        await runWithChatModelsScope({ source: "deployment", usage: first.usage }, () =>
            fetch(COMPLETIONS, { method: "POST" })
        );
        await runWithChatModelsScope({ source: "deployment", usage: second.usage }, () =>
            fetch(COMPLETIONS, { method: "POST" })
        );
        await settle();
        expect(first.events).toHaveLength(1);
        expect(second.events).toEqual([
            {
                route: "auxiliary",
                modelId: "aux",
                owner: "deployment",
                inputTokens: 3,
                outputTokens: 4,
            },
        ]);
    });
});

describe("resolved chat models", () => {
    const config = createChatModelsConfig({
        yaml: [
            "version: 1",
            "models:",
            "  primary:",
            "    id: vendor/model",
            "    preset: google/gemini-3.8-flash",
            "    pricing: { input: 1.25, output: 4.25, cachedInput: 0.15 }",
            "routes:",
            "  default: primary",
        ].join("\n"),
        endpoint: { baseUrl: "https://models.example.com/v1", apiKey: "k" },
    });

    it("carries the declared price into the definition", () => {
        expect(config.models.get("primary")?.pricing).toEqual({
            input: 1.25,
            output: 4.25,
            cachedInput: 0.15,
        });
    });

    it("rejects a price that is not a number of dollars", () => {
        expect(() =>
            createChatModelsConfig({
                yaml: [
                    "version: 1",
                    "models:",
                    "  primary:",
                    "    id: vendor/model",
                    "    preset: google/gemini-3.8-flash",
                    "    pricing: { input: cheap, output: 4 }",
                    "routes:",
                    "  default: primary",
                ].join("\n"),
                endpoint: { baseUrl: "https://models.example.com/v1" },
            })
        ).toThrow(/pricing/);
    });

    it("counts a streamed answer against the scope the model was resolved in", async () => {
        const { events, usage } = recorder();
        const requests: Record<string, unknown>[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_input: unknown, init?: RequestInit) => {
                const body = typeof init?.body === "string" ? init.body : "{}";
                requests.push(JSON.parse(body) as Record<string, unknown>);
                return sseResponse([
                    'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"vendor/model","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n',
                    'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"vendor/model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
                    'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"vendor/model","choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":200,"prompt_tokens_details":{"cached_tokens":800}}}\n\n',
                    "data: [DONE]\n\n",
                ]);
            })
        );

        const resolved = runWithChatModelsScope({ source: "deployment", usage }, () =>
            resolveChatModel({ config, streaming: true, maxRetries: 0 })
        );
        let text = "";
        for await (const chunk of await resolved.chat.stream("hello")) {
            text += typeof chunk.content === "string" ? chunk.content : "";
        }

        expect(text).toBe("ok");
        expect(requests[0]?.stream_options).toEqual({ include_usage: true });
        expect(events).toEqual([
            {
                route: "default",
                modelId: "vendor/model",
                owner: "deployment",
                inputTokens: 1000,
                outputTokens: 200,
                cachedInputTokens: 800,
                costUsd: (200 * 1.25 + 800 * 0.15 + 200 * 4.25) / 1_000_000,
            },
        ]);
    });
});
