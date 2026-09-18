/**
 * image-generation — generate an image and persist it, as a contract-typed tool.
 *
 * The transport lives in `@launchstack/llm/images`, which speaks three wire
 * shapes and picks one from the endpoint URL. This module is the policy layer
 * on top of it, and it owns the three decisions the transport deliberately
 * refuses to make:
 *
 *   1. **Bytes are persisted here, never returned.** The caller gets a
 *      reference. An agent tool result is a string (see `AgentToolResult` in
 *      @launchstack/llm/agent), and base64 in a transcript would exhaust the
 *      context window on the first call.
 *   2. **The storage seam is injected, not imported.** Where an asset may be
 *      written is product-schema knowledge this package cannot hold — the same
 *      argument that makes rag-search-tool take an AccessValidator.
 *   3. **Spend is reported, not assumed.** `onSpend` fires once per asset that
 *      actually reached storage, so a failed write cannot bill anyone.
 */

import {
    generateImages as generateImagesOverHttp,
    ImageGenerationError,
    type ImageAspectRatio,
    type ImageInput,
    type ImageWarning,
} from "@launchstack/llm/images";
import { z } from "zod";

import { runTool, ToolError, type ToolResult, type ToolRunContext } from "../contract";
import { resolveImageToolConfig, type ImageToolConfig } from "./config";

export { DEFAULT_IMAGE_MODEL, resolveImageToolConfig, ImageConfigError } from "./config";
export type { ImageToolConfig } from "./config";

export const GenerateImageInput = z.object({
    prompt: z.string().trim().min(1).max(4000),
    aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
    count: z.number().int().min(1).max(4).default(1),
    /** Filename stem for the stored asset; the extension comes from the media type. */
    name: z.string().trim().max(120).optional(),
});

export type GenerateImageInput = z.input<typeof GenerateImageInput>;

/**
 * The storage seam. Structurally satisfied by `StoragePort` from
 * @launchstack/runtime, so apps hand over the port they already built — but
 * declared here as the narrowest thing this tool needs, which keeps the
 * package-dependency graph unchanged.
 */
export interface ImageAssetStore {
    upload(input: {
        filename: string;
        data: Buffer | ArrayBuffer | Uint8Array;
        contentType?: string;
        userId?: string;
    }): Promise<{ url: string; pathname: string }>;
}

export interface GeneratedAsset {
    url: string;
    pathname: string;
    mediaType: string;
    filename: string;
}

export interface GenerateImageDeps {
    storage: ImageAssetStore;
    /** Stamped on the upload so object ownership matches the rest of the app. */
    userId?: string;
    /** Images to edit. Honoured only on endpoints that can carry them. */
    inputImages?: ImageInput[];
    /**
     * Called once per asset that reached storage — never for one that failed to
     * persist. Metering belongs to the host, which owns the credit ledger.
     */
    onSpend?: (asset: GeneratedAsset) => void | Promise<void>;
    /** Overrides env resolution. Tests pass this; production rarely does. */
    config?: ImageToolConfig;
}

export interface GenerateImageOutput {
    assets: GeneratedAsset[];
    /** Options the endpoint could not honour. Not failures — the call worked. */
    warnings: ImageWarning[];
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};

/** Filesystem-safe stem, so a prompt can seed a filename without escaping. */
function slugify(value: string): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return slug || "image";
}

export async function generateImage(
    rawInput: GenerateImageInput,
    deps: GenerateImageDeps,
    ctx?: ToolRunContext
): Promise<ToolResult<GenerateImageOutput>> {
    const input = GenerateImageInput.parse(rawInput);

    let config: ImageToolConfig;
    try {
        config = deps.config ?? resolveImageToolConfig();
    } catch (error) {
        // An unconfigured deployment is a 503 the caller can explain, not a crash.
        throw new ToolError({
            code: "image_not_configured",
            message: error instanceof Error ? error.message : "Image generation is not configured.",
            status: 503,
        });
    }

    return runTool("image-generation.generate", async () => {
        const result = await generateImagesOverHttp(
            {
                prompt: input.prompt,
                modelId: config.modelId,
                count: input.count,
                aspectRatio: input.aspectRatio as ImageAspectRatio,
                inputImages: deps.inputImages,
            },
            config.endpoint,
            ctx?.signal
        ).catch((error: unknown) => {
            if (error instanceof ImageGenerationError) {
                throw new ToolError({
                    code: error.code,
                    message: error.message,
                    status: error.status,
                    retryable: error.retryable,
                });
            }
            throw error;
        });

        const stem = slugify(input.name ?? input.prompt);
        const assets: GeneratedAsset[] = [];

        for (const [index, image] of result.images.entries()) {
            const extension = EXTENSION_BY_MEDIA_TYPE[image.mediaType] ?? "png";
            const suffix = result.images.length > 1 ? `-${index + 1}` : "";
            const filename = `${stem}${suffix}-${Date.now()}.${extension}`;

            const stored = await deps.storage.upload({
                filename,
                data: Buffer.from(image.base64, "base64"),
                contentType: image.mediaType,
                userId: deps.userId,
            });

            const asset: GeneratedAsset = {
                url: stored.url,
                pathname: stored.pathname,
                mediaType: image.mediaType,
                filename,
            };
            assets.push(asset);

            // Only now — after the bytes are durable — is anyone billed. A
            // storage failure above throws before we get here, so the ordering
            // is the guarantee, not a comment.
            await deps.onSpend?.(asset);
        }

        return { value: { assets, warnings: result.warnings }, modelId: result.modelId };
    });
}
