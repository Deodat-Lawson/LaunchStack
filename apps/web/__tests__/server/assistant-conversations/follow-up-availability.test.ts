/**
 * Whether a saved conversation can get its follow-up note depends on the
 * model that would write it: the workspace's own, when it brought one, not
 * the server's.
 */

import type * as Llm from "@launchstack/llm";

jest.mock("~/env", () => ({ env: { server: {} } }));
jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
    resolveConfiguredChatRoute: (route: "default" | "fast") =>
        jest.requireActual<typeof Llm>("@launchstack/llm").resolveChatRoute(route),
}));

import {
    configureChatModels,
    createChatModelsConfig,
    resetChatModelsConfig,
    runWithChatModelsScope,
} from "@launchstack/llm";

import { followUpModelUnavailable } from "~/server/assistant-conversations/follow-up-model";

const BEHAVIOR = `
      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`;

function config(baseUrl: string, owner?: "workspace") {
    return createChatModelsConfig({
        yaml: `
version: 1
models:
  primary:
    id: m
    behavior:${BEHAVIOR}
routes:
  default: primary
`,
        endpoint: { baseUrl, apiKey: "k", ...(owner ? { owner } : {}) },
    });
}

beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    // The server names no endpoint and has no Google key: its own chat can't answer.
    configureChatModels(config("https://generativelanguage.googleapis.com/v1beta/openai"));
});
afterEach(() => {
    resetChatModelsConfig();
    jest.restoreAllMocks();
});

describe("followUpModelUnavailable", () => {
    it("says so when only the server's unconfigured default would answer", () => {
        expect(followUpModelUnavailable()).toMatch(/No chat model is configured/);
    });

    it("is available for a workspace on its own model, whatever the server has", () => {
        const answer = runWithChatModelsScope(
            { source: "workspace", config: config("https://models.example.com/v1", "workspace") },
            () => followUpModelUnavailable()
        );
        expect(answer).toBeNull();
    });
});
