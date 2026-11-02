/**
 * The single OpenAI-compatible chat transport.
 *
 * Every route in the deployment reaches its model through here, which is why
 * this is the only module allowed to import a provider SDK. "Any endpoint"
 * means any server implementing the OpenAI `/chat/completions` protocol — not
 * an arbitrary HTTP API.
 *
 * The request body is assembled from the model's declared behavior alone.
 * Fields the model marks unsupported are omitted entirely rather than sent
 * with a neutral value: endpoints commonly reject the presence of a field,
 * not just a bad value for it.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import OpenAI from "openai";
import { createEndpointFetch } from "./endpoint-fetch";
import type { UsageMeterContext } from "./usage-meter";
import {
    DEFAULT_MAX_OUTPUT_TOKENS_FIELD,
    type ChatEndpointConfig,
    type ChatModelBehavior,
    type ChatRequestPatch,
} from "./types";

/**
 * Sent when the endpoint needs no credential. An explicit placeholder stops
 * the OpenAI SDK from quietly falling back to `OPENAI_API_KEY` in the
 * process environment and pointing someone else's key at this endpoint.
 */
export const KEYLESS_PLACEHOLDER_API_KEY = "launchstack-no-key";

const DEFAULT_TIMEOUT_MS = 600_000;
const WORKSPACE_ENDPOINT_MAX_RETRIES = 2;

export interface CreateCompatibleChatOptions {
    endpoint: ChatEndpointConfig;
    modelId: string;
    behavior: ChatModelBehavior;
    /** Applied only when the model declares temperature support. */
    temperature?: number;
    /** Applied only when the model declares an output-token cap. */
    maxOutputTokens?: number;
    /** Applied only when the model declares streaming support. */
    streaming?: boolean;
    timeoutMs?: number;
    /**
     * Retries after a failed attempt. Defaults to the client's own (six, with
     * backoff) for the deployment's endpoint and to two for a workspace's:
     * an address a workspace typed that refuses connections should say so in
     * seconds, not after a minute and a half of backoff.
     */
    maxRetries?: number;
    /** Operator-declared reasoning fields, already resolved for this request. */
    requestPatch?: ChatRequestPatch;
    /** Route, price and recorder for the usage report; the model id is added here. */
    usage?: Omit<UsageMeterContext, "modelId">;
}

/**
 * Extra body fields for this request: the resolved reasoning patch plus the
 * output-token cap when it needs a non-default field name.
 */
export function buildModelKwargs(
    options: Pick<CreateCompatibleChatOptions, "behavior" | "maxOutputTokens" | "requestPatch">
): Record<string, unknown> {
    const { behavior, maxOutputTokens, requestPatch } = options;
    const kwargs: Record<string, unknown> = { ...(requestPatch ?? {}) };

    const field = behavior.parameters.maxOutputTokensField ?? DEFAULT_MAX_OUTPUT_TOKENS_FIELD;
    if (
        behavior.parameters.maxOutputTokens === "supported" &&
        typeof maxOutputTokens === "number" &&
        field !== DEFAULT_MAX_OUTPUT_TOKENS_FIELD
    ) {
        kwargs[field] = maxOutputTokens;
    }
    return kwargs;
}

/**
 * A workspace's own endpoint is an address a workspace admin typed, checked
 * against the deployment's address policy when it was saved. Following a
 * redirect would let that address hand the request — prompt and credential —
 * to somewhere the check never saw. Chat-completions servers do not redirect,
 * so refusing to is free.
 */
const fetchWithoutRedirects: typeof fetch = (input, init) =>
    fetch(input, { ...init, redirect: "error" });

/**
 * Instructions in, provider error text out, usage counted (see
 * endpoint-fetch.ts); no redirects for a workspace's address.
 */
function endpointFetch(
    endpoint: ChatEndpointConfig,
    behavior: ChatModelBehavior,
    meter?: UsageMeterContext
) {
    return createEndpointFetch(
        endpoint,
        behavior,
        endpoint.owner === "workspace" ? fetchWithoutRedirects : undefined,
        meter
    );
}

function retriesFor(endpoint: ChatEndpointConfig, maxRetries: number | undefined) {
    if (maxRetries !== undefined) return { maxRetries };
    return endpoint.owner === "workspace" ? { maxRetries: WORKSPACE_ENDPOINT_MAX_RETRIES } : {};
}

export function createOpenAiCompatibleChat(options: CreateCompatibleChatOptions): BaseChatModel {
    const { endpoint, modelId, behavior } = options;
    const { parameters } = behavior;

    const acceptsCap = parameters.maxOutputTokens === "supported";
    const capField = parameters.maxOutputTokensField ?? DEFAULT_MAX_OUTPUT_TOKENS_FIELD;
    const usesDefaultCapField = capField === DEFAULT_MAX_OUTPUT_TOKENS_FIELD;
    const modelKwargs = buildModelKwargs(options);

    return new ChatOpenAI({
        apiKey: endpoint.apiKey ?? KEYLESS_PLACEHOLDER_API_KEY,
        modelName: modelId,
        configuration: {
            baseURL: endpoint.baseUrl,
            fetch: endpointFetch(endpoint, behavior, { ...options.usage, modelId }),
        },
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...retriesFor(endpoint, options.maxRetries),
        ...(parameters.temperature === "supported" && typeof options.temperature === "number"
            ? { temperature: options.temperature }
            : {}),
        ...(acceptsCap && usesDefaultCapField && typeof options.maxOutputTokens === "number"
            ? { maxTokens: options.maxOutputTokens }
            : {}),
        ...(parameters.streaming === "supported" && options.streaming !== undefined
            ? { streaming: options.streaming }
            : {}),
        // This adapter otherwise discards OpenAI-compatible reasoning_content
        // deltas. The chat route extracts only those strings, then removes the
        // raw response before accumulating chunks or sending browser events.
        ...(parameters.streaming === "supported" && options.streaming === true
            ? { __includeRawResponse: true }
            : {}),
        ...(Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}),
    });
}

