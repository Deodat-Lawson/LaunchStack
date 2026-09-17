import { afterEach, describe, expect, it, vi } from "vitest";

import { describeImageEndpoint, generateImages, resolveImageApiShape } from "./index";
import { ImageGenerationError, type ImageEndpointConfig } from "./types";

const PNG = "iVBORw0KGgoAAAANSUhEUg==";

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const spy = vi.fn().mockResolvedValue({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response);
    vi.stubGlobal("fetch", spy);
    return spy;
}

/** The mock always receives a JSON string body; this keeps that knowledge in one place. */
function sentBody(spy: ReturnType<typeof mockFetchOnce>, call = 0): Record<string, unknown> {
    const init = (spy.mock.calls[call] as [string, RequestInit])[1];
    return JSON.parse(init.body as string) as Record<string, unknown>;
}

function sentUrl(spy: ReturnType<typeof mockFetchOnce>, call = 0): string {
    return (spy.mock.calls[call] as [string, RequestInit])[0];
}

function endpoint(over: Partial<ImageEndpointConfig> = {}): ImageEndpointConfig {
    return { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", ...over };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("shape inference — the thing that makes swapping URLs a config change", () => {
    it.each([
        ["https://openrouter.ai/api/v1", "chat-completions"],
        ["https://gateway.ai.cloudflare.com/v1/acct/gw", "chat-completions"],
        ["https://generativelanguage.googleapis.com/v1beta/openai", "images-generations"],
        ["https://generativelanguage.googleapis.com/v1beta/openai/", "images-generations"],
        ["https://generativelanguage.googleapis.com/v1beta", "gemini-native"],
        ["https://api.openai.com/v1", "images-generations"],
        ["https://some-gateway.internal/v1", "images-generations"],
    ])("reads %s as %s", (url, expected) => {
        expect(resolveImageApiShape(url).shape).toBe(expected);
    });

    it("lets an operator override a host whose name lies about its shape", () => {
        const resolved = resolveImageApiShape("https://openrouter.ai/api/v1", "images-generations");
        expect(resolved).toMatchObject({ shape: "images-generations", explicit: true });
    });

    it("explains its choice, so a misrouted endpoint is debuggable without a request", () => {
        expect(describeImageEndpoint(endpoint()).reason).toContain("modalities");
    });

    it("falls back to the common shape rather than throwing on an unparseable URL", () => {
        expect(resolveImageApiShape("not-a-url").shape).toBe("images-generations");
    });
});

describe("chat-completions backend (OpenRouter)", () => {
    it("asks for image output and returns the bytes", async () => {
        const fetchSpy = mockFetchOnce({
            choices: [
                { message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } },
            ],
        });

        const result = await generateImages(
            { prompt: "a duck", modelId: "google/gemini-2.5-flash-image", aspectRatio: "16:9" },
            endpoint()
        );

        expect(result.images).toEqual([{ base64: PNG, mediaType: "image/png" }]);
        expect(result.shape).toBe("chat-completions");

        expect(sentUrl(fetchSpy)).toBe("https://openrouter.ai/api/v1/chat/completions");
        const body = sentBody(fetchSpy);
        expect(body.modalities).toEqual(["image", "text"]);
        expect(body.image_config).toEqual({ aspect_ratio: "16:9" });
    });

    it("carries input images, which is what makes editing possible", async () => {
        const fetchSpy = mockFetchOnce({
            choices: [
                { message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } },
            ],
        });

        await generateImages(
            {
                prompt: "make the hat red",
                modelId: "google/gemini-2.5-flash-image",
                inputImages: [{ base64: PNG, mediaType: "image/png" }],
            },
            endpoint()
        );

        const body = sentBody(fetchSpy) as unknown as {
            messages: Array<{ content: Array<{ type: string }> }>;
        };
        expect(body.messages[0]?.content.map(p => p.type)).toEqual(["image_url", "text"]);
    });

    it("warns instead of lying when more than one image is asked for", async () => {
        mockFetchOnce({
            choices: [
                { message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } },
            ],
        });

        const result = await generateImages(
            { prompt: "a duck", modelId: "m", count: 3 },
            endpoint()
        );

        expect(result.images).toHaveLength(1);
        expect(result.warnings[0]).toMatchObject({ type: "count-reduced" });
    });

    it("names the model when a text-only one answers with prose", async () => {
        mockFetchOnce({ choices: [{ message: { content: "Here is a description of a duck." } }] });

        await expect(
            generateImages({ prompt: "a duck", modelId: "openai/gpt-4o-mini" }, endpoint())
        ).rejects.toMatchObject({ code: "no_image_returned", retryable: false });
    });
});

