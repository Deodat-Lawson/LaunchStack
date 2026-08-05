/**
 * Whether the deployment has enough configuration to talk to a chat endpoint.
 *
 * Used by health checks and setup surfaces to say "chat is not configured"
 * without constructing a model. This is a *presence* check, not a validation:
 * whether the configured models are coherent is decided when the chat model
 * configuration file is parsed.
 */

export interface AiCredentialEnvironment {
  CHAT_BASE_URL?: string;
  /** @deprecated Pre-PR name for CHAT_BASE_URL. */
  AI_BASE_URL?: string;
  /** Pre-PR OpenAI credential accepted as a one-release deployment fallback. */
  OPENAI_API_KEY?: string;
  /**
   * Declared because real environments carry these, but not treated as chat
   * endpoint sources.
   */
  OPENROUTER_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
}

function configured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Deprecated variables that still resolve to an endpoint this release.
 * Reported so setup surfaces can nudge operators onto CHAT_BASE_URL.
 */
export function getDeprecatedChatEndpointSources(
  environment: AiCredentialEnvironment,
): string[] {
  return [
    configured(environment.AI_BASE_URL) ? "AI_BASE_URL" : undefined,
    configured(environment.OPENAI_API_KEY) ? "OPENAI_API_KEY" : undefined,
  ].filter((source): source is string => Boolean(source));
}

/** Whether a chat endpoint is configured, by any supported variable. */
export function hasConfiguredAiCredential(
  environment: AiCredentialEnvironment,
): boolean {
  return (
    configured(environment.CHAT_BASE_URL) ||
    getDeprecatedChatEndpointSources(environment).length > 0
  );
}
