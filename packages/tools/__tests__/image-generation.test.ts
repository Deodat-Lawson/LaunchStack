import { afterEach, describe, expect, it, vi } from "vitest";

import {
    generateImage,
    ImageConfigError,
    resolveImageToolConfig,
    DEFAULT_IMAGE_MODEL,
    type ImageAssetStore,
    type ImageToolConfig,
} from "../src/image-generation";

const PNG = "iVBORw0KGgoAAAANSUhEUg==";

const CONFIG: ImageToolConfig = {
    source: "chat",
    modelId: "google/gemini-2.5-flash-image",
    endpoint: { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" },
};

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

function imageResponse(n = 1) {
    return {
        choices: [
            {
                message: {
                    images: Array.from({ length: n }, () => ({
                        image_url: { url: `data:image/png;base64,${PNG}` },
                    })),
                },
            },
        ],
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

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

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
        mockFetchOnce(imageResponse());
        const storage = store();

        const result = await generateImage(
            { prompt: "a duck on a bicycle" },
            { storage, config: CONFIG }
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
        mockFetchOnce(imageResponse());

        const result = await generateImage({ prompt: "x" }, { storage: store(), config: CONFIG });

        expect(result.provenance).toMatchObject({
            tool: "image-generation.generate",
            modelId: "google/gemini-2.5-flash-image",
        });
        expect(result.provenance.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("reports spend once per persisted asset", async () => {
        mockFetchOnce(imageResponse(2));
        const onSpend = vi.fn();

        await generateImage({ prompt: "x" }, { storage: store(), config: CONFIG, onSpend });

        expect(onSpend).toHaveBeenCalledTimes(2);
    });

    it("bills nobody when the write fails after a paid generation", async () => {
        mockFetchOnce(imageResponse());
        const onSpend = vi.fn();
        const failing: ImageAssetStore = {
            upload: () => Promise.reject(new Error("disk full")),
        };

        await expect(
            generateImage({ prompt: "x" }, { storage: failing, config: CONFIG, onSpend })
        ).rejects.toThrow("disk full");

        expect(onSpend).not.toHaveBeenCalled();
    });

    it("surfaces provider failures as ToolError with retryability intact", async () => {
        mockFetchOnce({ error: "upstream" }, { ok: false, status: 503 });

        await expect(
            generateImage({ prompt: "x" }, { storage: store(), config: CONFIG })
        ).rejects.toMatchObject({ name: "ToolError", status: 503, retryable: true });
    });

    it("passes endpoint warnings through instead of hiding them", async () => {
        mockFetchOnce(imageResponse());

        const result = await generateImage(
            { prompt: "x", count: 3 },
            { storage: store(), config: CONFIG }
        );

        expect(result.data.warnings[0]).toMatchObject({ type: "count-reduced" });
    });

    it("rejects an empty prompt at the schema boundary", async () => {
        const fetchSpy = mockFetchOnce(imageResponse());

        await expect(
            generateImage({ prompt: "   " }, { storage: store(), config: CONFIG })
        ).rejects.toBeInstanceOf(Error);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
