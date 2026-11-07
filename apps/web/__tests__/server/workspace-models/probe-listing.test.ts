/**
 * Listing what an endpoint serves, for the model pickers in Workspace › Bring
 * your own keys. OpenRouter's catalogue carries what it bills per token, so
 * the same listing brings the prices the form fills a picked model's empty
 * price with; no other server's prices are read.
 */

jest.mock("~/server/security/url-guard", () => ({ fetchPublicUrl: jest.fn() }));
// A self-hosted deployment: the listing goes through plain `fetch`.
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => false }));

import { listEndpointModels } from "~/server/workspace-models/probe";

const OPENROUTER = { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" };

function listing(data: unknown[]) {
    return jest.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { "content-type": "application/json" },
        })
    );
}

afterEach(() => jest.restoreAllMocks());

describe("listEndpointModels", () => {
    it("reads OpenRouter's per-token prices as dollars per 1M tokens", async () => {
        listing([
            {
                id: "anthropic/claude-sonnet-4",
                pricing: {
                    prompt: "0.000003",
                    completion: "0.000015",
                    input_cache_read: "0.0000003",
                },
            },
            {
                id: "openai/gpt-4o-mini",
                pricing: { prompt: "0.00000015", completion: "0.0000006" },
            },
            // Free, and a router with no fixed price: left unpriced.
            { id: "meta/llama:free", pricing: { prompt: "0", completion: "0" } },
            { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
            // Nothing usable.
            { id: "odd/model", pricing: { prompt: "cheap", completion: "" } },
            { id: "bare/model" },
        ]);

        const catalogue = await listEndpointModels(OPENROUTER);

        expect(catalogue.models).toEqual([
            "anthropic/claude-sonnet-4",
            "bare/model",
            "meta/llama:free",
            "odd/model",
            "openai/gpt-4o-mini",
            "openrouter/auto",
        ]);
        // No floating-point noise: 0.000003 × 1e6 is 3, not 2.9999999999999996.
        expect(catalogue.prices).toEqual({
            "anthropic/claude-sonnet-4": { input: 3, output: 15, cachedInput: 0.3 },
            "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
        });
    });

    it("reads no prices from any other server", async () => {
        listing([
            // Together lists prices too, in other units; they are not read.
            { id: "acme/chat", pricing: { input: 0.88, output: 0.88 } },
            { id: "models/gemini-3-flash", pricing: { prompt: "0.000003", completion: "0.00001" } },
        ]);

        const catalogue = await listEndpointModels({
            baseUrl: "https://api.together.xyz/v1",
            apiKey: "k",
        });

        expect(catalogue).toEqual({ models: ["acme/chat", "gemini-3-flash"], prices: {} });
    });
});
