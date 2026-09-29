/**
 * Image generation — one call, three wire shapes, chosen by configuration.
 *
 * `generateImages()` is the whole public surface. Callers describe what they
 * want in our vocabulary; the shape resolved from the endpoint URL decides
 * which AI SDK provider answers. Moving a deployment from OpenRouter to Gemini
 * is an `.env` edit, and no caller learns which vendor answered.
 *
 * The vendor-specific translation is the AI SDK's (`ai` + one provider per
 * dialect, all Apache-2.0). What stays ours is the part the SDK deliberately
 * has no opinion about: which provider a URL implies, and what our callers see
 * when something fails. Both live here, so swapping the SDK back out — or
 * forward a major version — touches this file and `models.ts`, not callers.
 *
 * Deliberately *not* here: persistence, metering and access control. Those are
 * policy, and policy lives at the call site — in this repo, in
 * `@launchstack/tools/image-generation`.
 */

import { APICallError, generateImage, NoImageGeneratedError } from "ai";

import { buildImageModel } from "./models";
import { resolveImageApiShape, type ShapeResolution } from "./shape";
import {
    ImageGenerationError,
    isRetryableStatus,
    type GeneratedImage,
    type ImageEndpointConfig,
    type ImageGenerationRequest,
    type ImageGenerationResult,
    type ImageWarning,
} from "./types";

export * from "./types";
export { resolveImageApiShape, type ShapeResolution } from "./shape";
export { buildImageModel } from "./models";

/**
 * Generate one or more images from the configured endpoint.
 *
 * Throws {@link ImageGenerationError} — never a raw SDK error — so a caller can
 * branch on `retryable` without knowing which library made the request.
 */
export async function generateImages(
    request: ImageGenerationRequest,
    endpoint: ImageEndpointConfig,
    signal?: AbortSignal
): Promise<ImageGenerationResult> {
    if (!endpoint.baseUrl) {
        throw new ImageGenerationError({
            code: "not_configured",
            message:
                "No image endpoint is configured. Set IMAGE_API_BASE_URL (and its key), or let it fall back to the chat endpoint.",
            status: 503,
            retryable: false,
        });
    }

    if (!request.prompt.trim()) {
        throw new ImageGenerationError({
            code: "invalid_request",
            message: "An image prompt cannot be empty.",
            status: 400,
            retryable: false,
        });
    }

    const resolution = resolveImageApiShape(endpoint.baseUrl, endpoint.shape);
    const model = buildImageModel(resolution.shape, endpoint, request.modelId);

    // An edit is expressed as a prompt carrying images. Providers that cannot
    // accept them warn, which is exactly the reporting we want — so no
    // capability check here.
    const inputImages = request.inputImages ?? [];
    const prompt =
        inputImages.length > 0
            ? {
                  images: inputImages.map(image => Buffer.from(image.base64, "base64")),
                  text: request.prompt,
              }
            : request.prompt;

    try {
        const result = await generateImage({
            model,
            prompt,
            n: request.count ?? 1,
            aspectRatio: request.aspectRatio,
            abortSignal: signal,
            providerOptions: request.providerOptions as
                | Record<string, Record<string, never>>
                | undefined,
            // The SDK retries twice by default. For image generation that is a
            // silent double charge on a flaky network, and our contract already
            // says retry policy belongs to the caller — who is the only one who
            // knows whether a second picture is worth a second payment.
            maxRetries: 0,
        });

        const images: GeneratedImage[] = result.images.map(file => ({
            base64: file.base64,
            mediaType: file.mediaType,
        }));

        if (images.length === 0) {
            throw new ImageGenerationError({
                code: "no_image_returned",
                message: `Model "${request.modelId}" returned no image. Check that it supports image output — a text-only model answers this request with prose.`,
                status: 502,
                retryable: false,
            });
        }

        return {
            images,
            warnings: mapWarnings(result.warnings),
            shape: resolution.shape,
            modelId: request.modelId,
        };
    } catch (error) {
        throw toImageGenerationError(error, request.modelId, signal);
    }
}

/**
 * What shape would this configuration use, and why? For the boot report and
 * for operators debugging a misrouted endpoint, without making a request.
 */
export function describeImageEndpoint(endpoint: ImageEndpointConfig): ShapeResolution {
    return resolveImageApiShape(endpoint.baseUrl, endpoint.shape);
}

/**
 * The SDK's warnings carry provider-specific field names; ours carry a message
 * a caller can show someone. Unknown shapes degrade to `provider-note` rather
 * than being dropped — a warning we cannot classify is still a warning.
 */
function mapWarnings(warnings: readonly unknown[]): ImageWarning[] {
    return warnings.map(raw => {
        const warning = raw as { type?: string; setting?: string; details?: string };
        const detail = warning.details ?? "";

        if (warning.type === "unsupported-setting") {
            return {
                type: "unsupported-option",
                message: `This endpoint does not support "${warning.setting ?? "an option"}" and ignored it.${detail ? ` ${detail}` : ""}`,
            };
        }

        // Not `??` on purpose: an empty string carries no information and should
        // fall through to the next candidate, which `??` would not do.
        const message = [detail, warning.type].find(part => part && part.length > 0);
        return { type: "provider-note", message: message ?? "The provider returned a warning." };
    });
}

function toImageGenerationError(error: unknown, modelId: string, signal?: AbortSignal): unknown {
    // Already ours (the empty-images throw above), or the caller's own abort —
    // a cancellation must never be reported as a provider fault.
    if (error instanceof ImageGenerationError) return error;
    if (signal?.aborted) return error;

    if (NoImageGeneratedError.isInstance(error)) {
        return new ImageGenerationError({
            code: "no_image_returned",
            message: `Model "${modelId}" returned no image. Check that it supports image output — a text-only model answers this request with prose.`,
            status: 502,
            retryable: false,
        });
    }

    if (APICallError.isInstance(error)) {
        const status = error.statusCode ?? 502;
        return new ImageGenerationError({
            code: status === 401 || status === 403 ? "unauthorized" : "provider_error",
            message: `Image endpoint returned ${status}: ${error.message}`,
            status,
            // The SDK's own judgement wins when it made one; otherwise fall back
            // to the status, so one rule governs retryability either way.
            retryable: error.isRetryable ?? isRetryableStatus(status),
        });
    }

    return new ImageGenerationError({
        code: "transport_error",
        message: `Could not reach the image endpoint: ${error instanceof Error ? error.message : String(error)}`,
        status: 503,
        retryable: true,
    });
}
