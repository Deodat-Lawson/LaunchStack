/**
 * Reading and validating the chat model configuration file.
 *
 * Endpoint resolution lives in `./chat-endpoint`, which is a leaf so that
 * `env.ts` can import it without dragging the LLM stack into every module.
 * This file is the heavier half: it touches the filesystem and the
 * `@launchstack/core/llm` barrel, so only code that actually resolves a model
 * should import it.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  ChatConfigurationError,
  buildChatModelsConfig,
  configureChatModels,
  parseChatModelsYaml,
  type ChatModelsConfig,
} from "@launchstack/core/llm";
import {
  DEFAULT_CHAT_CONFIG_PATH,
  findIgnoredModelVariables,
  resolveChatEndpoint,
  trimmed,
  type AppChatModelEnvironment,
} from "./chat-endpoint";

export {
  findIgnoredModelVariables,
  resolveChatEndpoint,
  translateLegacyEndpoint,
  type AppChatModelEnvironment,
} from "./chat-endpoint";

/** Absolute path of the configuration file this deployment should read. */
export function resolveChatModelsConfigPath(
  server: AppChatModelEnvironment,
  cwd: string,
): string {
  const configured = trimmed(server.CHAT_MODELS_CONFIG);
  const relative = configured ?? DEFAULT_CHAT_CONFIG_PATH;
  return isAbsolute(relative) ? relative : join(cwd, relative);
}

function readConfigFile(path: string, configured: boolean): string {
  if (!existsSync(path)) {
    throw new ChatConfigurationError(
      configured
        ? `CHAT_MODELS_CONFIG points at "${path}", which does not exist.`
        : `No chat model configuration found at "${path}". Create it, or set CHAT_MODELS_CONFIG to another file. ` +
          `Relative paths resolve against the working directory, so run app scripts from apps/web (or set CHAT_MODELS_CONFIG to an absolute path).`,
    );
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ChatConfigurationError(
      `Unable to read the chat model configuration at "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

let warnedAboutIgnoredVariables = false;

function warnAboutIgnoredModelVariables(
  environment: Record<string, string | undefined>,
  configPath: string,
): void {
  if (warnedAboutIgnoredVariables) return;
  const ignored = findIgnoredModelVariables(environment);
  if (ignored.length === 0) return;
  warnedAboutIgnoredVariables = true;
  console.warn(
    `[chat] ${ignored.join(", ")} ${ignored.length === 1 ? "is" : "are"} no longer read. ` +
      `Model ids and per-model behavior now live in ${configPath}; ` +
      `see docs/chat-models.md. Remove ${ignored.length === 1 ? "it" : "them"} to silence this warning.`,
  );
}

/**
 * Read, validate, and cache the deployment's chat configuration.
 *
 * Cached per (path, endpoint): serverless invocations re-enter this on every
 * cold start, and re-parsing YAML for each one buys nothing.
 */
let cached: { key: string; config: ChatModelsConfig } | undefined;

export function getAppChatModelsConfig(
  server: AppChatModelEnvironment,
  cwd: string = process.cwd(),
): ChatModelsConfig {
  const endpoint = resolveChatEndpoint(server);
  const path = resolveChatModelsConfigPath(server, cwd);
  const key = `${path}::${endpoint.baseUrl}::${endpoint.apiKey ?? ""}`;
  if (cached?.key === key) return cached.config;

  warnAboutIgnoredModelVariables(
    server as Record<string, string | undefined>,
    path,
  );
  const text = readConfigFile(path, Boolean(trimmed(server.CHAT_MODELS_CONFIG)));
  const config = buildChatModelsConfig({
    file: parseChatModelsYaml(text, path),
    endpoint,
    sourceLabel: path,
  });
  cached = { key, config };
  return config;
}

/**
 * Install the chat configuration into core. Route helpers call this before
 * resolving, so a serverless invocation does not depend on getEngine() having
 * run first.
 */
export function configureAppChatModels(
  server: AppChatModelEnvironment,
  cwd?: string,
): void {
  configureChatModels(getAppChatModelsConfig(server, cwd));
}

/** Test helper — drops the parsed-configuration cache. */
export function resetAppChatModelsCache(): void {
  cached = undefined;
  warnedAboutIgnoredVariables = false;
}
