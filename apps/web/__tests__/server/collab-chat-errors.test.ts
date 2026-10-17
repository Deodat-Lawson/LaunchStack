/**
 * A failed agent turn is posted in the meeting channel as
 * "@agent could not respond (<detail>)", so the detail must never carry the
 * model id or the provider's own error text (which can name the vendor and
 * its billing page).
 */

import {
    configureChatModels,
    createChatModelsConfig,
    resetChatModelsConfig,
} from "@launchstack/llm";

const mockInvoke = jest.fn();
jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: () => ({
        route: "default",
        modelId: "vendor/secret-model-9",
        chat: { invoke: mockInvoke },
        prepareMessages: (messages: unknown[]) => messages,
    }),
}));

import { createCollabChatFn } from "~/server/collab/chat";

const turn = { messages: [{ role: "user" as const, content: "Your turn." }] };

beforeAll(() => {
    // describeChatError needs an installed configuration to know the endpoint.
    configureChatModels(
        createChatModelsConfig({
            yaml: `
version: 1
models:
  primary:
    id: vendor/secret-model-9
    behavior:
      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
routes:
  default: primary
`,
            endpoint: { baseUrl: "https://api.vendor.example/v1", apiKey: "k" },
            sourceLabel: "test.yaml",
        })
    );
});
afterAll(() => resetChatModelsConfig());

beforeEach(() => {
    mockInvoke.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("collab chat failures", () => {
    it("posts the mapped message for a billing refusal, not the provider's text", async () => {
        mockInvoke.mockRejectedValue(
            new Error("402 Insufficient credits. Add more using https://vendor.example/credits")
        );
        const error = await createCollabChatFn()(turn).catch((e: unknown) => e as Error);
        expect(error.message).toMatch(/usage limit/);
        expect(error.message).not.toMatch(/vendor/);
    });

    it("posts a generic message for an error it cannot classify", async () => {
        mockInvoke.mockRejectedValue(
            new Error("vendor.example exploded: model vendor/secret-model-9")
        );
        const error = await createCollabChatFn()(turn).catch((e: unknown) => e as Error);
        expect(error.message).toBe("The AI service could not answer");
    });

    it("names the route, not the model, when a turn comes back empty", async () => {
        mockInvoke.mockResolvedValue({ content: "   " });
        const error = await createCollabChatFn()(turn).catch((e: unknown) => e as Error);
        expect(error.message).toBe("The default model returned an empty turn");
    });
});
