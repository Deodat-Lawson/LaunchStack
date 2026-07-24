import {
  configureChatModels,
  describeProviderError,
  getChatModelForProvider,
  inferProviderFromModel,
  supportsThinking,
  supportsVision,
} from "@launchstack/core/llm";

describe("OpenRouter chat-model configuration", () => {
  beforeEach(() => {
    configureChatModels({});
  });

  it("maps Kimi K3 to OpenRouter with its supported capabilities", () => {
    expect(inferProviderFromModel("moonshotai/kimi-k3")).toBe("openrouter");
    expect(supportsThinking("moonshotai/kimi-k3")).toBe(true);
    expect(supportsVision("moonshotai/kimi-k3")).toBe(true);
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