describe("images-generations backend (OpenAI / Gemini compat)", () => {
    const openai = endpoint({ baseUrl: "https://api.openai.com/v1" });

    it("requests bytes and converts our ratio into the pixel size it wants", async () => {
        const fetchSpy = mockFetchOnce({ data: [{ b64_json: PNG }] });

        const result = await generateImages(
            { prompt: "a duck", modelId: "gpt-image-1", aspectRatio: "16:9" },
            openai
        );

        expect(result.images).toEqual([{ base64: PNG, mediaType: "image/png" }]);
        expect(sentUrl(fetchSpy)).toBe("https://api.openai.com/v1/images/generations");
        expect(sentBody(fetchSpy)).toMatchObject({
            response_format: "b64_json",
            size: "1536x1024",
            n: 1,
        });
    });

    it("warns that it cannot edit rather than pretending it did", async () => {
        mockFetchOnce({ data: [{ b64_json: PNG }] });

        const result = await generateImages(
            {
                prompt: "make the hat red",
                modelId: "gpt-image-1",
                inputImages: [{ base64: PNG, mediaType: "image/png" }],
            },
            openai
        );

        expect(result.warnings[0]).toMatchObject({ type: "unsupported-option" });
        expect(result.warnings[0]?.message).toContain("ignored");
    });
});

describe("gemini-native backend", () => {
    const google = endpoint({ baseUrl: "https://generativelanguage.googleapis.com/v1beta" });

    it("puts the model in the path and the key in the Google header", async () => {
        const fetchSpy = mockFetchOnce({
            candidates: [
                { content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG } }] } },
            ],
        });

        const result = await generateImages(
            { prompt: "a duck", modelId: "gemini-2.5-flash-image" },
            google
        );

        expect(result.images).toEqual([{ base64: PNG, mediaType: "image/png" }]);
        expect(sentUrl(fetchSpy)).toBe(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent"
        );
        const init = (fetchSpy.mock.calls[0] as [string, RequestInit])[1];
        expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
        const body = sentBody(fetchSpy) as unknown as {
            generationConfig: { responseModalities: string[] };
        };
        expect(body.generationConfig.responseModalities).toEqual(["IMAGE", "TEXT"]);
    });

    it("reports a safety block as a block, not as a missing image", async () => {
        mockFetchOnce({ promptFeedback: { blockReason: "SAFETY" } });

        await expect(
            generateImages({ prompt: "...", modelId: "gemini-2.5-flash-image" }, google)
        ).rejects.toMatchObject({ code: "content_blocked", retryable: false });
    });
});

describe("failure policy", () => {
    it("marks 4xx non-retryable and 5xx retryable", async () => {
        mockFetchOnce({ error: "bad model" }, { ok: false, status: 400 });
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, endpoint())
        ).rejects.toMatchObject({ retryable: false, status: 400 });

        mockFetchOnce({ error: "upstream" }, { ok: false, status: 503 });
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, endpoint())
        ).rejects.toMatchObject({ retryable: true, status: 503 });
    });

    it("treats 429 as retryable even though it is a 4xx", async () => {
        mockFetchOnce({ error: "slow down" }, { ok: false, status: 429 });
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, endpoint())
        ).rejects.toMatchObject({ retryable: true });
    });

    it("refuses an unconfigured endpoint before making a request", async () => {
        const fetchSpy = mockFetchOnce({});
        await expect(
            generateImages({ prompt: "x", modelId: "m" }, endpoint({ baseUrl: "" }))
        ).rejects.toBeInstanceOf(ImageGenerationError);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses an empty prompt before making a request", async () => {
        const fetchSpy = mockFetchOnce({});
        await expect(
            generateImages({ prompt: "   ", modelId: "m" }, endpoint())
        ).rejects.toMatchObject({ code: "invalid_request" });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
