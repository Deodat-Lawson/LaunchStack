/**
 * Background functions must not depend on an API route having run first.
 *
 * Feature pipelines invoked from Inngest steps call core's `resolveChatModel`
 * directly, not the `~/lib/models` helpers that install the deployment's
 * configuration. Before this middleware, whether the configuration was present
 * depended on whether some earlier step in the same serverless invocation had
 * touched `getEngine()`.
 *
 * The provider registry has the same exposure — NER, reranking and
 * transcription read it, and `configureProviders` runs inside `getEngine()` —
 * so the middleware installs both.
 */

const mockConfigureAppChatModels = jest.fn();
const mockGetEngine = jest.fn();
const mockServerEnv = { CHAT_BASE_URL: "https://endpoint.test/v1" };

jest.mock("~/env", () => ({
  get env() {
    return { server: mockServerEnv };
  },
}));

jest.mock("~/server/chat-models", () => ({
  configureAppChatModels: (...args: unknown[]) =>
    mockConfigureAppChatModels(...args),
}));

jest.mock("~/server/engine", () => ({
  getEngine: () => mockGetEngine(),
}));

import {
  chatConfigMiddleware,
  resetChatConfigMiddlewareWarning,
} from "~/server/inngest/chat-config-middleware";

/** Drive the middleware the way the SDK does before executing a step. */
async function runOneStep(): Promise<void> {
  const registered = await chatConfigMiddleware.init();
  const hooks = await registered.onFunctionRun();
  await hooks.transformInput();
}

describe("Inngest chat configuration middleware", () => {
  beforeEach(() => {
    mockConfigureAppChatModels.mockReset();
    mockGetEngine.mockReset();
    resetChatConfigMiddlewareWarning();
    jest.restoreAllMocks();
  });

  it("installs the chat configuration before a function runs", async () => {
    await runOneStep();

    expect(mockConfigureAppChatModels).toHaveBeenCalledTimes(1);
    expect(mockConfigureAppChatModels).toHaveBeenCalledWith(mockServerEnv);
  });

  it("installs the provider registry too, not just chat", () => {
    // NER, reranking and transcription resolve through the provider registry,
    // which only gets populated by getEngine(). Without this a cold
    // /api/inngest invocation resolved every capability to the default
    // endpoint with a blank credential.
    return runOneStep().then(() => {
      expect(mockGetEngine).toHaveBeenCalledTimes(1);
    });
  });

  it("runs on every step, since Inngest re-enters the handler per step", async () => {
    await runOneStep();
    await runOneStep();
    await runOneStep();

    expect(mockConfigureAppChatModels).toHaveBeenCalledTimes(3);
  });

  it("does not fail jobs that never touch chat when the config is broken", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockConfigureAppChatModels.mockImplementation(() => {
      throw new Error('CHAT_MODELS_CONFIG points at "/nope.yaml"');
    });

    await expect(runOneStep()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("AI configuration unavailable"),
      expect.stringContaining("/nope.yaml"),
    );
  });

  it("warns once rather than on every step of every job", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockConfigureAppChatModels.mockImplementation(() => {
      throw new Error("broken");
    });

    await runOneStep();
    await runOneStep();
    await runOneStep();

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the Inngest client registers the middleware", () => {
  it("wires it into the client rather than leaving it declared and unused", () => {
    // A middleware nothing registers is the same bug with extra steps, and the
    // registration is a single line in a file about event schemas.
    const source = jest.requireActual<typeof import("node:fs")>(
      "node:fs",
    ).readFileSync(
      require.resolve("~/server/inngest/client"),
      "utf8",
    );

    expect(source).toContain("middleware: [chatConfigMiddleware]");
  });
});
