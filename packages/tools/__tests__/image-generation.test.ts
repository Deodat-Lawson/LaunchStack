import { describe, expect, it, vi } from "vitest";

import {
    generateImage,
    ImageConfigError,
    resolveImageToolConfig,
    DEFAULT_IMAGE_MODEL,
    type ImageAssetStore,
    type ImageToolConfig,
} from "../src/image-generation";

/** A 1x1 PNG — real bytes, so the base64 → Buffer → upload path is honest. */
const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Replays one response through the endpoint's injected `fetch`, so the real
 * OpenRouter provider does the request/response translation. Its image model
 * targets /images and expects the b64_json envelope.
 */
function fakeFetch(response: unknown, init: { status?: number } = {}) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
        calls.push(typeof input === "string" ? input : String((input as Request).url));
        return new Response(JSON.stringify(response), {
            status: init.status ?? 200,
            headers: { "content-type": "application/json" },
        });
    });
    return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function imageResponse(n = 1) {
    return { created: 1, data: Array.from({ length: n }, () => ({ b64_json: PNG })) };
}

function configWith(fetchImpl: typeof globalThis.fetch): ImageToolConfig {
    return {
        source: "chat",
        modelId: "google/gemini-2.5-flash-image",
        endpoint: { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", fetch: fetchImpl },
    };
}

function store(): ImageAssetStore & { uploads: Array<{ filename: string; size: number }> } {
    const uploads: Array<{ filename: string; size: number }> = [];
    return {
        uploads,
        async upload(input) {
            uploads.push({
                filename: input.filename,
                size: Buffer.from(input.data as Uint8Array).byteLength,
            });
            return { url: `https://cdn.test/${input.filename}`, pathname: `a/${input.filename}` };
        },
    };
}

describe("endpoint resolution", () => {
    it("prefers explicit image config over chat", () => {
        const config = resolveImageToolConfig({
            IMAGE_API_BASE_URL: "https://api.openai.com/v1",
            IMAGE_API_KEY: "img",
            CHAT_BASE_URL: "https://openrouter.ai/api/v1",
            CHAT_API_KEY: "chat",
        } as NodeJS.ProcessEnv);

        expect(config.source).toBe("image");
        expect(config.endpoint.baseUrl).toBe("https://api.openai.com/v1");
    });

    it("falls back to the chat credential, which is the whole point on OpenRouter", () => {
        const config = resolveImageToolConfig({
            CHAT_BASE_URL: "https://openrouter.ai/api/v1",
            CHAT_API_KEY: "chat",
        } as NodeJS.ProcessEnv);

        expect(config).toMatchObject({ source: "chat", modelId: DEFAULT_IMAGE_MODEL });
    });

    it("ignores a level whose key is missing rather than half-configuring it", () => {
        const config = resolveImageToolConfig({
            IMAGE_API_BASE_URL: "https://api.openai.com/v1", // no key
            AI_BASE_URL: "https://ai.test/v1",
            AI_API_KEY: "global",
        } as NodeJS.ProcessEnv);

        expect(config.source).toBe("global");
    });

    it("throws a typed error when nothing is configured", () => {
        expect(() => resolveImageToolConfig({} as NodeJS.ProcessEnv)).toThrow(ImageConfigError);
        try {
            resolveImageToolConfig({} as NodeJS.ProcessEnv);
        } catch (error) {
            // The message has to name the variables, or the operator is guessing.
            expect(error).toMatchObject({ code: "image_not_configured", status: 503 });
            expect((error as Error).message).toContain("IMAGE_API_BASE_URL");
            expect((error as Error).message).toContain("CHAT_BASE_URL");
        }
    });
});

describe("generate and persist", () => {
    it("stores the bytes and returns a reference, never the image itself", async () => {
        const { fetchImpl } = fakeFetch(imageResponse());
        const storage = store();

        const result = await generateImage(
            { prompt: "a duck on a bicycle" },
            { storage, config: configWith(fetchImpl) }
        );

        expect(result.data.assets).toHaveLength(1);
        expect(result.data.assets[0]).toMatchObject({
            url: expect.stringContaining("https://cdn.test/"),
            mediaType: "image/png",
        });
        expect(JSON.stringify(result.data)).not.toContain(PNG);
        expect(storage.uploads[0]?.filename).toMatch(/^a-duck-on-a-bicycle-\d+\.png$/);
    });

    it("stamps provenance so a run can be traced to a model", async () => {
        const { fetchImpl } = fakeFetch(imageResponse());

        const result = await generateImage(
            { prompt: "x" },
            { storage: store(), config: configWith(fetchImpl) }
        );

        expect(result.provenance).toMatchObject({
            tool: "image-generation.generate",
            modelId: "google/gemini-2.5-flash-image",
        });
        expect(result.provenance.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("reports spend once per persisted asset", async () => {
        const { fetchImpl } = fakeFetch(imageResponse(2));
        const onSpend = vi.fn();

        await generateImage(
            { prompt: "x", count: 2 },
            { storage: store(), config: configWith(fetchImpl), onSpend }
        );

        expect(onSpend).toHaveBeenCalledTimes(2);
    });

    it("bills nobody when the write fails after a paid generation", async () => {
        const { fetchImpl } = fakeFetch(imageResponse());
        const onSpend = vi.fn();
        const failing: ImageAssetStore = {
            upload: () => Promise.reject(new Error("disk full")),
        };

        await expect(
            generateImage(
                { prompt: "x" },
                { storage: failing, config: configWith(fetchImpl), onSpend }
            )
        ).rejects.toThrow("disk full");

        expect(onSpend).not.toHaveBeenCalled();
    });

    it("surfaces provider failures as ToolError with retryability intact", async () => {
        const { fetchImpl } = fakeFetch({ error: { message: "upstream" } }, { status: 503 });

        await expect(
            generateImage({ prompt: "x" }, { storage: store(), config: configWith(fetchImpl) })
        ).rejects.toMatchObject({ name: "ToolError", status: 503, retryable: true });
    });

    it("stores every image the endpoint returns", async () => {
        const { fetchImpl } = fakeFetch(imageResponse(3));
        const storage = store();

        const result = await generateImage(
            { prompt: "x", count: 3 },
            { storage, config: configWith(fetchImpl) }
        );

        expect(result.data.assets).toHaveLength(3);
        // Distinct filenames, or the third write silently overwrites the first.
        expect(new Set(storage.uploads.map(u => u.filename)).size).toBe(3);
    });

    it("rejects an empty prompt at the schema boundary", async () => {
        const { fetchImpl, calls } = fakeFetch(imageResponse());

        await expect(
            generateImage({ prompt: "   " }, { storage: store(), config: configWith(fetchImpl) })
        ).rejects.toBeInstanceOf(Error);
        expect(calls).toHaveLength(0);
    });
});
