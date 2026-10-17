/**
 * A workspace's saved choices become a chat configuration with only what the
 * admin declared, on the workspace's endpoint, worded as the workspace's.
 */

import { ChatConfigurationError, resolveChatModel, resolveChatRoute } from "@launchstack/llm";

import {
    behaviorForChoice,
    buildWorkspaceChatModelsConfig,
    selectionProblem,
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
});
