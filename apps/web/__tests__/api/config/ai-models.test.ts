import { ChatScopeUnavailableError, type PublicChatConfig } from "@launchstack/llm";

import type * as ModelsModule from "~/lib/models";

// jest.mock is hoisted; only `mock*`-prefixed names may be referenced inside it.
const mockPublicChatConfig = jest.fn<PublicChatConfig, []>();

jest.mock("~/lib/models", () => ({
    getConfiguredPublicChatConfig: () => mockPublicChatConfig(),
    describeChatResolutionFailure:
        jest.requireActual<typeof ModelsModule>("~/lib/models").describeChatResolutionFailure,
}));

const mockWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockWorkspaceContext(),
}));

// Records whose models the route read under; runs the work as-is.
const mockScopes: unknown[] = [];
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (companyId: unknown, fn: () => unknown) => {
        mockScopes.push(companyId);
        return fn();
    },
}));

import { GET } from "~/app/api/config/ai-models/route";

const SANITIZED: PublicChatConfig = {
    routes: {
        default: {
            available: true,
            inheritsDefault: false,
            vision: { supported: false },
            reasoning: { mode: "none", controllable: false },
            nativeStructuredOutput: [],
        },
        fast: {
            available: true,
            inheritsDefault: true,
            vision: { supported: false },
            reasoning: { mode: "none", controllable: false },
            nativeStructuredOutput: [],
        },
        reasoning: {
            available: false,
            unavailableReason: 'No model is configured for the "reasoning" route.',
        },
        vision: {
            available: true,
            inheritsDefault: false,
            vision: { supported: true, mimeTypes: ["image/png"], maxImages: 3 },
            reasoning: { mode: "none", controllable: false },
            nativeStructuredOutput: ["json-schema"],
        },
    },
};

describe("GET /api/config/ai-models", () => {
    beforeEach(() => {
        mockPublicChatConfig.mockReset();
        mockWorkspaceContext.mockResolvedValue({ success: true, data: { companyId: 42n } });
        mockScopes.length = 0;
    });

    it("reads the routes under the caller's workspace models", async () => {
        mockPublicChatConfig.mockReturnValue(SANITIZED);

        await GET();
        expect(mockScopes).toEqual([42n]);
    });

    it("reads the deployment's routes for a caller with no workspace", async () => {
        mockPublicChatConfig.mockReturnValue(SANITIZED);
        mockWorkspaceContext.mockResolvedValue({ success: false, response: new Response() });

        const response = await GET();
        expect(response.status).toBe(200);
        expect(mockScopes).toEqual([null]);
    });

    it("returns the sanitized route configuration", async () => {
        mockPublicChatConfig.mockReturnValue(SANITIZED);

        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(SANITIZED);
    });

    it("never exposes endpoints, credentials, or request patches", async () => {
        mockPublicChatConfig.mockReturnValue(SANITIZED);

        const serialized = JSON.stringify(await (await GET()).json());
        for (const forbidden of [
            "baseUrl",
            "base_url",
            "apiKey",
            "api_key",
            "endpoint",
            "requestPatch",
            "reasoning_effort",
            "contextTokens",
            "maxOutputTokens",
        ]) {
            expect(serialized).not.toContain(forbidden);
        }
    });

    it("reports every route unavailable instead of 500-ing on a broken configuration", async () => {
        const logged = jest.spyOn(console, "error").mockImplementation(() => {});
        mockPublicChatConfig.mockImplementation(() => {
            throw new Error('/srv/chat-models.yaml: model "vendor/secret-9" is not declared');
        });

        const response = await GET();
        expect(response.status).toBe(200);

        const body = (await response.json()) as PublicChatConfig;
        for (const route of ["default", "fast", "reasoning", "vision"] as const) {
            expect(body.routes[route].available).toBe(false);
            expect(body.routes[route].unavailableReason).toMatch(/not configured correctly/);
        }
        // Every user sees this reason, so the error's path and model id stay
        // in the server log.
        expect(JSON.stringify(body)).not.toMatch(/secret-9|\/srv\//);
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });

    it("shows the workspace's own reason when its endpoint can't be used", async () => {
        const reason =
            "Your workspace's own model can't be used: its saved API key can't be read on this server, so enter it again. A workspace admin can fix it in Settings › Models.";
        mockPublicChatConfig.mockImplementation(() => {
            throw new ChatScopeUnavailableError(reason);
        });

        const body = (await (await GET()).json()) as PublicChatConfig;
        expect(body.routes.default.available).toBe(false);
        expect(body.routes.default.unavailableReason).toBe(reason);
    });
});
