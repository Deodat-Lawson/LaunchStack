/**
 * Builds the AI SDK image model for a resolved wire shape.
 *
 * This is the whole of the vendor-specific code now. Each shape maps to one
 * AI SDK provider, and the provider owns the request/response translation we
 * used to hand-write: parameter names, auth header, where the bytes live in
 * the response.
 *
 *   openrouter         @openrouter/ai-sdk-provider  → POST /images
 *   openai-compatible  @ai-sdk/openai               → POST /images/generations
 *   google-native      @ai-sdk/google               → POST …:generateContent
 *
 * Note the first one. OpenRouter *documents* image generation over
 * /chat/completions with `modalities`, but its own provider (v3) targets a
 * dedicated /images endpoint instead. That was established by reading the
 * installed package rather than the docs, which is exactly why the mapping is
 * written down here — the docs and the SDK disagree.
 *
 * `baseURL` is passed through in every case, so the OpenAI provider also
 * serves any OpenAI-compatible endpoint (Google's /openai path included) and
 * the shape name names the driver, not the vendor behind it.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ImageModel } from "ai";

import type { ImageApiShape, ImageEndpointConfig } from "./types";

export function buildImageModel(
    shape: ImageApiShape,
    endpoint: ImageEndpointConfig,
    modelId: string
): ImageModel {
    const common = {
        baseURL: endpoint.baseUrl.replace(/\/+$/, ""),
        apiKey: endpoint.apiKey,
        headers: endpoint.headers,
        // Injectable so tests can drive every backend without a network, and
        // so an operator can wrap calls (proxy, tracing) without forking this.
        fetch: endpoint.fetch,
    };

    switch (shape) {
        case "openrouter":
            return createOpenRouter(common).imageModel(modelId);

        case "openai-compatible":
            return createOpenAI(common).imageModel(modelId);

        case "google-native":
            return createGoogleGenerativeAI(common).image(modelId);
    }
}
