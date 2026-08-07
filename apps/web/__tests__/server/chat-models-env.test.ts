import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatConfigurationError } from "@launchstack/core/llm";
import { GEMINI_BASE_URL } from "@launchstack/core/llm/types";
import {
  getAppChatModelsConfig,
  resetAppChatModelsCache,
  resetChatEndpointWarnings,
  resolveChatEndpoint,
  resolveChatModelsConfigPath,
  translateLegacyEndpoint,
} from "~/server/chat-models";
import { hasConfiguredAiCredential } from "~/server/ai-credentials";

describe("chat endpoint resolution", () => {
  it("prefers CHAT_BASE_URL and CHAT_API_KEY", () => {
    expect(
      resolveChatEndpoint({
        CHAT_BASE_URL: "  https://endpoint.example/v1  ",
        CHAT_API_KEY: " key ",
        // Present but ignored — the canonical variables win outright.
        OPENROUTER_API_KEY: "sk-or-v1-legacy",
      }),
    ).toEqual({ baseUrl: "https://endpoint.example/v1", apiKey: "key" });
  });

  it("treats a blank CHAT_API_KEY as keyless", () => {
    expect(
      resolveChatEndpoint({ CHAT_BASE_URL: "http://localhost:8080/v1", CHAT_API_KEY: "  " }),
    ).toEqual({ baseUrl: "http://localhost:8080/v1", apiKey: undefined });
  });

  it("falls back to Gemini when nothing is configured", () => {
    expect(resolveChatEndpoint({})).toEqual({
      baseUrl: GEMINI_BASE_URL,
      apiKey: undefined,
    });
  });

  it("pairs the Gemini fallback with a Google credential", () => {
    expect(resolveChatEndpoint({ GOOGLE_AI_API_KEY: "AIza-x" })).toEqual({
      baseUrl: GEMINI_BASE_URL,
      apiKey: "AIza-x",
    });
    // GOOGLE_AI_API_KEY is the only accepted spelling — there is deliberately
    // no GEMINI_API_KEY alias, so it must not be picked up.
    expect(
      resolveChatEndpoint({
        GOOGLE_AI_API_KEY: "  ",
      } as Parameters<typeof resolveChatEndpoint>[0]),
    ).toEqual({ baseUrl: GEMINI_BASE_URL, apiKey: undefined });
  });

  it("prefers an explicit CHAT_BASE_URL over the Gemini fallback", () => {
    expect(
      resolveChatEndpoint({
        CHAT_BASE_URL: "https://api.minimax.io/v1",
        CHAT_API_KEY: "mm",
        GOOGLE_AI_API_KEY: "AIza-x",
      }),
    ).toEqual({ baseUrl: "https://api.minimax.io/v1", apiKey: "mm" });
  });
});

