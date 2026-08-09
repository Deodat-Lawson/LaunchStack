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
  /**
   * Declared because real environments carry them, and deliberately *not*
   * treated as endpoint sources. A bare credential names no URL, and
   * OLLAMA_BASE_URL names a provider whose OpenAI-compatible endpoint is
   * reached through CHAT_BASE_URL like any other. See
   * {@link getDeprecatedChatEndpointSources}.
   */
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
}

function configured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Deprecated variables that still resolve to an endpoint this release.
 * Reported so setup surfaces can nudge operators onto CHAT_BASE_URL.
 *
 * Only variables carrying an explicit URL qualify. A bare credential
 * (OPENROUTER_API_KEY, OPENAI_API_KEY) names no endpoint and is not forwarded
 * to the Gemini default either, so reporting it here would credit the operator
 * with configuration that has no effect on where chat goes.
 */
export function getDeprecatedChatEndpointSources(
  environment: AiCredentialEnvironment,
): string[] {
  return [
    configured(environment.AI_BASE_URL) ? "AI_BASE_URL" : undefined,
  ].filter((source): source is string => Boolean(source));
}

/**
 * Whether the operator NAMED a chat endpoint, by any supported variable.
 *
 * Not "whether chat will work" — chat always resolves now, falling back to
 * Gemini. This answers the narrower question a setup surface needs: is the
 * deployment running on a deliberate endpoint, or on the default?
 */
export function hasConfiguredAiCredential(
  environment: AiCredentialEnvironment,
): boolean {
  return (
    configured(environment.CHAT_BASE_URL) ||
    getDeprecatedChatEndpointSources(environment).length > 0
  );
}
