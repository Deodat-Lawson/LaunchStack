/**
 * Image generation over `POST /chat/completions` with `modalities`.
 *
 * This is how OpenRouter does it, and it is the shape this deployment hits
 * today: `CHAT_BASE_URL` is already OpenRouter, so image generation reuses the
 * transport and the credential that chat is running on.
 *
 * The distinguishing feature is that the request is a *conversation*, so input
 * images ride along as ordinary message content — which is what makes "change
 * the hat to red" work. The other two shapes have no equivalent.
 */

import { bearerHeaders, postJson } from "../http";
import {
    errorFromResponse,
    joinUrl,
    parseDataUrl,
    ImageGenerationError,
    type GeneratedImage,
    type ImageBackend,
    type ImageEndpointConfig,
    type ImageGenerationRequest,
    type ImageGenerationResult,
    type ImageWarning,
} from "../types";

/**
 * The response carries images in one of two places depending on how faithfully
 * the gateway follows OpenRouter's shape: an `images` array on the message, or
 * image parts inside `content`. Both are read, because a gateway that changes
 * between them on a Tuesday should not page anyone.
 */
interface ChatCompletionsResponse {
    choices?: Array<{
        message?: {
            images?: Array<{ image_url?: { url?: string } | string; type?: string }>;
            content?: string | Array<{ type?: string; image_url?: { url?: string } | string }>;
        };
    }>;
}

function collectImages(body: ChatCompletionsResponse): GeneratedImage[] {
    const out: GeneratedImage[] = [];

    const pushFromUrlLike = (value: { url?: string } | string | undefined) => {
        const url = typeof value === "string" ? value : value?.url;
        if (!url) return;
        const parsed = parseDataUrl(url);
        // A gateway that hands back an https URL instead of a data URL is not
        // an error, but it is not bytes either, and this layer's contract is
        // bytes. Skipping it produces the "no images" error below, which names
        // the real problem, rather than a confusing base64 decode failure.
        if (parsed) out.push(parsed);
    };

    for (const choice of body.choices ?? []) {
        for (const image of choice.message?.images ?? []) {
            pushFromUrlLike(image.image_url);
        }
        const content = choice.message?.content;
        if (Array.isArray(content)) {
            for (const part of content) {
                if (part.type === "image_url" || part.type === "image") {
                    pushFromUrlLike(part.image_url);
                }
            }
        }
    }

    return out;
}

export const chatCompletionsBackend: ImageBackend = {
    shape: "chat-completions",

    async generate(
        request: ImageGenerationRequest,
        endpoint: ImageEndpointConfig,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const warnings: ImageWarning[] = [];
        const count = request.count ?? 1;

        // One conversation turn. Input images precede the instruction so the
        // model reads "here is the picture, now do this to it".
        const parts: Array<Record<string, unknown>> = [];
        for (const image of request.inputImages ?? []) {
            parts.push({
                type: "image_url",
                image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
            });
        }
        parts.push({ type: "text", text: request.prompt });

        const body: Record<string, unknown> = {
            model: request.modelId,
            modalities: ["image", "text"],
            messages: [{ role: "user", content: parts }],
        };

        if (request.aspectRatio) {
            // Gemini image models read this; gateways that do not understand it
            // ignore an unknown object rather than rejecting the request.
            body.image_config = { aspect_ratio: request.aspectRatio };
        }

        if (count > 1) {
            // `n` is not honoured for image output on this path. Say so rather
            // than returning one image and letting the caller wonder.
            warnings.push({
                type: "count-reduced",
                message: `The chat-completions image path returns one image per call; asked for ${count}, returning 1. Call again for more.`,
            });
        }

        Object.assign(body, request.providerOptions ?? {});

        const response = await postJson(
            joinUrl(endpoint.baseUrl, "chat/completions"),
            body,
            endpoint,
            bearerHeaders(endpoint),
            signal
        );

        if (!response.ok) throw await errorFromResponse(response, "chat-completions");

        const parsed = (await response.json()) as ChatCompletionsResponse;
        const images = collectImages(parsed);

        if (images.length === 0) {
            // The overwhelmingly common cause is a text-only model id. Naming
            // the model turns a mystery into a one-line fix.
            throw new ImageGenerationError({
                code: "no_image_returned",
                message: `Model "${request.modelId}" returned no image. Check that it supports image output — a text-only model answers this request with prose.`,
                status: 502,
                retryable: false,
            });
        }

        return { images, warnings, shape: "chat-completions", modelId: request.modelId };
    },
};
