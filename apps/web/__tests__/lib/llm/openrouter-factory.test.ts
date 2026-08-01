import {
  configureChatModels,
  describeProviderError,
  getChatModelForProvider,
  getProviderDefaultModel,
  inferProviderFromModel,
  supportsThinking,
  supportsVision,
} from "@launchstack/core/llm";
import { QuestionSchema } from "~/lib/validation";
import { hasConfiguredAiCredential } from "~/server/ai-credentials";
import { configureAppChatModels } from "~/server/chat-models";

describe("OpenRouter chat-model configuration", () => {
  beforeEach(() => {
    configureChatModels({});
  });

  it("maps Kimi K3 to OpenRouter with its supported capabilities", () => {
    expect(inferProviderFromModel("moonshotai/kimi-k3")).toBe("openrouter");
    expect(supportsThinking("moonshotai/kimi-k3")).toBe(true);
    expect(supportsVision("moonshotai/kimi-k3")).toBe(true);
  });

  it("configures direct model calls before the app engine initializes", () => {
    configureAppChatModels({
      OPENROUTER_API_KEY: "sk-or-v1-test-credential",
    });

    expect(() =>
      getChatModelForProvider({ provider: "openrouter" }),
    ).not.toThrow();
  });

  it("honors arbitrary configured OpenRouter model IDs", () => {
    configureAppChatModels({
      OPENROUTER_API_KEY: "sk-or-v1-test-credential",
      OPENROUTER_MODEL: "anthropic/claude-sonnet-4",
    });

    expect(getProviderDefaultModel("openrouter")).toBe(
      "anthropic/claude-sonnet-4",
    );
    expect(() =>
      getChatModelForProvider({ provider: "openrouter" }),
    ).not.toThrow();
  });

  it("defaults omitted workspace providers to OpenRouter", () => {
    expect(QuestionSchema.parse({ question: "Summarize this" }).provider).toBe(
      "openrouter",
    );
  });

  it("accepts an OpenRouter-only server configuration", () => {
    expect(
      hasConfiguredAiCredential({
        OPENROUTER_API_KEY: "sk-or-v1-test-credential",
      }),
    ).toBe(true);
  });

  it("rejects a server configuration without an AI credential", () => {
    expect(hasConfiguredAiCredential({})).toBe(false);
  });

  it("fails closed instead of falling back to OPENAI_API_KEY", () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "must-not-be-forwarded";

    try {
      expect(() =>
        getChatModelForProvider({
          provider: "openrouter",
          model: "moonshotai/kimi-k3",
        }),
      ).toThrow("OPENROUTER_API_KEY is not set");
    } finally {
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  });

  it("turns missing OpenRouter configuration into a safe 401 response", () => {
    expect(
      describeProviderError(
        "openrouter",
        new Error("OPENROUTER_API_KEY is not set"),
        "moonshotai/kimi-k3",
      ),
    ).toEqual({
      status: 401,
      message:
        "Invalid or missing OPENROUTER_API_KEY. Please check your API key configuration.",
    });
  });
});
