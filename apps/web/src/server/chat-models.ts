import { configureChatModels } from "@launchstack/core/llm";

export interface AppChatModelEnvironment {
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  CHAT_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  GOOGLE_AI_API_KEY?: string;
  GOOGLE_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

/**
 * Adapt the reference app's validated environment into core chat-model
 * configuration. Direct route helpers call this before constructing a model,
 * so they do not depend on getEngine() having run in the same serverless
 * invocation.
 */
export function configureAppChatModels(server: AppChatModelEnvironment): void {
  configureChatModels({
    aiBaseUrl: server.AI_BASE_URL,
    aiApiKey: server.AI_API_KEY,
    openai: server.OPENAI_API_KEY
      ? {
          apiKey: server.OPENAI_API_KEY,
          model: server.OPENAI_MODEL,
          chatModel: server.CHAT_MODEL,
        }
      : undefined,
    anthropic: server.ANTHROPIC_API_KEY
      ? {
          apiKey: server.ANTHROPIC_API_KEY,
          model: server.ANTHROPIC_MODEL,
        }
      : undefined,
    google: server.GOOGLE_AI_API_KEY
      ? {
          apiKey: server.GOOGLE_AI_API_KEY,
          model: server.GOOGLE_MODEL,
        }
      : undefined,
    ollama: server.OLLAMA_BASE_URL
      ? {
          baseUrl: server.OLLAMA_BASE_URL,
          model: server.OLLAMA_MODEL,
        }
      : undefined,
    openrouter: server.OPENROUTER_API_KEY
      ? {
          apiKey: server.OPENROUTER_API_KEY,
          model: server.OPENROUTER_MODEL,
        }
      : undefined,
  });
}
