/**
 * The screen never names the model behind Launchstack, or its vendor.
 *
 * Which model answers is the operator's configuration. These tests pin the
 * server-side places a name could otherwise reach a browser: the admin
 * settings payloads, the usage ledger and job results. The model introducing
 * itself is covered on the wire (chat-endpoint.test.ts) and by the endpoint
 * the app installs (below).
 */

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

import { ASSISTANT_IDENTITY_RULE } from "~/lib/ai/assistant-identity";
import { serializeExplainerJob } from "~/server/services/repo-explainer-jobs";
import { modelsOverview } from "~/server/settings/models";
import { privacyOverview } from "~/server/settings/privacy";
import { ledgerDescription } from "~/server/settings/usage";

const serverEnv = jest.requireMock<{ env: { server: Record<string, string> } }>("~/env").env.server;

describe("assistant identity rule", () => {
    it("is worded to keep both the model and its maker unnamed", () => {
        expect(ASSISTANT_IDENTITY_RULE).toMatch(/Never name or hint at the underlying AI model/);
        expect(ASSISTANT_IDENTITY_RULE).toMatch(/company that built or hosts it/);
    });
});

describe("repo explainer job results", () => {
    it("keep their provenance but not the model id", () => {
        const job = serializeExplainerJob({
            id: "j",
            workspaceId: "w",
            status: "succeeded",
            diagramType: "flowchart",
            instructions: null,
            sha: "abc",
            result: {
                summary: "s",
                mermaidCode: "graph TD",
                filesRead: [],
                path: "fast",
                turns: 1,
                provenance: {
                    sha: "abc",
                    skillVersion: "v1",
                    skillHash: "h",
                    modelId: VENDOR_ID,
                    promptVersion: "p1",
                },
            },
            errorMessage: null,
            publishedDocumentId: null,
            staleAt: null,
            createdAt: new Date(0),
            startedAt: null,
            completedAt: null,
        } as unknown as Parameters<typeof serializeExplainerJob>[0]);
        expect(JSON.stringify(job)).not.toContain(VENDOR_ID);
        expect(job.result?.provenance).toMatchObject({ sha: "abc", promptVersion: "p1" });
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

    it("Privacy calls a service on the deployment's own network local, not third-party", () => {
        Object.assign(serverEnv, {
            EMBEDDING_API_BASE_URL: "http://ollama:11434/v1",
            TRANSCRIPTION_API_BASE_URL: "http://10.0.0.7:9000/v1",
        });
        const services = privacyOverview().services;
        for (const id of ["embedding", "transcription"]) {
            const service = services.find(s => s.id === id)!;
            expect(service.host).toBeNull();
            expect(service.note).toMatch(/Runs on this deployment's own servers/);
        }
        expect(services.find(s => s.id === "chat")!.note).toMatch(/third-party AI model provider/);
    });
});
