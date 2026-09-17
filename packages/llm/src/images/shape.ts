/**
 * Which wire shape does this base URL speak?
 *
 * This is the module that makes "switch the URL and it still works" true. An
 * operator who moves `IMAGE_API_BASE_URL` from OpenRouter to Gemini changes one
 * line of `.env`; nothing here needs a code change, and no caller learns which
 * vendor answered.
 *
 * Inference is deliberately conservative. A host we recognise gets its known
 * shape; everything else falls back to `openai-compatible`, which is the de
 * facto standard that gateways implement when they implement anything. An
 * operator whose gateway breaks that assumption sets `shape` explicitly rather
 * than us guessing harder — a wrong guess produces a confusing 404, while an
 * explicit override is self-documenting.
 */

import type { ImageApiShape } from "./types";

/**
 * Google's Generative Language API serves BOTH shapes, split by path: the
 * OpenAI-compatibility layer lives under `/openai` and speaks
 * `/images/generations`, while the bare host speaks `:generateContent`. So the
 * hostname alone cannot decide this one — the path has to be read.
 */
const GOOGLE_GENAI_HOST = "generativelanguage.googleapis.com";

/**
 * OpenRouter's own image API (`POST /images`), which its AI SDK provider
 * speaks. Only OpenRouter serves it — an aggregator that merely proxies
 * OpenAI-shaped routes is not this shape and falls through to the default.
 */
const OPENROUTER_HOSTS = ["openrouter.ai"];

export interface ShapeResolution {
    shape: ImageApiShape;
    /** True when an operator named it, false when we inferred it. Worth logging. */
    explicit: boolean;
    /** Why we chose this — surfaced in the boot report and in errors. */
    reason: string;
}

export function resolveImageApiShape(baseUrl: string, override?: ImageApiShape): ShapeResolution {
    if (override) {
        return { shape: override, explicit: true, reason: "declared by configuration" };
    }

    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        // An unparseable URL will fail at request time with a clearer message
        // than anything we could invent here. Assume the common shape.
        return {
            shape: "openai-compatible",
            explicit: false,
            reason: "base URL could not be parsed; assumed the OpenAI-compatible default",
        };
    }

    const host = url.hostname.toLowerCase();

    if (OPENROUTER_HOSTS.some(known => host === known || host.endsWith(`.${known}`))) {
        return {
            shape: "openrouter",
            explicit: false,
            reason: `${host} serves OpenRouter's own /images API`,
        };
    }

    if (host === GOOGLE_GENAI_HOST) {
        // `/v1beta/openai` → compatibility layer; anything else → native.
        const isCompatibilityPath = /\/openai\/?$/.test(url.pathname);
        return isCompatibilityPath
            ? {
                  shape: "openai-compatible",
                  explicit: false,
                  reason: "Google's OpenAI-compatibility layer serves /images/generations",
              }
            : {
                  shape: "google-native",
                  explicit: false,
                  reason: "Google's native API returns images as inlineData parts",
              };
    }

    return {
        shape: "openai-compatible",
        explicit: false,
        reason: "unrecognised host; assumed the OpenAI-compatible default",
    };
}
