/**
 * Shared types for image generation.
 *
 * The problem this layer exists to solve: three different vendors expose image
 * generation through three incompatible HTTP shapes, and which one a
 * deployment gets is decided by a base URL in someone's `.env`. Pointing the
 * stack at OpenRouter instead of Gemini must not be a code change.
 *
 * So the *request* is expressed once, in our vocabulary, and each backend
 * translates it into the wire format its endpoint expects. Where an endpoint
 * cannot honour part of the request, it says so in `warnings` rather than
 * failing the call or — worse — silently ignoring the field. That borrows
 * directly from the Vercel AI SDK's `generateImage`, whose `warnings` array is
 * the only honest answer to "provider B has no concept of seed".
 */

/**
 * The wire shapes we know how to speak.
 *
 * - `openrouter`   OpenAI-shaped chat with `modalities: ["image","text"]`.
 *                        Images come back attached to the assistant message.
 *                        This is how OpenRouter does it, and it is the only
 *                        shape that also supports conversational editing.
 * - `openai-compatible` The classic `POST /images/generations`. OpenAI's own
 *                        endpoint and Gemini's OpenAI-compatibility layer both
 *                        speak it. One prompt in, N images out, no history.
 * - `google-native`      Google's Generative Language API `:generateContent`,
 *                        where an image arrives as an `inlineData` part.
 *                        Reached when someone points us at Google directly
 *                        rather than at its `/openai` compatibility path.
 */
export type ImageApiShape = "openrouter" | "openai-compatible" | "google-native";

export interface ImageEndpointConfig {
    /** Base URL, no trailing slash required — callers may include one. */
    baseUrl: string;
    /** Omitted for a keyless local endpoint; every hosted one needs it. */
    apiKey?: string;
    /**
     * Force a wire shape. Unset means "infer from `baseUrl`", which is the
     * path that makes swapping providers a config change (see `./shape`).
     * Set this when a gateway speaks a shape its hostname does not imply.
     */
    shape?: ImageApiShape;
    /** Per-request ceiling. Image calls are slow; this is not the chat default. */
    timeoutMs?: number;
    /** Extra headers, e.g. OpenRouter's HTTP-Referer / X-Title attribution. */
    headers?: Record<string, string>;
    /**
     * Replaces the provider's HTTP call. Tests drive every shape through this
     * without a network, and an operator can wrap calls (proxy, tracing)
     * without forking the provider.
     */
    fetch?: typeof globalThis.fetch;
}

/** An aspect ratio we accept from callers, independent of how a vendor spells it. */
export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface ImageInput {
    /** Raw base64, no `data:` prefix. */
    base64: string;
    /** e.g. "image/png". Required — vendors reject a bare blob. */
    mediaType: string;
}

export interface ImageGenerationRequest {
    prompt: string;
    /** Model id as the *endpoint* spells it, e.g. "google/gemini-2.5-flash-image". */
    modelId: string;
    /** Default 1. A backend that cannot batch loops and says so in a warning. */
    count?: number;
    aspectRatio?: ImageAspectRatio;
    /**
     * Images to edit or use as reference. Only `openrouter` and
     * `google-native` can carry these; `openai-compatible` warns and ignores.
     */
    inputImages?: ImageInput[];
    /** Escape hatch merged into the request body, after everything else. */
    providerOptions?: Record<string, unknown>;
}

export interface GeneratedImage {
    /** Raw base64, no `data:` prefix — callers persist bytes, not data URLs. */
    base64: string;
    mediaType: string;
}

/**
 * Something the caller asked for that the endpoint could not do. Not an error:
 * the call succeeded, and the caller decides whether the gap matters.
 */
export interface ImageWarning {
    type: "unsupported-option" | "count-reduced" | "provider-note";
    message: string;
}

export interface ImageGenerationResult {
    images: GeneratedImage[];
    warnings: ImageWarning[];
    /** Shape actually used — worth logging, since it may have been inferred. */
    shape: ImageApiShape;
    modelId: string;
}

/**
 * Typed failure. `retryable` is decided at the boundary where we still know
 * what the status meant, so callers never re-derive it from a message string.
 */
export class ImageGenerationError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;

    constructor(args: { code: string; message: string; status?: number; retryable?: boolean }) {
        super(args.message);
        this.name = "ImageGenerationError";
        this.code = args.code;
        this.status = args.status ?? 500;
        this.retryable = args.retryable ?? false;
    }
}

/**
 * 4xx is the caller's fault and will fail identically on retry; 408 and 429 are
 * the documented exceptions. 5xx and transport errors are worth retrying.
 * Centralised so three backends cannot disagree about it.
 */
export function isRetryableStatus(status: number): boolean {
    if (status === 408 || status === 429) return true;
    return status >= 500;
}
