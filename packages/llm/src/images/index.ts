/**
 * Image generation — one call, three wire shapes, chosen by configuration.
 *
 * `generateImages()` is the whole public surface. Callers describe what they
 * want in our vocabulary; the backend for the configured endpoint translates.
 * Moving a deployment from OpenRouter to Gemini is an `.env` edit, and no
 * caller learns which vendor answered.
 *
 * Shape borrowed from the Vercel AI SDK's `generateImage`: one function, a
 * provider-shaped adapter underneath, and a `warnings` array so an option a
 * given endpoint cannot honour is reported rather than silently dropped.
 *
 * Deliberately *not* here: persistence, metering, retries and access control.
 * Those are policy, and policy lives at the call site — in this repo, in
 * `@launchstack/tools/image-generation`, which is also the layer that turns
 * these bytes into a stored asset. This module speaks HTTP and nothing else.
 */

import { chatCompletionsBackend } from "./backends/chat-completions";
import { geminiNativeBackend } from "./backends/gemini-native";
import { imagesGenerationsBackend } from "./backends/images-generations";
import { resolveImageApiShape, type ShapeResolution } from "./shape";
import {
    ImageGenerationError,
    type ImageApiShape,
    type ImageBackend,
    type ImageEndpointConfig,
    type ImageGenerationRequest,
    type ImageGenerationResult,
} from "./types";

export * from "./types";
export { resolveImageApiShape, type ShapeResolution } from "./shape";

const BACKENDS: Record<ImageApiShape, ImageBackend> = {
    "chat-completions": chatCompletionsBackend,
    "images-generations": imagesGenerationsBackend,
    "gemini-native": geminiNativeBackend,
};

/**
 * Generate one or more images from the configured endpoint.
 *
 * Throws {@link ImageGenerationError} — never a bare fetch error — so a caller
 * can branch on `retryable` without parsing a message.
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
    const backend = BACKENDS[resolution.shape];

    return backend.generate(request, endpoint, signal);
}

/**
 * What shape would this configuration use, and why? For the boot report and
 * for operators debugging a misrouted endpoint, without making a request.
 */
export function describeImageEndpoint(endpoint: ImageEndpointConfig): ShapeResolution {
    return resolveImageApiShape(endpoint.baseUrl, endpoint.shape);
}
