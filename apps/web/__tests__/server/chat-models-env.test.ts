import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatConfigurationError } from "@launchstack/core/llm";
import {
  getAppChatModelsConfig,
  resetAppChatModelsCache,
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

  it("fails with an actionable message when nothing is configured", () => {
    expect(() => resolveChatEndpoint({})).toThrow(/CHAT_BASE_URL is not set/);
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
    [
      { OPENAI_API_KEY: "sk-legacy" },
      { baseUrl: "https://api.openai.com/v1", apiKey: "sk-legacy" },
    ],
  ])("translates %p to a single endpoint", (environment, expected) => {
    const translated = translateLegacyEndpoint(environment);
    expect(translated?.endpoint).toEqual(expected);
    expect(translated?.deprecation).toMatch(/deprecated/);
  });

  it("does not infer an endpoint from a bare OpenRouter credential", () => {
    expect(
      translateLegacyEndpoint({ OPENROUTER_API_KEY: "sk-or-v1-x" }),
    ).toBeUndefined();
  });

  it("no longer treats OLLAMA_BASE_URL as a chat endpoint", () => {
    // Ollama serves the same OpenAI-compatible protocol as everything else, so
    // it is configured through CHAT_BASE_URL rather than a variable of its own.
    // OLLAMA_BASE_URL still configures the Ollama *embeddings* provider.
    expect(
      translateLegacyEndpoint({ OLLAMA_BASE_URL: "http://localhost:11434" }),
    ).toBeUndefined();

    expect(() =>
      resolveChatEndpoint({ OLLAMA_BASE_URL: "http://localhost:11434" }),
    ).toThrow(/CHAT_BASE_URL is not set/);
  });

  it("lets an explicit AI endpoint override OPENAI_API_KEY", () => {
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

  it("names an unsupported bare credential when it explains the failure", () => {
    expect(() =>
      resolveChatEndpoint({ OPENROUTER_API_KEY: "sk-or-v1-x" }),
    ).toThrow(
      /OPENROUTER_API_KEY is set, but a credential no longer selects an endpoint/,
    );
  });
});

describe("credential presence checks", () => {
  it("recognizes the canonical and each deprecated variable", () => {
    expect(hasConfiguredAiCredential({})).toBe(false);
    expect(hasConfiguredAiCredential({ CHAT_BASE_URL: "  " })).toBe(false);
    expect(hasConfiguredAiCredential({ CHAT_BASE_URL: "https://x/v1" })).toBe(true);
    expect(hasConfiguredAiCredential({ AI_BASE_URL: "https://x/v1" })).toBe(true);
    expect(hasConfiguredAiCredential({ OPENAI_API_KEY: "sk-x" })).toBe(true);
  });

  it("reports only what resolveChatEndpoint would actually accept", () => {
    // Reporting true here would tell a health check chat is ready moments
    // before resolveChatEndpoint refuses to boot on the same environment.
    expect(hasConfiguredAiCredential({ OPENROUTER_API_KEY: "k" })).toBe(false);
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
