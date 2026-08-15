import type { PublicChatConfig } from "@launchstack/core/llm";

// jest.mock is hoisted; only `mock*`-prefixed names may be referenced inside it.
const mockPublicChatConfig = jest.fn<PublicChatConfig, []>();

jest.mock("~/lib/models", () => ({
    getConfiguredPublicChatConfig: () => mockPublicChatConfig(),
}));

import { GET } from "~/app/api/config/ai-models/route";

const SANITIZED: PublicChatConfig = {
    routes: {
        default: {
            available: true,
            model: "vendor/default",
            inheritsDefault: false,
            vision: { supported: false },
            reasoning: { mode: "none", controllable: false },
            nativeStructuredOutput: [],
        },
        fast: {
            available: true,
            model: "vendor/default",
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
            model: "vendor/looker",
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
        mockPublicChatConfig.mockImplementation(() => {
            throw new Error('chat-models.yaml: model "primary" is not declared');
        });

        const response = await GET();
        expect(response.status).toBe(200);

        const body = (await response.json()) as PublicChatConfig;
        for (const route of ["default", "fast", "reasoning", "vision"] as const) {
            expect(body.routes[route].available).toBe(false);
            expect(body.routes[route].unavailableReason).toContain("not declared");
        }
    });
});
