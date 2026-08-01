export interface AiCredentialEnvironment {
  AI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

/** Return whether the server has at least one configured AI credential. */
export function hasConfiguredAiCredential(
  environment: AiCredentialEnvironment,
): boolean {
  return [
    environment.AI_API_KEY,
    environment.OPENAI_API_KEY,
    environment.OPENROUTER_API_KEY,
  ].some(
    (credential) =>
      typeof credential === "string" && credential.trim().length > 0,
  );
}
