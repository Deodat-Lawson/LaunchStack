/**
 * A workspace's own chat configuration travels with its work, never through
 * the process-wide slot: two workspaces resolving at the same moment each get
 * their own endpoint, and a scope that can't be used fails rather than
 * falling back to the deployment's.
 */

import {
    ChatScopeUnavailableError,
    configureChatModels,
    createChatModelsConfig,
    describeChatError,
    describeChatEndpointError,
    getChatModelsConfig,
    getChatModelsSource,
    getPublicChatConfig,
    isChatConfigured,
    resetChatModelsConfig,
    resolveChatModel,
    runWithChatModelsScope,
    setUnscopedChatResolutionHandler,
    type ChatModelsConfig,
} from "@launchstack/llm";

const BEHAVIOR = `
      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`;

function config(baseUrl: string, id: string, owner?: "workspace"): ChatModelsConfig {
    return createChatModelsConfig({
        yaml: `
version: 1
models:
  primary:
    id: ${id}
    behavior:${BEHAVIOR}
routes:
  default: primary
`,
        endpoint: { baseUrl, apiKey: "k", ...(owner ? { owner } : {}) },
        sourceLabel: "test.yaml",
    });
}

const DEPLOYMENT = config("https://deployment.example/v1", "deployment-model");
const WORKSPACE_A = config("https://a.example/v1", "a-model", "workspace");
const WORKSPACE_B = config("https://b.example/v1", "b-model", "workspace");

const tick = () => new Promise(resolve => setTimeout(resolve, 1));

beforeEach(() => configureChatModels(DEPLOYMENT));
afterEach(() => {
    resetChatModelsConfig();
    setUnscopedChatResolutionHandler(null);
});

describe("chat model scope", () => {
    it("resolves the deployment's models outside any scope", () => {
        expect(resolveChatModel().modelId).toBe("deployment-model");
        expect(getChatModelsSource()).toBe("deployment");
    });

    it("resolves the scope's models inside it, however deep the call", async () => {
        const seen = await runWithChatModelsScope(
            { source: "workspace", config: WORKSPACE_A },
            async () => {
                await tick();
                const nested = async () => {
                    await tick();
                    return resolveChatModel().modelId;
                };
                return [getChatModelsSource(), await nested()];
            }
        );
        expect(seen).toEqual(["workspace", "a-model"]);
        // Leaving the scope leaves the deployment untouched.
        expect(resolveChatModel().modelId).toBe("deployment-model");
    });

    it("keeps concurrent workspaces apart", async () => {
        const run = (scope: ChatModelsConfig | undefined, rounds: number) =>
            runWithChatModelsScope(
                scope ? { source: "workspace", config: scope } : { source: "deployment" },
                async () => {
                    const ids: string[] = [];
                    for (let i = 0; i < rounds; i += 1) {
                        await tick();
                        ids.push(resolveChatModel().modelId);
                    }
                    return ids;
                }
            );

        const [a, b, plain] = await Promise.all([
            run(WORKSPACE_A, 20),
            run(WORKSPACE_B, 20),
            run(undefined, 20),
        ]);
        expect(new Set(a)).toEqual(new Set(["a-model"]));
        expect(new Set(b)).toEqual(new Set(["b-model"]));
        expect(new Set(plain)).toEqual(new Set(["deployment-model"]));
    });

    it("a deployment scope pins the default even inside a workspace's scope", () => {
        const id = runWithChatModelsScope({ source: "workspace", config: WORKSPACE_A }, () =>
            runWithChatModelsScope({ source: "deployment" }, () => resolveChatModel().modelId)
        );
        expect(id).toBe("deployment-model");
    });

    it("fails closed when the scope cannot be used", () => {
        const broken = new ChatScopeUnavailableError("Your workspace's own model can't be used.");
        runWithChatModelsScope({ source: "workspace", error: broken }, () => {
            expect(isChatConfigured()).toBe(true);
            expect(() => getChatModelsConfig()).toThrow(broken);
            expect(() => resolveChatModel()).toThrow(broken);
            expect(() => getPublicChatConfig()).toThrow(broken);
            // No deployment wording leaks out for a workspace failure.
            expect(describeChatError(new Error("401 Unauthorized"), "x")).toBeNull();
        });
    });

    it("the browser config follows the scope", () => {
        const seesImages = createChatModelsConfig({
            yaml: `
version: 1
models:
  primary:
    id: sees-images
    behavior:${BEHAVIOR.replace("input: [text]", "input: [text, image]")}
routes:
  default: primary
`,
            endpoint: { baseUrl: "https://c.example/v1", owner: "workspace" },
        });
        const inside = runWithChatModelsScope({ source: "workspace", config: seesImages }, () =>
            getPublicChatConfig()
        );
        expect(inside.routes.vision.available).toBe(true);
        // The deployment's text-only model still can't take images.
        expect(getPublicChatConfig().routes.vision.available).toBe(false);
    });

    it("reports resolutions made outside any scope, and only those", () => {
        const handler = jest.fn();
        setUnscopedChatResolutionHandler(handler);
        resolveChatModel();
        expect(handler).toHaveBeenCalledTimes(1);
        runWithChatModelsScope({ source: "deployment" }, () => resolveChatModel());
        runWithChatModelsScope({ source: "workspace", config: WORKSPACE_A }, () =>
            resolveChatModel()
        );
        // An explicit config is a deliberate choice, not a forgotten scope.
        resolveChatModel({ config: WORKSPACE_B });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe("workspace endpoint failures", () => {
    const workspace = { baseUrl: "https://a.example/v1", apiKey: "k", owner: "workspace" as const };
    const deployment = { baseUrl: "https://deployment.example/v1", apiKey: "k" };

    beforeEach(() => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it.each([
        ["401 Incorrect API key provided", 401, "rejected its API key"],
        ["402 Payment Required", 503, "run out of credit"],
        ["429 Rate limit reached", 429, "rate-limiting"],
        ["fetch failed", 502, "Couldn't reach"],
        ["404 model_not_found", 400, "doesn't serve the chosen model"],
    ])("words %s for the workspace's admins", (raw, status, words) => {
        const described = describeChatEndpointError(new Error(raw), workspace, "m");
        expect(described?.status).toBe(status);
        expect(described?.message).toContain(words);
        expect(described?.message).not.toMatch(/CHAT_API_KEY|CHAT_BASE_URL|a\.example/);
    });

    it("keeps the operator wording for the deployment's own endpoint", () => {
        expect(describeChatEndpointError(new Error("401"), deployment, "m")?.message).toContain(
            "CHAT_API_KEY"
        );
    });
});
