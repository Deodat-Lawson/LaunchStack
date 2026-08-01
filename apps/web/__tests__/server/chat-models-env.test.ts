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
      { OPENROUTER_API_KEY: "sk-or-v1-x" },
      { baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-or-v1-x" },
    ],
    [
      { OPENAI_API_KEY: "sk-x" },
      { baseUrl: "https://api.openai.com/v1", apiKey: "sk-x" },
    ],
    [
      { OLLAMA_BASE_URL: "http://localhost:11434" },
      { baseUrl: "http://localhost:11434/v1" },
    ],
    [
      { OLLAMA_BASE_URL: "http://localhost:11434/v1/" },
      { baseUrl: "http://localhost:11434/v1" },
    ],
  ])("translates %p to a single endpoint", (environment, expected) => {
    const translated = translateLegacyEndpoint(environment);
    expect(translated?.endpoint).toEqual(expected);
    expect(translated?.deprecation).toMatch(/deprecated/);
  });

  it("never pairs one service's credential with another's URL", () => {
    const translated = translateLegacyEndpoint({ OPENROUTER_API_KEY: "sk-or-v1-x" });
    expect(translated?.endpoint.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(translated?.endpoint.apiKey).toBe("sk-or-v1-x");

    const openai = translateLegacyEndpoint({ OPENAI_API_KEY: "sk-x" });
    expect(openai?.endpoint.baseUrl).toBe("https://api.openai.com/v1");
    expect(openai?.endpoint.apiKey).toBe("sk-x");
  });

  it("refuses to guess when several chat variables describe different endpoints", () => {
    expect(() =>
      translateLegacyEndpoint({
        OPENROUTER_API_KEY: "sk-or-v1-x",
        AI_BASE_URL: "https://api.siliconflow.cn/v1",
      }),
    ).toThrow(/describe more than one endpoint/);

    expect(() =>
      translateLegacyEndpoint({
        OLLAMA_BASE_URL: "http://localhost:11434",
        AI_BASE_URL: "https://api.siliconflow.cn/v1",
      }),
    ).toThrow(/describe more than one endpoint/);
  });

  it("treats OPENAI_API_KEY as the embeddings credential, not a rival chat endpoint", () => {
    // "OpenRouter for chat, OpenAI for embeddings" is a recommended pairing.
    // Reading OPENAI_API_KEY as a competing chat endpoint would refuse to boot
    // the single most common configuration.
    expect(
      translateLegacyEndpoint({
        OPENROUTER_API_KEY: "sk-or-v1-x",
        OPENAI_API_KEY: "sk-x",
      })?.endpoint,
    ).toEqual({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-or-v1-x" });

    expect(
      translateLegacyEndpoint({
        OLLAMA_BASE_URL: "http://localhost:11434",
        OPENAI_API_KEY: "sk-x",
      })?.endpoint,
    ).toEqual({ baseUrl: "http://localhost:11434/v1" });

    expect(
      translateLegacyEndpoint({
        AI_BASE_URL: "https://api.siliconflow.cn/v1",
        AI_API_KEY: "sf",
        OPENAI_API_KEY: "sk-x",
      })?.endpoint,
    ).toEqual({ baseUrl: "https://api.siliconflow.cn/v1", apiKey: "sf" });
  });

  it("still uses OPENAI_API_KEY when it is the only signal", () => {
    expect(translateLegacyEndpoint({ OPENAI_API_KEY: "sk-x" })?.endpoint).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-x",
    });
  });

  it("leaves Ollama keyless rather than borrowing a key", () => {
    const translated = translateLegacyEndpoint({
      OLLAMA_BASE_URL: "http://localhost:11434",
    });
    expect(translated?.endpoint.apiKey).toBeUndefined();
  });
});

describe("credential presence checks", () => {
  it("recognizes the canonical and each deprecated variable", () => {
    expect(hasConfiguredAiCredential({})).toBe(false);
    expect(hasConfiguredAiCredential({ CHAT_BASE_URL: "  " })).toBe(false);
    expect(hasConfiguredAiCredential({ CHAT_BASE_URL: "https://x/v1" })).toBe(true);
    expect(hasConfiguredAiCredential({ OPENROUTER_API_KEY: "k" })).toBe(true);
    expect(hasConfiguredAiCredential({ AI_BASE_URL: "https://x/v1" })).toBe(true);
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
