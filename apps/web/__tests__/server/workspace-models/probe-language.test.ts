/**
 * A model test result reaches Settings › Bring your own keys: a classified endpoint
 * failure is worded for the admin's language, without the "fix it in
 * Settings" hint they are already looking at.
 */

const mockInvoke = jest.fn();
jest.mock("@launchstack/llm", () => ({
    ChatConfigurationError: class extends Error {},
    describeChatEndpointError: () => ({
        message:
            "Your workspace's AI provider rejected its API key. A workspace admin can fix it in Settings › Bring your own keys.",
    }),
    modelContentToText: (content: unknown) => String(content),
    resolveChatModel: () => ({
        chat: { invoke: (...args: unknown[]) => mockInvoke(...args) },
        prepareMessages: (messages: unknown) => messages,
    }),
}));
jest.mock("~/server/workspace-models/config", () => ({
    WORKSPACE_MODEL_ROUTES: ["default"],
    buildWorkspaceChatModelsConfig: () => ({ endpoint: {} }),
}));
jest.mock("~/server/security/url-guard", () => ({ fetchPublicUrl: jest.fn() }));
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => false }));

import { testEndpoint } from "~/server/workspace-models/probe";

const candidate = { baseUrl: "https://a.b/v1", apiKey: "k" };
const selection = { default: { id: "acme/chat", vision: false, reasoning: false } };

beforeEach(() => mockInvoke.mockRejectedValue(new Error("401")));

describe("testEndpoint", () => {
    it("keeps the English, minus the Settings hint, by default", async () => {
        const [result] = await testEndpoint(candidate, selection);
        expect(result?.message).toBe("Your workspace's AI provider rejected its API key.");
    });

    it("words a classified failure in Chinese, minus the hint", async () => {
        const [result] = await testEndpoint(candidate, selection, "zh-CN");
        expect(result?.message).toBe("你工作区的 AI 服务商拒绝了它的 API 密钥。");
    });
});
