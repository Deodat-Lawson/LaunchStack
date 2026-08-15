/**
 * Wire-level tests against a real OpenAI-compatible server.
 *
 * These assert the exact request body the transport emits, because that is
 * the whole contract: a field the model declared unsupported must be absent,
 * not merely harmless, and a reasoning patch must arrive verbatim.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
    createChatModelsConfig,
    describeChatEndpointError,
    invokeStructured,
    normalizeTokenUsage,
    resolveChatModel,
    StructuredOutputError,
    type ChatModelsConfig,
} from "@launchstack/core/llm";

interface Capture {
    path: string;
    authorization?: string;
    body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let captured: Capture[] = [];
let respondWith: (body: Record<string, unknown>) => {
    status: number;
    payload: unknown;
} = () => ({ status: 200, payload: completion("ok") });

function completion(content: string, extra: Record<string, unknown> = {}) {
    return {
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        ...extra,
    };
}

beforeAll(async () => {
    server = createServer((req, res) => {
        let raw = "";
        req.on("data", chunk => (raw += chunk));
        req.on("end", () => {
            const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            captured.push({
                path: req.url ?? "",
                authorization: req.headers.authorization,
                body,
            });
            const { status, payload } = respondWith(body);
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
        });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
    );
});

beforeEach(() => {
    captured = [];
    respondWith = () => ({ status: 200, payload: completion("ok") });
});

function deployment(
    behavior: string,
    options: { apiKey?: string } = { apiKey: "endpoint-key" }
): ChatModelsConfig {
    return createChatModelsConfig({
        yaml: `
version: 1
models:
  primary:
    id: test-model
    behavior:
${behavior}
routes:
  default: primary
`,
        endpoint: { baseUrl, apiKey: options.apiKey },
        sourceLabel: "test.yaml",
    });
}

const FULL_SUPPORT = `      input: [text, image]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`;

const NOTHING_SUPPORTED = `      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: unsupported
        systemMessages: unsupported
        streaming: unsupported
        maxOutputTokens: unsupported`;

describe("endpoint and authentication", () => {
    it("posts to the configured base URL with a bearer credential", async () => {
        const resolved = resolveChatModel({ config: deployment(FULL_SUPPORT) });
        await resolved.chat.invoke([new HumanMessage("hi")]);

        expect(captured).toHaveLength(1);
        expect(captured[0]!.path).toBe("/v1/chat/completions");
        expect(captured[0]!.authorization).toBe("Bearer endpoint-key");
        expect(captured[0]!.body.model).toBe("test-model");
    });

    it("sends a placeholder rather than borrowing OPENAI_API_KEY when keyless", async () => {
        const previous = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = "someone-elses-key";
        try {
            const resolved = resolveChatModel({
                config: deployment(FULL_SUPPORT, { apiKey: undefined }),
            });
            await resolved.chat.invoke([new HumanMessage("hi")]);
            expect(captured[0]!.authorization).not.toContain("someone-elses-key");
            expect(captured[0]!.authorization).toBe("Bearer launchstack-no-key");
        } finally {
            if (previous === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = previous;
        }
    });
});

describe("request parameters follow declared behavior", () => {
    it("omits temperature, system role, streaming, and max tokens when unsupported", async () => {
        const resolved = resolveChatModel({
            config: deployment(NOTHING_SUPPORTED),
            temperature: 0.9,
            maxOutputTokens: 512,
            streaming: true,
        });
        await resolved.chat.invoke(
            resolved.prepareMessages([
                new SystemMessage("Follow the house style."),
                new HumanMessage("Write something."),
            ])
        );

        const body = captured[0]!.body;
        expect(body).not.toHaveProperty("temperature");
        expect(body).not.toHaveProperty("max_tokens");
        expect(body).not.toHaveProperty("max_completion_tokens");
        expect(body.stream ?? false).toBe(false);

        const messages = body.messages as { role: string; content: unknown }[];
        expect(messages.every(m => m.role !== "system")).toBe(true);
        // The instruction is preserved, folded into the user turn.
        expect(JSON.stringify(messages)).toContain("Follow the house style.");
        expect(JSON.stringify(messages)).toContain("Write something.");
    });

    it("sends temperature, system role, and max tokens when supported", async () => {
        const resolved = resolveChatModel({
            config: deployment(FULL_SUPPORT),
            temperature: 0.2,
            maxOutputTokens: 256,
        });
        await resolved.chat.invoke(
            resolved.prepareMessages([new SystemMessage("Be terse."), new HumanMessage("Hello")])
        );

        const body = captured[0]!.body;
        expect(body.temperature).toBe(0.2);
        expect(body.max_tokens).toBe(256);
        const messages = body.messages as { role: string }[];
        expect(messages[0]!.role).toBe("system");
    });

    it("writes the output cap to a declared alternate field", async () => {
        const resolved = resolveChatModel({
            config: deployment(`      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: unsupported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
        maxOutputTokensField: max_completion_tokens`),
            maxOutputTokens: 300,
            temperature: 0.7,
        });
        await resolved.chat.invoke([new HumanMessage("hi")]);

        const body = captured[0]!.body;
        expect(body.max_completion_tokens).toBe(300);
        expect(body).not.toHaveProperty("max_tokens");
        expect(body).not.toHaveProperty("temperature");
    });

    it("encodes image parts for a vision model", async () => {
        const resolved = resolveChatModel({ config: deployment(FULL_SUPPORT) });
        await resolved.chat.invoke([
            new HumanMessage({
                content: [
                    { type: "text", text: "What is this?" },
                    { type: "image_url", image_url: { url: "https://img.example/a.png" } },
                ],
            }),
        ]);

        const messages = captured[0]!.body.messages as {
            content: { type: string; image_url?: { url: string } }[];
        }[];
        const parts = messages[0]!.content;
        expect(parts.map(p => p.type)).toEqual(["text", "image_url"]);
        expect(parts[1]!.image_url?.url).toBe("https://img.example/a.png");
    });

    it("streams when the model declares streaming support", async () => {
        const resolved = resolveChatModel({
            config: deployment(FULL_SUPPORT),
            streaming: true,
        });
        // The mock returns a non-streaming body; we only assert the request flag,
        // which is what the behavior contract governs.
        await resolved.chat.invoke([new HumanMessage("hi")]).catch(() => undefined);
        expect(captured[0]!.body.stream).toBe(true);
    });
});

describe("reasoning payloads", () => {
    async function bodyFor(
        reasoning: string,
        control?: { enabled?: boolean; effort?: string; budgetTokens?: number }
    ) {
        const resolved = resolveChatModel({
            config: deployment(`      input: [text]
      reasoning:
${reasoning}
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`),
            reasoningControl: control,
        });
        await resolved.chat.invoke([new HumanMessage("hi")]);
        return { body: captured.at(-1)!.body, resolved };
    }

    it("mode none sends no reasoning fields", async () => {
        const { body, resolved } = await bodyFor("        mode: none");
        expect(resolved.reasoning).toMatchObject({ mode: "none", enabled: false });
        expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream"]);
    });

    it("mode always sends its declared patch on every request", async () => {
        const { body, resolved } = await bodyFor(
            "        mode: always\n        request: { thinking: { type: enabled } }"
        );
        expect(resolved.reasoning.enabled).toBe(true);
        expect(body.thinking).toEqual({ type: "enabled" });
    });

    it("mode toggle sends the on patch when enabled and the off patch otherwise", async () => {
        const declaration =
            "        mode: toggle\n        on: { enable_thinking: true }\n        off: { enable_thinking: false }";

        const on = await bodyFor(declaration, { enabled: true });
        expect(on.body.enable_thinking).toBe(true);

        const off = await bodyFor(declaration, { enabled: false });
        expect(off.body.enable_thinking).toBe(false);
    });

    it("mode toggle sends nothing when off is undeclared", async () => {
        const { body } = await bodyFor(
            "        mode: toggle\n        on: { enable_thinking: true }",
            { enabled: false }
        );
        expect(body).not.toHaveProperty("enable_thinking");
    });

    it("mode effort sends the selected level's exact patch", async () => {
        const declaration =
            "        mode: effort\n" +
            "        levels:\n" +
            "          low: { reasoning_effort: low }\n" +
            "          high: { reasoning_effort: high, extra_budget: 4096 }\n" +
            "        default: low\n" +
            "        off: {}";

        const high = await bodyFor(declaration, { enabled: true, effort: "high" });
        expect(high.body.reasoning_effort).toBe("high");
        expect(high.body.extra_budget).toBe(4096);
        expect(high.resolved.reasoning.effort).toBe("high");

        const fallback = await bodyFor(declaration, { enabled: true });
        expect(fallback.body.reasoning_effort).toBe("low");
        expect(fallback.resolved.reasoning.effort).toBe("low");

        const off = await bodyFor(declaration, { enabled: false });
        expect(off.body).not.toHaveProperty("reasoning_effort");
    });

    it("mode budget writes the token count to the declared field", async () => {
        const declaration =
            "        mode: budget\n" +
            "        field: thinking_budget_tokens\n" +
            "        default: 8000\n" +
            "        min: 1024\n" +
            "        max: 32000";

        const explicit = await bodyFor(declaration, {
            enabled: true,
            budgetTokens: 2048,
        });
        expect(explicit.body.thinking_budget_tokens).toBe(2048);
        expect(explicit.resolved.reasoning.budgetTokens).toBe(2048);

        const defaulted = await bodyFor(declaration, { enabled: true });
        expect(defaulted.body.thinking_budget_tokens).toBe(8000);

        const off = await bodyFor(declaration, { enabled: false });
        expect(off.body).not.toHaveProperty("thinking_budget_tokens");
    });
});

describe("structured output", () => {
    const Schema = z.object({ answer: z.string(), score: z.number() });

    it("uses native json-schema when the model declares it", async () => {
        respondWith = () => ({
            status: 200,
            payload: completion(JSON.stringify({ answer: "yes", score: 1 })),
        });

        const resolved = resolveChatModel({
            config: deployment(`      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: [json-schema]
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`),
        });
        const result = await invokeStructured(resolved, Schema, [new HumanMessage("q")], {
            name: "answer",
        });

        expect(result).toEqual({ answer: "yes", score: 1 });
        expect(captured[0]!.body.response_format).toMatchObject({
            type: "json_schema",
        });
    });

    it("falls back to a strict JSON prompt carrying the schema", async () => {
        respondWith = () => ({
            status: 200,
            payload: completion('```json\n{"answer":"maybe","score":0.5}\n```'),
        });

        const resolved = resolveChatModel({ config: deployment(FULL_SUPPORT) });
        const result = await invokeStructured(resolved, Schema, [new HumanMessage("q")], {
            name: "answer",
        });

        expect(result).toEqual({ answer: "maybe", score: 0.5 });
        expect(captured[0]!.body).not.toHaveProperty("response_format");
        const prompt = JSON.stringify(captured[0]!.body.messages);
        expect(prompt).toContain("Return only valid JSON");
        // The schema itself is in the prompt, not just an instruction to use one.
        expect(prompt).toContain("score");
    });

    it("makes exactly one repair attempt before failing clearly", async () => {
        let call = 0;
        respondWith = () => {
            call += 1;
            return {
                status: 200,
                payload: completion(call === 1 ? "not json at all" : '{"answer":"ok","score":3}'),
            };
        };

        const resolved = resolveChatModel({ config: deployment(FULL_SUPPORT) });
        const result = await invokeStructured(resolved, Schema, [new HumanMessage("q")], {
            name: "answer",
        });

        expect(result).toEqual({ answer: "ok", score: 3 });
        expect(captured).toHaveLength(2);
        expect(JSON.stringify(captured[1]!.body.messages)).toContain(
            "Your previous response was invalid"
        );
    });

    it("throws a typed error when the repair also fails, without retrying further", async () => {
        respondWith = () => ({ status: 200, payload: completion("still not json") });

        const resolved = resolveChatModel({ config: deployment(FULL_SUPPORT) });
        await expect(
            invokeStructured(resolved, Schema, [new HumanMessage("q")], { name: "answer" })
        ).rejects.toBeInstanceOf(StructuredOutputError);

        expect(captured).toHaveLength(2);
    });
});

describe("usage accounting", () => {
    it("normalizes usage reported through response metadata", async () => {
        const resolved = resolveChatModel({ config: deployment(FULL_SUPPORT) });
        const response = await resolved.chat.invoke([new HumanMessage("hi")]);

        expect(normalizeTokenUsage(response)).toMatchObject({
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18,
        });
    });

    it("reads the portable usage_metadata field when present", () => {
        expect(
            normalizeTokenUsage({
                usage_metadata: {
                    input_tokens: 3,
                    output_tokens: 4,
                    total_tokens: 7,
                    output_token_details: { reasoning: 2 },
                },
            })
        ).toEqual({
            inputTokens: 3,
            outputTokens: 4,
            totalTokens: 7,
            reasoningTokens: 2,
        });
    });

    it("reads a raw provider usage block and derives a missing total", () => {
        expect(
            normalizeTokenUsage({
                response_metadata: { usage: { prompt_tokens: 5, completion_tokens: 6 } },
            })
        ).toMatchObject({ inputTokens: 5, outputTokens: 6, totalTokens: 11 });
    });

    it("reports nothing rather than zero when the endpoint is silent", () => {
        expect(normalizeTokenUsage({ response_metadata: {} })).toEqual({});
    });
});

describe("error normalization", () => {
    const endpoint = { baseUrl: "https://endpoint.example/v1", apiKey: "k" };

    it("maps an authentication failure to 401 naming CHAT_API_KEY", () => {
        const described = describeChatEndpointError(
            new Error("401 Incorrect API key provided"),
            endpoint,
            "m"
        );
        expect(described).toMatchObject({ status: 401 });
        expect(described!.message).toContain("CHAT_API_KEY");
    });

    it("tells a keyless deployment to set a credential", () => {
        const described = describeChatEndpointError(
            new Error("401 unauthorized"),
            { baseUrl: endpoint.baseUrl },
            "m"
        );
        expect(described!.message).toMatch(/requires a credential/);
    });

    it("maps an unreachable endpoint to 502 naming the base URL", () => {
        const described = describeChatEndpointError(
            new Error("fetch failed: ECONNREFUSED"),
            endpoint,
            "m"
        );
        expect(described).toMatchObject({ status: 502 });
        expect(described!.message).toContain(endpoint.baseUrl);
    });

    it("maps an unknown model to 400 naming the model id", () => {
        const described = describeChatEndpointError(
            new Error("model_not_found"),
            endpoint,
            "vendor/typo"
        );
        expect(described).toMatchObject({ status: 400 });
        expect(described!.message).toContain("vendor/typo");
    });

    it("returns null for an error it cannot classify", () => {
        expect(describeChatEndpointError(new Error("something odd"), endpoint, "m")).toBeNull();
    });

    it("surfaces a real endpoint failure to the caller", async () => {
        respondWith = () => ({
            status: 401,
            payload: { error: { message: "Incorrect API key provided" } },
        });
        const resolved = resolveChatModel({ config: deployment(FULL_SUPPORT) });
        await expect(resolved.chat.invoke([new HumanMessage("hi")])).rejects.toThrow();
    });
});
