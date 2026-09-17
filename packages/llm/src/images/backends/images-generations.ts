/**
 * Image generation over `POST /images/generations`.
 *
 * The oldest and most widely implemented shape: OpenAI's own endpoint, Gemini's
 * OpenAI-compatibility layer (`.../v1beta/openai`), and most gateways. One
 * prompt in, N images out.
 *
 * What it cannot do is edit. There is no conversation, so `inputImages` has
 * nowhere to go — a caller that wants iteration needs the chat-shaped path.
 * That is reported as a warning rather than an error, because "generate
 * something new" is still a reasonable thing to do with the request.
 */

import { bearerHeaders, postJson } from "../http";
import {
    errorFromResponse,
    joinUrl,
    parseDataUrl,
    ImageGenerationError,
    type GeneratedImage,
    type ImageAspectRatio,
    type ImageBackend,
    type ImageEndpointConfig,
    type ImageGenerationRequest,
    type ImageGenerationResult,
    type ImageWarning,
} from "../types";

/**
 * This shape takes pixel dimensions, not ratios. These are the sizes OpenAI's
 * image models accept; picking the nearest supported one beats forwarding a
 * ratio the endpoint will reject.
 */
const SIZE_BY_RATIO: Record<ImageAspectRatio, string> = {
    "1:1": "1024x1024",
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "4:3": "1536x1024",
    "3:4": "1024x1536",
};

/** 4:3 and 3:4 have no exact match above, so callers are told what they got. */
const INEXACT_RATIOS: ReadonlySet<ImageAspectRatio> = new Set(["4:3", "3:4"]);

interface ImagesGenerationsResponse {
    data?: Array<{ b64_json?: string; url?: string }>;
}

export const imagesGenerationsBackend: ImageBackend = {
    shape: "images-generations",

    async generate(
        request: ImageGenerationRequest,
        endpoint: ImageEndpointConfig,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const warnings: ImageWarning[] = [];

        if (request.inputImages?.length) {
            warnings.push({
                type: "unsupported-option",
                message:
                    "This endpoint generates from a prompt only; the supplied input images were ignored. Point IMAGE_API_BASE_URL at a chat-shaped endpoint (e.g. OpenRouter) to edit an existing image.",
            });
        }

        const body: Record<string, unknown> = {
            model: request.modelId,
            prompt: request.prompt,
            n: request.count ?? 1,
            // Ask for bytes. Without this some endpoints return a short-lived
            // URL, and this layer's contract is bytes the caller can persist.
            response_format: "b64_json",
        };

        if (request.aspectRatio) {
            body.size = SIZE_BY_RATIO[request.aspectRatio];
            if (INEXACT_RATIOS.has(request.aspectRatio)) {
                warnings.push({
                    type: "provider-note",
                    message: `This endpoint takes pixel sizes, not ratios; ${request.aspectRatio} was rendered at ${String(body.size)}.`,
                });
            }
        }

        Object.assign(body, request.providerOptions ?? {});

        const response = await postJson(
            joinUrl(endpoint.baseUrl, "images/generations"),
            body,
            endpoint,
            bearerHeaders(endpoint),
            signal
        );

        if (!response.ok) throw await errorFromResponse(response, "images-generations");

        const parsed = (await response.json()) as ImagesGenerationsResponse;
        const images: GeneratedImage[] = [];

        for (const entry of parsed.data ?? []) {
            if (entry.b64_json) {
                // This shape does not declare a media type. PNG is what every
                // endpoint we speak to returns for b64_json.
                images.push({ base64: entry.b64_json, mediaType: "image/png" });
                continue;
            }
            if (entry.url) {
                const inline = parseDataUrl(entry.url);
                if (inline) images.push(inline);
            }
        }

        if (images.length === 0) {
            throw new ImageGenerationError({
                code: "no_image_returned",
                message: `Model "${request.modelId}" returned no image bytes. If the endpoint only serves hosted URLs it cannot be used here — it must honour response_format: b64_json.`,
                status: 502,
                retryable: false,
            });
        }

        return { images, warnings, shape: "images-generations", modelId: request.modelId };
    },
};
