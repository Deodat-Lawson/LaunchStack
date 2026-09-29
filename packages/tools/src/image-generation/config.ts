/**
 * Endpoint resolution for image generation. The only module in this tool
 * permitted to read `process.env`.
 *
 * Resolution order, and the reasoning behind it:
 *
 *   1. `IMAGE_API_BASE_URL` + `IMAGE_API_KEY` — an operator who wants images
 *      to come from somewhere other than chat says so explicitly.
 *   2. `CHAT_BASE_URL` + `CHAT_API_KEY` — the useful default. On OpenRouter the
 *      chat endpoint *is* the image endpoint, so a deployment that configured
 *      chat has already configured images and need do nothing.
 *   3. `AI_BASE_URL` + `AI_API_KEY` — the existing global fallback, for a
 *      deployment that routes every capability at one vendor.
 *
 * Base URL and key are read as a pair at every level, matching the rule the
 * provider registry already enforces: a lone key falls through rather than
 * half-configuring a level. Forwarding one without the other is the mistake
 * this rule exists to catch.
 */

import type { ImageApiShape, ImageEndpointConfig } from "@launchstack/llm/images";

export interface ImageToolConfig {
    endpoint: ImageEndpointConfig;
    /** Model id as the resolved endpoint spells it. */
    modelId: string;
    /** Which env level answered — worth logging when an endpoint misbehaves. */
    source: "image" | "chat" | "global";
}

/**
 * Nano Banana. Chosen over Imagen because this tool exists to be called by an
 * agent that will be asked to change what it just made, and only the natively
 * multimodal line can edit. Spelled the OpenRouter way because that is the
 * default endpoint; override with IMAGE_MODEL when pointing elsewhere.
 */
export const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

export class ImageConfigError extends Error {
    readonly code = "image_not_configured";
    readonly status = 503;
}

/** Blank counts as absent: a variable set to "" is unconfigured, not configured-empty. */
function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    // `??` would be wrong here: it keeps "", and an empty variable means unset.
    if (!trimmed) return undefined;
    return trimmed;
}

function pair(baseUrl?: string, apiKey?: string): { baseUrl: string; apiKey: string } | null {
    const url = nonEmpty(baseUrl);
    const key = nonEmpty(apiKey);
    return url && key ? { baseUrl: url, apiKey: key } : null;
}

export function resolveImageToolConfig(env: NodeJS.ProcessEnv = process.env): ImageToolConfig {
    const shape = nonEmpty(env.IMAGE_API_SHAPE) as ImageApiShape | undefined;
    const modelId = nonEmpty(env.IMAGE_MODEL) ?? DEFAULT_IMAGE_MODEL;

    const levels: Array<[ImageToolConfig["source"], { baseUrl: string; apiKey: string } | null]> = [
        ["image", pair(env.IMAGE_API_BASE_URL, env.IMAGE_API_KEY)],
        ["chat", pair(env.CHAT_BASE_URL, env.CHAT_API_KEY)],
        ["global", pair(env.AI_BASE_URL, env.AI_API_KEY)],
    ];

    for (const [source, resolved] of levels) {
        if (!resolved) continue;
        return {
            source,
            modelId,
            endpoint: {
                baseUrl: resolved.baseUrl,
                apiKey: resolved.apiKey,
                shape,
                headers: attributionHeaders(env, resolved.baseUrl),
            },
        };
    }

    throw new ImageConfigError(
        "No image endpoint is configured. Set IMAGE_API_BASE_URL and IMAGE_API_KEY, or configure " +
            "CHAT_BASE_URL and CHAT_API_KEY — on an OpenRouter-style endpoint the chat credential " +
            "serves images too."
    );
}

/**
 * OpenRouter attributes requests to an app when these are present and shows it
 * on the account's activity page. Harmless elsewhere: unknown headers are
 * ignored, so this is not worth branching on beyond the host check.
 */
function attributionHeaders(
    env: NodeJS.ProcessEnv,
    baseUrl: string
): Record<string, string> | undefined {
    if (!baseUrl.includes("openrouter.ai")) return undefined;
    const referer = nonEmpty(env.APP_PUBLIC_URL) ?? nonEmpty(env.BETTER_AUTH_URL);
    if (!referer) return undefined;
    return { "HTTP-Referer": referer, "X-Title": "LaunchStack" };
}
