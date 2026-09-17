/**
 * Image generation over Google's native `:generateContent`.
 *
 * Reached when someone points `IMAGE_API_BASE_URL` at
 * `generativelanguage.googleapis.com` *without* the `/openai` compatibility
 * path. Worth supporting rather than insisting on the compat layer for two
 * reasons: the native API exposes image models before the compat layer does,
 * and it carries input images, so editing works here as it does on the chat
 * path.
 *
 * Two things differ from the OpenAI-shaped backends and both are easy to trip
 * over: the model id goes in the URL rather than the body, and auth is a
 * `x-goog-api-key` header rather than a bearer token.
 */

import { postJson } from "../http";
import {
    errorFromResponse,
    joinUrl,
    ImageGenerationError,
    type GeneratedImage,
    type ImageBackend,
    type ImageEndpointConfig,
    type ImageGenerationRequest,
    type ImageGenerationResult,
    type ImageWarning,
} from "../types";

interface GenerateContentResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                inlineData?: { mimeType?: string; data?: string };
                inline_data?: { mime_type?: string; data?: string };
            }>;
        };
        finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
}

export const geminiNativeBackend: ImageBackend = {
    shape: "gemini-native",

    async generate(
        request: ImageGenerationRequest,
        endpoint: ImageEndpointConfig,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const warnings: ImageWarning[] = [];
        const count = request.count ?? 1;

        if (count > 1) {
            warnings.push({
                type: "count-reduced",
                message: `generateContent returns one image per call; asked for ${count}, returning 1.`,
            });
        }

        const parts: Array<Record<string, unknown>> = [];
        for (const image of request.inputImages ?? []) {
            parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64 } });
        }
        parts.push({ text: request.prompt });

        const generationConfig: Record<string, unknown> = {
            // Without this the model answers an image request with prose.
            responseModalities: ["IMAGE", "TEXT"],
        };
        if (request.aspectRatio) {
            generationConfig.imageConfig = { aspectRatio: request.aspectRatio };
        }

        const body: Record<string, unknown> = {
            contents: [{ role: "user", parts }],
            generationConfig,
        };
        Object.assign(body, request.providerOptions ?? {});

        // Model id is part of the path here, not the body.
        const url = joinUrl(endpoint.baseUrl, `models/${request.modelId}:generateContent`);

        const response = await postJson(
            url,
            body,
            endpoint,
            endpoint.apiKey ? { "x-goog-api-key": endpoint.apiKey } : {},
            signal
        );

        if (!response.ok) throw await errorFromResponse(response, "gemini-native");

        const parsed = (await response.json()) as GenerateContentResponse;

        // A safety block is a 200 with no image. Surfacing it as "no image"
        // would send someone hunting for a config bug that is not there.
        const blockReason = parsed.promptFeedback?.blockReason;
        if (blockReason) {
            throw new ImageGenerationError({
                code: "content_blocked",
                message: `The provider declined to generate this image (${blockReason}).`,
                status: 422,
                retryable: false,
            });
        }

        const images: GeneratedImage[] = [];
        for (const candidate of parsed.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
                // Both spellings appear depending on API version.
                const inline = part.inlineData ?? part.inline_data;
                if (!inline?.data) continue;
                const mediaType =
                    ("mimeType" in (inline as object)
                        ? (inline as { mimeType?: string }).mimeType
                        : undefined) ??
                    (inline as { mime_type?: string }).mime_type ??
                    "image/png";
                images.push({ base64: inline.data, mediaType });
            }
        }

        if (images.length === 0) {
            throw new ImageGenerationError({
                code: "no_image_returned",
                message: `Model "${request.modelId}" returned no image part. Check that it is an image-capable model id.`,
                status: 502,
                retryable: false,
            });
        }

        return { images, warnings, shape: "gemini-native", modelId: request.modelId };
    },
};
