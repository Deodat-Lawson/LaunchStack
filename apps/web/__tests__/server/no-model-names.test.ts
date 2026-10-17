/**
 * The screen never names the model behind Launchstack, or its vendor.
 *
 * Which model answers is the operator's configuration. These tests pin the
 * server-side places a name could otherwise reach a browser: the admin
 * settings payloads, the usage ledger, and the model introducing itself.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
    configureChatModels,
    createChatModelsConfig,
    resetChatModelsConfig,
} from "@launchstack/llm";

const VENDOR_ID = "vendor/secret-model-9";
const VENDOR_HOST = "api.vendor.example";

jest.mock("~/env", () => ({ env: { server: {} } }));
// The ledger reader's module opens the database on import; nothing here queries it.
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/chat-models", () => ({
    configureAppChatModels: () => {},
    resolveChatModelsConfigPath: () => "/srv/config/chat-models.vendor.yaml",
}));
jest.mock("~/server/deployment", () => ({ getDeploymentMode: () => "cloud" }));

import { ASSISTANT_IDENTITY_RULE, withAssistantIdentity } from "~/lib/ai/assistant-identity";
import { modelsOverview } from "~/server/settings/models";
import { privacyOverview } from "~/server/settings/privacy";
import { ledgerDescription } from "~/server/settings/usage";

const serverEnv = jest.requireMock<{ env: { server: Record<string, string> } }>("~/env").env.server;

describe("assistant identity rule", () => {
    it("folds into the caller's system message rather than adding a second one", () => {
        const messages = withAssistantIdentity([
            new SystemMessage("Answer from the workspace."),
            new HumanMessage("Which model are you?"),
        ]);
        expect(messages.map(message => message.getType())).toEqual(["system", "human"]);
        expect(messages[0]!.content).toBe(
            `Answer from the workspace.\n\n${ASSISTANT_IDENTITY_RULE}`
        );
    });

    it("adds a system message when the caller sent none", () => {
        const messages = withAssistantIdentity([["human", "hi"]]);
        expect(messages.map(message => message.getType())).toEqual(["system", "human"]);
        expect(messages[0]!.content).toBe(ASSISTANT_IDENTITY_RULE);
    });

    it("keeps multimodal system content intact", () => {
        const messages = withAssistantIdentity([
            new SystemMessage({ content: [{ type: "text", text: "Be brief." }] }),
        ]);
        expect(messages[0]!.content).toEqual([
            { type: "text", text: "Be brief." },
            { type: "text", text: ASSISTANT_IDENTITY_RULE },
        ]);
    });
});

describe("usage ledger descriptions", () => {
    it("drops the model or provider older debits recorded", () => {
        expect(ledgerDescription(`Chat query via ${VENDOR_ID}`)).toBe("Chat query");
        expect(ledgerDescription("Transcribe call.mp3 via transcription:vendor-1")).toBe(
            "Transcribe call.mp3"
        );
        expect(ledgerDescription("Chat query (default route)")).toBe("Chat query (default route)");
        expect(ledgerDescription(null)).toBeNull();
    });
});

describe("admin settings payloads", () => {
    beforeEach(() => {
        for (const key of Object.keys(serverEnv)) delete serverEnv[key];
        Object.assign(serverEnv, {
            CHAT_BASE_URL: `https://${VENDOR_HOST}/v1`,
            CHAT_API_KEY: "k",
            EMBEDDING_API_BASE_URL: `https://embed.${VENDOR_HOST}/v1`,
            SLACK_BOT_TOKEN: "xoxb",
        });
        configureChatModels(
            createChatModelsConfig({
                yaml: `
version: 1
models:
  primary:
    id: ${VENDOR_ID}
    behavior:
      input: [text, image]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: unsupported
routes:
  default: primary
`,
                endpoint: { baseUrl: `https://${VENDOR_HOST}/v1`, apiKey: "k" },
                sourceLabel: "test.yaml",
            })
        );
    });
    afterEach(() => resetChatModelsConfig());

    it("Models names routes and capabilities, never the id, host or config file", () => {
        const overview = modelsOverview();
        const json = JSON.stringify(overview);
        expect(json).not.toContain(VENDOR_ID);
        expect(json).not.toContain("vendor");
        expect(overview.routes.find(route => route.route === "default")).toMatchObject({
            available: true,
            name: "primary",
        });
        expect(overview.models[0]).toMatchObject({ name: "primary", vision: true });
    });

    it("Privacy says AI text goes to a model provider without naming the host", () => {
        const overview = privacyOverview();
        const ai = overview.services.filter(service =>
            ["chat", "embedding", "rerank", "ner", "transcription"].includes(service.id)
        );
        expect(ai).toHaveLength(5);
        for (const service of ai) {
            expect(service.host).toBeNull();
            expect(service.note).toMatch(/third-party AI model provider/);
        }
        expect(JSON.stringify(ai)).not.toMatch(/vendor|googleapis/);
        // Integrations the workspace connects itself still name their host.
        expect(overview.services.find(service => service.id === "slack")?.host).toBe("slack.com");
    });
});