/**
 * A plain OpenAI SDK client for the same endpoint, under the same rules as
 * {@link createOpenAiCompatibleChat}: the keyless placeholder, the endpoint's
 * instructions and error scrubbing, no redirects and fewer retries for a
 * workspace's address. For callers that build the request body themselves
 * (document ingestion's table summaries, image descriptions and entity
 * extraction); they must still send only the fields the model declares.
 */
export function createOpenAiCompatibleClient(options: {
    endpoint: ChatEndpointConfig;
    behavior: ChatModelBehavior;
    timeoutMs?: number;
    maxRetries?: number;
    /** Route, model and price for the usage report. */
    usage?: UsageMeterContext;
}): OpenAI {
    const { endpoint, behavior } = options;
    return new OpenAI({
        apiKey: endpoint.apiKey ?? KEYLESS_PLACEHOLDER_API_KEY,
        baseURL: endpoint.baseUrl,
        fetch: endpointFetch(endpoint, behavior, options.usage),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...retriesFor(endpoint, options.maxRetries),
    });
}

/**
 * Translate transport failures into operator-actionable messages. Kept here
 * because the wording depends on how this transport authenticates.
 *
 * The message is shown to whoever asked, so it names configuration variables
 * but never the endpoint host or the model id; those go to the server log.
 */
export function describeChatEndpointError(
    error: unknown,
    endpoint: ChatEndpointConfig,
    modelId: string
): { status: number; message: string } | null {
    if (!(error instanceof Error)) return null;
    const message = error.message.toLowerCase();
    const where = `${endpoint.baseUrl} (model ${modelId})`;
    // The SDK's status when it has one; otherwise a status code standing alone
    // in the text, so a token count like "140291" is not read as a 402.
    const sdkStatus = (error as { status?: unknown }).status;
    const status =
        typeof sdkStatus === "number"
            ? sdkStatus
            : Number(/(?:^|\s)([45]\d\d)(?=\s|$|:)/.exec(message)?.[1] ?? NaN);
    // A workspace's own endpoint is fixed by its admins in the Workspace tab, not by
    // whoever runs the server, so its failures say so.
    const ownedByWorkspace = endpoint.owner === "workspace";
    const fixInSettings = "A workspace admin can fix it in Workspace › Bring your own keys.";

    if (
        status === 402 ||
        message.includes("insufficient credits") ||
        message.includes("insufficient_quota") ||
        message.includes("exceeded your current quota") ||
        message.includes("payment required")
    ) {
        console.error(`[chat] ${where} refused for billing: ${error.message}`);
        return {
            status: 503,
            message: ownedByWorkspace
                ? `Your workspace's AI provider account has run out of credit or quota. ${fixInSettings}`
                : "The AI service has reached its usage limit and can't answer right now. An administrator needs to restore it.",
        };
    }

    if (status === 429 || message.includes("rate limit")) {
        console.warn(`[chat] ${where} rate-limited: ${error.message}`);
        return {
            status: 429,
            message: ownedByWorkspace
                ? "Your workspace's AI provider is rate-limiting requests. Try again in a moment."
                : "The AI service is busy right now. Try again in a moment.",
        };
    }

    if (
        status === 401 ||
        status === 403 ||
        message.includes("authentication") ||
        message.includes("invalid api key") ||
        message.includes("no auth credentials") ||
        message.includes("unauthorized")
    ) {
        if (ownedByWorkspace) {
            return {
                status: 401,
                message: endpoint.apiKey
                    ? `Your workspace's AI provider rejected its API key. ${fixInSettings}`
                    : `Your workspace's AI provider needs an API key. ${fixInSettings}`,
            };
        }
        return {
            status: 401,
            message: endpoint.apiKey
                ? "The chat endpoint rejected CHAT_API_KEY. Check the credential configured for CHAT_BASE_URL."
                : "The chat endpoint requires a credential. Set CHAT_API_KEY for CHAT_BASE_URL.",
        };
    }

    if (
        // The OpenAI SDK's APIConnectionError says only "Connection error.";
        // APIConnectionTimeoutError says "Request timed out."
        message.includes("connection error") ||
        message.includes("request timed out") ||
        message.includes("fetch failed") ||
        message.includes("econnrefused") ||
        message.includes("enotfound") ||
        message.includes("socket hang up") ||
        message.includes("timeout")
    ) {
        console.error(`[chat] could not reach ${where}: ${error.message}`);
        return {
            status: 502,
            message: ownedByWorkspace
                ? `Couldn't reach your workspace's AI provider. ${fixInSettings}`
                : "Unable to reach the chat endpoint. Confirm the server is running and CHAT_BASE_URL is correct.",
        };
    }

    if (
        message.includes("model_not_found") ||
        message.includes("does not exist") ||
        message.includes("unknown model") ||
        message.includes("no such model")
    ) {
        console.error(`[chat] ${where} does not serve the model: ${error.message}`);
        return {
            status: 400,
            message: ownedByWorkspace
                ? `Your workspace's AI provider doesn't serve the chosen model. ${fixInSettings}`
                : "The chat endpoint does not serve the configured model. Update the model id in the chat model configuration.",
        };
    }

    return null;
}
