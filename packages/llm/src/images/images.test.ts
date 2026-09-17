/**
 * These drive the real AI SDK providers through an injected `fetch`, so the
 * request each shape actually puts on the wire is what gets asserted. A fake
 * backend would only prove our own mapping; this proves the provider wiring
 * too, which is the part we no longer write and therefore the part most likely
 * to change under us on an upgrade.
 */

import { describe, expect, it, vi } from "vitest";

import { describeImageEndpoint, generateImages, resolveImageApiShape } from "./index";
import { ImageGenerationError, type ImageEndpointConfig } from "./types";

/** A 1x1 PNG — small, but real bytes, so base64 round-trips are honest. */
const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface Captured {
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
}

/** Replays one JSON response and records what was sent. */
function fakeFetch(response: unknown, init: { status?: number } = {}) {
    const calls: Captured[] = [];
    const fetchImpl = vi.fn(async (input: unknown, requestInit?: RequestInit) => {
        const url = typeof input === "string" ? input : String((input as Request).url);
        const rawHeaders = (requestInit?.headers ?? {}) as Record<string, string>;
        calls.push({
            url,
            body: requestInit?.body
                ? (JSON.parse(requestInit.body as string) as Record<string, unknown>)
                : {},
            headers: Object.fromEntries(
                Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v])
            ),
        });
        const status = init.status ?? 200;
        return new Response(JSON.stringify(response), {
            status,
            headers: { "content-type": "application/json" },
        });
    });
    return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function endpoint(over: Partial<ImageEndpointConfig> = {}): ImageEndpointConfig {
    return { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", ...over };
}

describe("shape inference — the thing that makes swapping URLs a config change", () => {
    it.each([
        ["https://openrouter.ai/api/v1", "openrouter"],
        // Not OpenRouter: a proxy that speaks OpenAI routes is the default shape.
        ["https://gateway.ai.cloudflare.com/v1/acct/gw", "openai-compatible"],
        ["https://generativelanguage.googleapis.com/v1beta/openai", "openai-compatible"],
        ["https://generativelanguage.googleapis.com/v1beta/openai/", "openai-compatible"],
        ["https://generativelanguage.googleapis.com/v1beta", "google-native"],
        ["https://api.openai.com/v1", "openai-compatible"],
        ["https://some-gateway.internal/v1", "openai-compatible"],
    ])("reads %s as %s", (url, expected) => {
        expect(resolveImageApiShape(url).shape).toBe(expected);
    });

    it("lets an operator override a host whose name lies about its shape", () => {
        expect(
            resolveImageApiShape("https://openrouter.ai/api/v1", "openai-compatible")
        ).toMatchObject({ shape: "openai-compatible", explicit: true });
    });

    it("explains its choice, so a misrouted endpoint is debuggable without a request", () => {
        expect(describeImageEndpoint(endpoint()).reason).toContain("/images");
    });

    it("falls back to the common shape rather than throwing on an unparseable URL", () => {
        expect(resolveImageApiShape("not-a-url").shape).toBe("openai-compatible");
    });
});

describe("openrouter shape", () => {
    // OpenRouter's provider targets its own /images endpoint and expects the
    // b64_json envelope — NOT the chat-completions + modalities path its docs
    // describe. This fixture is the contract we actually depend on.
    const imagesResponse = { created: 1, data: [{ b64_json: PNG }] };

    it("posts to /images and returns the bytes", async () => {
        const { fetchImpl, calls } = fakeFetch(imagesResponse);

        const result = await generateImages(
            { prompt: "a duck", modelId: "google/gemini-2.5-flash-image", aspectRatio: "16:9" },
            endpoint({ fetch: fetchImpl })
        );

        expect(result.shape).toBe("openrouter");
        expect(result.images[0]?.base64).toBe(PNG);
        expect(calls[0]?.url).toContain("/images");
        expect(calls[0]?.body.model).toBe("google/gemini-2.5-flash-image");
    });

    it("carries input images, which is what makes editing possible", async () => {
        const { fetchImpl, calls } = fakeFetch(imagesResponse);

        await generateImages(
            {
                prompt: "make the hat red",
                modelId: "google/gemini-2.5-flash-image",
                inputImages: [{ base64: PNG, mediaType: "image/png" }],
            },
            endpoint({ fetch: fetchImpl })
        );

        // The image has to reach the wire, whatever the provider calls the field.
        expect(JSON.stringify(calls[0]?.body)).toContain(PNG.slice(0, 32));
    });

    it("sends the caller's key as a bearer token", async () => {
        const { fetchImpl, calls } = fakeFetch(imagesResponse);
        await generateImages({ prompt: "x", modelId: "m" }, endpoint({ fetch: fetchImpl }));
        expect(calls[0]?.headers.authorization).toBe("Bearer k");
    });
});

describe("openai-compatible shape", () => {
    it("posts to /images/generations and returns the bytes", async () => {
        const { fetchImpl, calls } = fakeFetch({ data: [{ b64_json: PNG }] });

        const result = await generateImages(
            { prompt: "a duck", modelId: "gpt-image-1" },
            endpoint({ baseUrl: "https://api.openai.com/v1", fetch: fetchImpl })
        );

        expect(result.shape).toBe("openai-compatible");
        expect(result.images[0]?.base64).toBe(PNG);
        expect(calls[0]?.url).toContain("/images/generations");
        expect(calls[0]?.body.prompt).toBe("a duck");
    });

    it("routes Google's compatibility path through the same shape", async () => {
        const { fetchImpl, calls } = fakeFetch({ data: [{ b64_json: PNG }] });

        const result = await generateImages(
            { prompt: "a duck", modelId: "gemini-2.5-flash-image" },
            endpoint({
                baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
                fetch: fetchImpl,
            })
        );

        expect(result.shape).toBe("openai-compatible");
        expect(calls[0]?.url).toBe(
            "https://generativelanguage.googleapis.com/v1beta/openai/images/generations"
        );
    });
});

describe("google-native shape", () => {
    it("posts to :generateContent and reads the inline image part", async () => {
        const { fetchImpl, calls } = fakeFetch({
            candidates: [
                {
                    content: {
                        role: "model",
                        parts: [{ inlineData: { mimeType: "image/png", data: PNG } }],
                    },
                    finishReason: "STOP",
                },
            ],
        });

        const result = await generateImages(
            { prompt: "a duck", modelId: "gemini-2.5-flash-image" },
            endpoint({
                baseUrl: "https://generativelanguage.googleapis.com/v1beta",
                fetch: fetchImpl,
            })
        );

        expect(result.shape).toBe("google-native");
        expect(result.images[0]?.base64).toBe(PNG);
        expect(calls[0]?.url).toContain("gemini-2.5-flash-image");
    });
});

describe("failure policy", () => {
    const failing = (status: number) =>
        endpoint({ fetch: fakeFetch({ error: { message: "nope" } }, { status }).fetchImpl });

    it("marks 4xx non-retryable and 5xx retryable", async () => {
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, failing(400))
        ).rejects.toMatchObject({ name: "ImageGenerationError", retryable: false });

        await expect(
            generateImages({ prompt: "x", modelId: "m" }, failing(503))
        ).rejects.toMatchObject({ name: "ImageGenerationError", retryable: true });
    });

    it("treats 429 as retryable even though it is a 4xx", async () => {
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, failing(429))
        ).rejects.toMatchObject({ retryable: true });
    });

    it("reports an auth failure as unauthorized, not a generic provider error", async () => {
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, failing(401))
        ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("never lets a raw SDK error escape", async () => {
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, failing(500))
        ).rejects.toBeInstanceOf(ImageGenerationError);
    });

    it("refuses an unconfigured endpoint before making a request", async () => {
        const { fetchImpl, calls } = fakeFetch({});
        await expect(
            generateImages(
                { prompt: "x", modelId: "m" },
                endpoint({ baseUrl: "", fetch: fetchImpl })
            )
        ).rejects.toMatchObject({ code: "not_configured" });
        expect(calls).toHaveLength(0);
    });

    it("refuses an empty prompt before making a request", async () => {
        const { fetchImpl, calls } = fakeFetch({});
        await expect(
            generateImages({ prompt: "   ", modelId: "m" }, endpoint({ fetch: fetchImpl }))
        ).rejects.toMatchObject({ code: "invalid_request" });
        expect(calls).toHaveLength(0);
    });

    it("does not retry — a second attempt is a second charge", async () => {
        const { fetchImpl, calls } = fakeFetch({ error: { message: "boom" } }, { status: 500 });
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, endpoint({ fetch: fetchImpl }))
        ).rejects.toBeInstanceOf(ImageGenerationError);
        expect(calls).toHaveLength(1);
    });
});
