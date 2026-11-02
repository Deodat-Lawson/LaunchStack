/**
 * A workspace's saved choices become a chat configuration with only what the
 * admin declared, on the workspace's endpoint, worded as the workspace's.
 */

import {
    ChatConfigurationError,
    resolveChatModel,
    resolveChatRoute,
    runWithChatModelsScope,
    type ChatUsageEvent,
} from "@launchstack/llm";

import { ASSISTANT_IDENTITY_RULE } from "~/lib/ai/assistant-identity";
import {
    behaviorForChoice,
    buildWorkspaceChatModelsConfig,
    selectionProblem,
    settledSelection,
} from "~/server/workspace-models/config";

const main = { id: "acme/chat-large", vision: false, reasoning: false };

describe("workspace model configuration", () => {
    it("declares only what the admin said, and the conservative rest", () => {
        expect(behaviorForChoice({ id: "m", vision: true, reasoning: true })).toEqual({
            input: ["text", "image"],
            reasoning: { mode: "always" },
            nativeStructuredOutput: [],
            parameters: {
                temperature: "unsupported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "unsupported",
            },
        });
        expect(behaviorForChoice(main).input).toEqual(["text"]);
        // Structured output by prompting unless the admin says otherwise.
        expect(behaviorForChoice(main).nativeStructuredOutput).toEqual([]);
        expect(
            behaviorForChoice({ ...main, structuredOutput: true }).nativeStructuredOutput
        ).toEqual(["json-schema"]);
        expect(behaviorForChoice(main).reasoning).toEqual({ mode: "none" });
    });

    it("builds a configuration on the workspace's endpoint", () => {
        const config = buildWorkspaceChatModelsConfig({
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test-123456",
            selection: {
                default: main,
                fast: { id: "acme/chat-small", vision: false, reasoning: false },
            },
        });
        expect(config.endpoint).toEqual({
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test-123456",
            owner: "workspace",
            // Whichever model answers, it introduces itself as the assistant.
            systemInstructions: ASSISTANT_IDENTITY_RULE,
        });
        expect(resolveChatRoute("default", config).definition.id).toBe("acme/chat-large");
        expect(resolveChatRoute("fast", config).definition.id).toBe("acme/chat-small");
        // Temperature and caps the app passes are not sent to an unverified model.
        const resolved = resolveChatModel({ config, temperature: 0.2, maxOutputTokens: 50 });
        expect(resolved.modelId).toBe("acme/chat-large");
    });

    it("leaves the key out for a keyless endpoint", () => {
        const config = buildWorkspaceChatModelsConfig({
            baseUrl: "http://gpu-box.lan:8000/v1",
            apiKey: null,
            selection: { default: main },
        });
        expect(config.endpoint.apiKey).toBeUndefined();
    });

    it("routes images and reasoning only to a model that declares them", () => {
        const plain = buildWorkspaceChatModelsConfig({
            baseUrl: "https://api.example.com/v1",
            selection: { default: main },
        });
        expect(() => resolveChatRoute("vision", plain)).toThrow();
        expect(() => resolveChatRoute("reasoning", plain)).toThrow();

        const capable = buildWorkspaceChatModelsConfig({
            baseUrl: "https://api.example.com/v1",
            selection: {
                default: main,
                vision: { id: "acme/sees", vision: true, reasoning: false },
                reasoning: { id: "acme/thinks", vision: false, reasoning: true },
            },
        });
        expect(resolveChatRoute("vision", capable).definition.id).toBe("acme/sees");
        expect(resolveChatRoute("reasoning", capable).definition.id).toBe("acme/thinks");
    });

    it("refuses selections that can't serve what they claim", () => {
        expect(selectionProblem({ default: { ...main, id: "has space" } })).toMatch(
            /doesn't look like a model id/
        );
        expect(
            selectionProblem({
                default: main,
                vision: { id: "x", vision: false, reasoning: false },
            })
        ).toMatch(/reads images/);
        expect(
            selectionProblem({
                default: main,
                reasoning: { id: "x", vision: false, reasoning: false },
            })
        ).toMatch(/reasons/);
        expect(selectionProblem({ default: main })).toBeNull();
        expect(() =>
            buildWorkspaceChatModelsConfig({
                baseUrl: "https://api.example.com/v1",
                selection: { default: main, vision: { id: "x", vision: false, reasoning: false } },
            })
        ).toThrow(ChatConfigurationError);
    });

    describe("a price the admin gave", () => {
        const priced = { ...main, pricing: { input: 3, output: 15 } };

        it("rides onto the model definition, where the transport prices each call", () => {
            const config = buildWorkspaceChatModelsConfig({
                baseUrl: "https://openrouter.ai/api/v1",
                selection: {
                    default: priced,
                    fast: {
                        id: "acme/chat-small",
                        vision: false,
                        reasoning: false,
                        pricing: { input: 0.15, output: 0.6, cachedInput: 0.075 },
                    },
                    reasoning: { id: "acme/thinks", vision: false, reasoning: true },
                },
            });
            expect(resolveChatRoute("default", config).definition.pricing).toEqual({
                input: 3,
                output: 15,
            });
            expect(resolveChatRoute("fast", config).definition.pricing).toEqual({
                input: 0.15,
                output: 0.6,
                cachedInput: 0.075,
            });
            // Unpriced: counted, not priced.
            expect(resolveChatRoute("reasoning", config).definition.pricing).toBeUndefined();
        });

        it("prices each call through the shared chat transport", async () => {
            const config = buildWorkspaceChatModelsConfig({
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test-123456",
                selection: { default: priced },
            });
            const events: ChatUsageEvent[] = [];
            const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
                new Response(
                    JSON.stringify({
                        id: "1",
                        object: "chat.completion",
                        created: 1,
                        model: "acme/chat-large",
                        choices: [
                            {
                                index: 0,
                                message: { role: "assistant", content: "OK" },
                                finish_reason: "stop",
                            },
                        ],
                        usage: { prompt_tokens: 1000, completion_tokens: 200 },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } }
                )
            );
            try {
                const resolved = runWithChatModelsScope(
                    { source: "workspace", config, usage: { record: event => events.push(event) } },
                    () => resolveChatModel({ config, maxRetries: 0 })
                );
                await resolved.chat.invoke("hello");
                // The usage block is read from a clone of the body, after the answer.
                await new Promise(resolve => setTimeout(resolve, 0));
            } finally {
                fetchSpy.mockRestore();
            }
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                modelId: "acme/chat-large",
                owner: "workspace",
                inputTokens: 1000,
                outputTokens: 200,
            });
            expect(events[0]!.costUsd).toBeCloseTo((1000 * 3 + 200 * 15) / 1_000_000, 12);
        });

        it("takes only the price fields a stored row carries", () => {
            const config = buildWorkspaceChatModelsConfig({
                baseUrl: "https://api.example.com/v1",
                selection: {
                    default: {
                        ...main,
                        pricing: { input: 1, output: 2, note: "x" } as unknown as {
                            input: number;
                            output: number;
                        },
                    },
                },
            });
            expect(resolveChatRoute("default", config).definition.pricing).toEqual({
                input: 1,
                output: 2,
            });
        });

        it("is refused in words when one side is missing or out of bounds", () => {
            expect(selectionProblem({ default: { ...main, pricing: { input: 3 } } })).toBe(
                'Give "acme/chat-large" both an input and an output price, or leave both empty.'
            );
            expect(
                selectionProblem({ default: { ...main, pricing: { input: null, output: 4 } } })
            ).toMatch(/both an input and an output price/);
            expect(selectionProblem({ default: { ...main, pricing: { cachedInput: 1 } } })).toMatch(
                /both an input and an output price/
            );
            for (const pricing of [
                { input: -1, output: 4 },
                { input: 3, output: 10_001 },
                { input: 3, output: 4, cachedInput: -0.5 },
                { input: Number.NaN, output: 4 },
                { input: Number.POSITIVE_INFINITY, output: 4 },
            ]) {
                expect(selectionProblem({ default: { ...main, pricing } })).toBe(
                    'Prices for "acme/chat-large" have to be between 0 and 10,000 US dollars per 1M tokens.'
                );
            }
            // A routed model's price is checked too.
            expect(
                selectionProblem({
                    default: main,
                    fast: {
                        id: "acme/small",
                        vision: false,
                        reasoning: false,
                        pricing: { output: 1 },
                    },
                })
            ).toMatch(/"acme\/small" both an input and an output price/);
            expect(() =>
                buildWorkspaceChatModelsConfig({
                    baseUrl: "https://api.example.com/v1",
                    selection: { default: { ...main, pricing: { input: -1, output: 1 } } },
                })
            ).toThrow(ChatConfigurationError);
        });

        it("accepts zero, the upper bound, and no price at all", () => {
            expect(
                selectionProblem({ default: { ...main, pricing: { input: 0, output: 0 } } })
            ).toBeNull();
            expect(
                selectionProblem({
                    default: { ...main, pricing: { input: 10_000, output: 10_000 } },
                })
            ).toBeNull();
            expect(selectionProblem({ default: { ...main, pricing: null } })).toBeNull();
            expect(
                selectionProblem({
                    default: { ...main, pricing: { input: null, output: null, cachedInput: null } },
                })
            ).toBeNull();
        });

        it("settles to what is stored: an empty price is none", () => {
            expect(
                settledSelection({
                    default: { ...main, pricing: { input: null, output: null } },
                    fast: { id: "acme/small", vision: false, reasoning: false, pricing: null },
                    vision: {
                        id: "acme/sees",
                        vision: true,
                        reasoning: false,
                        pricing: { input: 2, output: 8, cachedInput: null },
                    },
                })
            ).toEqual({
                default: main,
                fast: { id: "acme/small", vision: false, reasoning: false },
                vision: {
                    id: "acme/sees",
                    vision: true,
                    reasoning: false,
                    pricing: { input: 2, output: 8 },
                },
            });
            const settled = settledSelection({ default: main });
            expect(settled.default).not.toHaveProperty("pricing");
        });
    });
});
