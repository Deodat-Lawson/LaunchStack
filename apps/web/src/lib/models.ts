/**
 * App-side entry point for chat model resolution.
 *
 * Everything here does one extra thing over the core resolver: install this
 * deployment's configuration first. Serverless invocations cannot assume
 * getEngine() ran, so each route helper wires the config itself — the parsed
 * file is cached, so the repeat cost is a map lookup.
 *
 * Resolution is cheap and throws a typed 400. Call it *before* retrieval, web
 * search, or embeddings, so an unavailable route fails before the deployment
 * pays for work it is about to throw away.
 */
import {
    getPublicChatConfig,
    isChatRequestError,
    isChatScopeUnavailableError,
    resolveChatModel,
    resolveChatRoute,
    selectChatRoute,
    type PublicChatConfig,
    type ResolveChatModelOptions,
    type ResolvedChatModel,
} from "@launchstack/llm";
import { createEmbeddingModel } from "@launchstack/llm/embeddings";
import { resolveEmbeddingIndex } from "@launchstack/llm/embeddings";
import type { CompanyEmbeddingConfig } from "@launchstack/llm/embeddings";
import type { EmbeddingsProvider } from "@launchstack/retrieval/search-types";
import type { Locale } from "~/i18n/locales";
import { translatorFor, wordEnglish } from "~/i18n/translate";
import { configureAppChatModels } from "~/server/chat-models";
import { wordModels } from "~/server/workspace-models/words";
import { env } from "~/env";

export { selectChatRoute };

/** Resolve a route to a ready-to-invoke model for this deployment. */
export function resolveConfiguredChatModel(
    options: ResolveChatModelOptions = {}
): ResolvedChatModel {
    configureAppChatModels(env.server);
    return resolveChatModel(options);
}

/**
 * Turn a resolution failure into a status and a message.
 *
 * Resolution throws two different things and they mean opposite things to the
 * caller. `ChatRequestError` says *this request* asked for something the
 * configured models cannot do — a 400 the caller can act on. Anything else
 * (`ChatConfigurationError`, an unreadable file) says the deployment is
 * misconfigured — a 500 the operator must act on. A handler that lets both
 * fall through to a generic catch reports an unavailable route as a server
 * fault, which sends whoever is debugging it to the wrong place entirely.
 */
export function describeChatResolutionFailure(
    error: unknown,
    locale: Locale = "en"
): {
    status: number;
    message: string;
} {
    // A request error's message was written for the caller and never names a
    // model. A configuration error quotes the file path, model ids and preset
    // names, so it goes to the server log and the caller gets a fixed message.
    // The package writes English; `errors.chatModels` has the reader's words.
    if (isChatRequestError(error)) {
        return {
            status: error.status,
            message: wordEnglish(error.message, "errors.chatModels", locale),
        };
    }
    // A workspace's own endpoint that can't be used: its message is written for
    // the workspace's admins and names no model, so it is shown as is.
    // Its reason is one of the workspace-model checks' sentences.
    if (isChatScopeUnavailableError(error)) {
        const message = wordEnglish(error.message, "errors.chatModels", locale, reason =>
            wordModels(reason, locale)
        );
        return { status: error.status, message };
    }
    console.error("[chat] chat model configuration cannot serve this request:", error);
    return {
        status: 500,
        message: translatorFor(locale, "errors.api")("chatModelsMisconfigured"),
    };
}

/**
 * Which model serves a route, without constructing a client. Use when a
 * caller only needs the effective model id — reporting it back in a response,
 * for instance.
 */
export function resolveConfiguredChatRoute(
    route: Parameters<typeof resolveChatRoute>[0] = "default"
) {
    configureAppChatModels(env.server);
    return resolveChatRoute(route);
}

/** Sanitized route information for the browser. Never includes secrets. */
export function getConfiguredPublicChatConfig(): PublicChatConfig {
    configureAppChatModels(env.server);
    return getPublicChatConfig();
}

export function getEmbeddings(
    indexKey?: string,
    config?: CompanyEmbeddingConfig
): EmbeddingsProvider {
    return createEmbeddingModel(resolveEmbeddingIndex(indexKey, config), config);
}
