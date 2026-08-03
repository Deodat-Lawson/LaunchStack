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
  resolveChatModel,
  resolveChatRoute,
  selectChatRoute,
  type PublicChatConfig,
  type ResolveChatModelOptions,
  type ResolvedChatModel,
} from "@launchstack/core/llm";
import { createEmbeddingModel } from "@launchstack/core/embeddings";
import { resolveEmbeddingIndex } from "@launchstack/core/embeddings";
import type { CompanyEmbeddingConfig } from "@launchstack/core/embeddings";
import type { EmbeddingsProvider } from "~/lib/tools/rag/types";
import { configureAppChatModels } from "~/server/chat-models";
import { env } from "~/env";

export { selectChatRoute };

/** Resolve a route to a ready-to-invoke model for this deployment. */
export function resolveConfiguredChatModel(
  options: ResolveChatModelOptions = {},
): ResolvedChatModel {
  configureAppChatModels(env.server);
  return resolveChatModel(options);
}

/**
 * Which model serves a route, without constructing a client. Use when a
 * caller only needs the effective model id — reporting it back in a response,
 * for instance.
 */
export function resolveConfiguredChatRoute(
  route: Parameters<typeof resolveChatRoute>[0] = "default",
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
  config?: CompanyEmbeddingConfig,
): EmbeddingsProvider {
  return createEmbeddingModel(resolveEmbeddingIndex(indexKey, config), config);
}