describe("one-release legacy translation", () => {
  it("returns undefined when no legacy variable is set", () => {
    expect(translateLegacyEndpoint({})).toBeUndefined();
  });

  it.each([
    [
      { AI_BASE_URL: "https://api.siliconflow.cn/v1", AI_API_KEY: "sf-key" },
      { baseUrl: "https://api.siliconflow.cn/v1", apiKey: "sf-key" },
    ],
    [
      { AI_BASE_URL: "  http://localhost:11434/v1  " },
      { baseUrl: "http://localhost:11434/v1", apiKey: undefined },
    ],
  ])("translates %p to a single endpoint", (environment, expected) => {
    const translated = translateLegacyEndpoint(environment);
    expect(translated?.endpoint).toEqual(expected);
    expect(translated?.deprecation).toMatch(/deprecated/);
  });

  it.each([
    [{ OPENROUTER_API_KEY: "sk-or-v1-x" }],
    [{ OPENAI_API_KEY: "sk-x" }],
    [{ OPENROUTER_API_KEY: "sk-or-v1-x", OPENAI_API_KEY: "sk-x" }],
  ])("refuses to infer an endpoint from the bare credential %p", (environment) => {
    // A key says who you are, not where to send the request. The only
    // built-in URL is the Gemini fallback in resolveChatEndpoint, and these
    // credentials do not reach it — see the pairing test below.
    expect(translateLegacyEndpoint(environment)).toBeUndefined();
  });

  it("no longer treats OLLAMA_BASE_URL as a chat endpoint", () => {
    // Ollama serves the same OpenAI-compatible protocol as everything else, so
    // it is configured through CHAT_BASE_URL rather than a variable of its own.
    // OLLAMA_BASE_URL still configures the Ollama *embeddings* provider.
    expect(
      translateLegacyEndpoint({ OLLAMA_BASE_URL: "http://localhost:11434" }),
    ).toBeUndefined();

    expect(
      resolveChatEndpoint({ OLLAMA_BASE_URL: "http://localhost:11434" }),
    ).toEqual({ baseUrl: GEMINI_BASE_URL, apiKey: undefined });
  });

  it("ignores OPENAI_API_KEY entirely — it is the embeddings credential", () => {
    // "Some other endpoint for chat, OpenAI-compatible for embeddings" is a
    // normal pairing, so its presence must not disturb chat resolution.
    expect(
      translateLegacyEndpoint({
        AI_BASE_URL: "https://api.siliconflow.cn/v1",
        AI_API_KEY: "sf",
        OPENAI_API_KEY: "sk-x",
      })?.endpoint,
    ).toEqual({ baseUrl: "https://api.siliconflow.cn/v1", apiKey: "sf" });
  });

  it("never forwards another vendor's credential to the Gemini fallback", () => {
    // The whole point of pairing: falling back to Google must not put an
    // `sk-…` in an Authorization header addressed to Google.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    resetChatEndpointWarnings(); // warnings dedupe per process
    try {
      expect(
        resolveChatEndpoint({ OPENAI_API_KEY: "sk-x", OPENROUTER_API_KEY: "sk-or-v1-x" }),
      ).toEqual({ baseUrl: GEMINI_BASE_URL, apiKey: undefined });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /OPENROUTER_API_KEY and OPENAI_API_KEY are set, but they belong to another service/,
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("credential presence checks", () => {
  it("recognizes the canonical and each deprecated variable", () => {
    expect(hasConfiguredAiCredential({})).toBe(false);
    expect(hasConfiguredAiCredential({ CHAT_BASE_URL: "  " })).toBe(false);
    expect(hasConfiguredAiCredential({ CHAT_BASE_URL: "https://x/v1" })).toBe(true);
    expect(hasConfiguredAiCredential({ AI_BASE_URL: "https://x/v1" })).toBe(true);
  });

  it("reports only variables that actually direct chat somewhere", () => {
    // None of these changes where chat goes — it would still fall back to
    // Gemini — so reporting true would credit configuration that has no effect.
    expect(hasConfiguredAiCredential({ OPENROUTER_API_KEY: "k" })).toBe(false);
    expect(hasConfiguredAiCredential({ OPENAI_API_KEY: "sk-x" })).toBe(false);
    expect(hasConfiguredAiCredential({ OLLAMA_BASE_URL: "http://x:11434" })).toBe(false);
  });
});

describe("configuration file loading", () => {
  const endpoint = { CHAT_BASE_URL: "https://endpoint.example/v1", CHAT_API_KEY: "k" };

  beforeEach(resetAppChatModelsCache);

  it("defaults to config/chat-models.yaml relative to the working directory", () => {
    expect(resolveChatModelsConfigPath({}, "/srv/app")).toBe(
      "/srv/app/config/chat-models.yaml",
    );
  });

  it("honours CHAT_MODELS_CONFIG, absolute or relative", () => {
    expect(
      resolveChatModelsConfigPath({ CHAT_MODELS_CONFIG: "other.yaml" }, "/srv/app"),
    ).toBe("/srv/app/other.yaml");
    expect(
      resolveChatModelsConfigPath({ CHAT_MODELS_CONFIG: "/etc/models.yaml" }, "/srv/app"),
    ).toBe("/etc/models.yaml");
  });

  it("loads and validates the shipped default configuration", () => {
    const config = getAppChatModelsConfig(endpoint, process.cwd());
    expect(config.routes.default).toBeTruthy();
    expect(config.models.get(config.routes.default)).toBeTruthy();
    expect(config.endpoint.baseUrl).toBe("https://endpoint.example/v1");
  });

  it("caches per path and endpoint", () => {
    const first = getAppChatModelsConfig(endpoint, process.cwd());
    const second = getAppChatModelsConfig(endpoint, process.cwd());
    expect(second).toBe(first);

    const other = getAppChatModelsConfig(
      { ...endpoint, CHAT_API_KEY: "different" },
      process.cwd(),
    );
    expect(other).not.toBe(first);
  });

  it("reports a missing configured file by path", () => {
    expect(() =>
      getAppChatModelsConfig(
        { ...endpoint, CHAT_MODELS_CONFIG: "does-not-exist.yaml" },
        process.cwd(),
      ),
    ).toThrow(/does not exist/);
  });

  it("propagates a validation failure from the file so startup fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-models-"));
    const path = join(dir, "broken.yaml");
    writeFileSync(
      path,
      `
version: 1
models:
  texty:
    id: text-only
    behavior:
      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
routes:
  default: texty
  vision: texty
`,
      "utf8",
    );

    expect(() =>
      getAppChatModelsConfig({ ...endpoint, CHAT_MODELS_CONFIG: path }, process.cwd()),
    ).toThrow(ChatConfigurationError);
  });
});
