/**
 * The AI that runs while a document is ingested — table summaries, page image
 * descriptions, entity extraction — follows the workspace's own model like
 * chat does: inside a workspace that brought one, every call goes to its
 * endpoint and none to the server's; when its model can't do the task, the
 * task is skipped rather than handed to the server.
 *
 * Both endpoints are real local HTTP servers, so a request the server's
 * client would make by any route is seen — and the first test proves the
 * server's endpoint does see traffic, so "no request" is not vacuous.
 *
 * Every one of those calls is also counted against the workspace whose
 * ingestion made it, whichever endpoint served it.
 */

const mockIsCloud = jest.fn(() => false);
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => mockIsCloud() }));

const mockRow = jest.fn();
const mockReadKey = jest.fn();
jest.mock("~/server/workspace-models/store", () => ({
    getWorkspaceEndpointRow: (...args: unknown[]) => mockRow(...args),
    readWorkspaceEndpointKey: (...args: unknown[]) => mockReadKey(...args),
}));

const counted: Record<string, unknown>[] = [];
jest.mock("~/server/ai-usage/record", () => ({
    aiUsageRecorder: (companyId: unknown, feature: string) => ({
        record: (event: Record<string, unknown>) =>
            counted.push({ companyId: Number(companyId), feature, ...event }),
    }),
}));

import http from "node:http";
import type { AddressInfo } from "node:net";

import {
    auxiliaryRequestFields,
    configureAuxiliaryOpenAI,
    type AuxiliaryModel,
    type ChatModelBehavior,
} from "@launchstack/llm";
import { configureProviders } from "@launchstack/llm/providers/registry";
import { getNERProvider } from "@launchstack/llm/providers/ner";
import { GEMINI_DEFAULT_MODEL, GEMINI_FAST_MODEL } from "@launchstack/llm/types";
import { chunkDocument } from "@launchstack/conversion/ocr/chunker";
import {
    configureVlmEnrichment,
    enrichPageWithVlm,
    isVlmEnrichmentConfigured,
} from "@launchstack/conversion/ocr/enrichment";
import type { PageContent } from "@launchstack/conversion/ocr/types";

import {
    resetWorkspaceChatModelsCache,
    withWorkspaceChatModels,
} from "~/server/workspace-models/scope";
import type { WorkspaceModelSelection } from "~/server/db/schema/workspace-models";

interface Seen {
    endpoint: string;
    path: string;
    authorization: string | undefined;
    body: Record<string, unknown>;
}

const seen: Seen[] = [];
let server: http.Server;
let base = "";

/** A message's text, whether it was sent as a string or as content parts. */
function contentOf(body: Record<string, unknown>, role: string): string {
    const messages = body.messages as { role: string; content: unknown }[];
    const content = messages.find(m => m.role === role)?.content;
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function answerFor(body: Record<string, unknown>): string {
    const system = contentOf(body, "system");
    if (system.includes("named entity recognition")) {
        const user = contentOf(body, "user");
        if (user.includes("--- Chunk 2 ---")) {
            // A batch, answered the way the prompt asks: one element per chunk.
            return JSON.stringify([
                { entities: [{ text: "Acme Corp", label: "ORG", score: 0.9 }] },
                { entities: [{ text: "Berlin", label: "LOC", score: 0.8 }, { label: "ORG" }] },
            ]);
        }
        // Fenced, as a model without JSON mode often answers.
        return '```json\n{"entities":[{"text":"Acme Corp","label":"ORG","score":0.9}]}\n```';
    }
    if (system.includes("data analyst")) return "Quarterly revenue by region.";
    return "A bar chart of revenue by quarter.";
}

beforeAll(async () => {
    server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", chunk => (raw += chunk));
        req.on("end", () => {
            const body = JSON.parse(raw || "{}") as Record<string, unknown>;
            const endpoint = (req.url ?? "").split("/")[1] ?? "";
            seen.push({
                endpoint,
                path: req.url ?? "",
                authorization: req.headers.authorization,
                body,
            });
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
                JSON.stringify({
                    id: "cmpl-1",
                    object: "chat.completion",
                    created: 0,
                    model: body.model,
                    choices: [
                        {
                            index: 0,
                            finish_reason: "stop",
                            message: { role: "assistant", content: answerFor(body) },
                        },
                    ],
                    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                })
            );
        });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

const WORKSPACE_KEY = "sk-workspace-123456";

function selection(overrides: Partial<WorkspaceModelSelection> = {}): WorkspaceModelSelection {
    return {
        default: { id: "ws-default", vision: false, reasoning: false },
        fast: { id: "ws-fast", vision: false, reasoning: false },
        vision: { id: "ws-vision", vision: true, reasoning: false },
        ...overrides,
    };
}

function workspaceRow(models: WorkspaceModelSelection | null) {
    return {
        companyId: 5,
        provider: "custom",
        baseUrl: `${base}/workspace/v1`,
        apiKeyCiphertext: "sealed",
        apiKeyLast4: "3456",
        encryptionKeyVersion: 1,
        models,
        connectedVia: "key",
        updatedByUserId: 7,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

const TABLE_PAGE: PageContent = {
    pageNumber: 1,
    textBlocks: ["# Report\n\nRevenue grew in every region."],
    tables: [
        {
            rows: [
                ["Region", "Q1", "Q2"],
                ["North", "10", "12"],
            ],
            markdown: "| Region | Q1 | Q2 |\n|---|---|---|\n| North | 10 | 12 |",
            rowCount: 2,
            columnCount: 3,
        },
    ],
};

const PAGE_IMAGE = Buffer.from("not really a png");

/** Run every ingestion model call once: a table summary, an image description, NER. */
async function ingestOnce() {
    const chunks = await chunkDocument([TABLE_PAGE], { documentTitle: "Report" });
    const tableDescription = chunks.find(c => c.type === "table")?.metadata.tableDescription;
    const vlmConfigured = isVlmEnrichmentConfigured();
    const imageDescription = await enrichPageWithVlm(PAGE_IMAGE);
    const ner = await (await getNERProvider()).extract(["Acme Corp opened an office."]).then(
        result => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error })
    );
    return { tableDescription, vlmConfigured, imageDescription, ner };
}

function requestsTo(endpoint: string) {
    return seen.filter(s => s.endpoint === endpoint);
}

function systemOf(body: Record<string, unknown>): string {
    return contentOf(body, "system");
}

beforeEach(() => {
    seen.length = 0;
    counted.length = 0;
    resetWorkspaceChatModelsCache();
    mockIsCloud.mockReturnValue(false);
    mockRow.mockReset();
    mockReadKey.mockReset().mockReturnValue(WORKSPACE_KEY);
    configureAuxiliaryOpenAI({ apiKey: "sk-deployment-aux", baseUrl: `${base}/deployment/v1` });
    configureProviders({
        ner: { baseUrl: `${base}/deployment-ner/v1`, apiKey: "sk-deployment-ner" },
    });
    configureVlmEnrichment({});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("document ingestion outside a workspace's own model", () => {
    it("uses the server's auxiliary endpoint and NER endpoint, as before", async () => {
        const out = await ingestOnce();

        expect(out.tableDescription).toBe("Table on Page 1: Quarterly revenue by region.");
        expect(out.imageDescription).toBe("A bar chart of revenue by quarter.");
        expect(out.ner.ok && out.ner.result.data.totalEntities).toBe(1);
        // The server's NER keeps billing per chunk.
        expect(out.ner.ok && out.ner.result.usage.tokensUsed).toBe(500);

        const aux = requestsTo("deployment");
        expect(aux.map(r => r.body.model).sort()).toEqual(
            [GEMINI_DEFAULT_MODEL, GEMINI_FAST_MODEL].sort()
        );
        expect(aux.every(r => r.authorization === "Bearer sk-deployment-aux")).toBe(true);
        // Unchanged request shape: the caps it always sent.
        expect(aux.find(r => r.body.model === GEMINI_FAST_MODEL)?.body.max_tokens).toBe(60);

        const ner = requestsTo("deployment-ner");
        expect(ner).toHaveLength(1);
        expect(ner[0]!.body.temperature).toBe(0);
        expect(ner[0]!.body.response_format).toEqual({ type: "json_object" });
        expect(requestsTo("workspace")).toEqual([]);
    });

    it("still uses the server's in a workspace that connected but chose no model", async () => {
        mockRow.mockResolvedValue(workspaceRow(null));
        await withWorkspaceChatModels(5, "ingestion", ingestOnce);
        expect(requestsTo("workspace")).toEqual([]);
        expect(requestsTo("deployment")).toHaveLength(2);
        expect(requestsTo("deployment-ner")).toHaveLength(1);
    });
});

describe("document ingestion in a workspace on its own model", () => {
    it("sends every call to the workspace's endpoint and none to the server's", async () => {
        mockRow.mockResolvedValue(workspaceRow(selection()));

        const out = await withWorkspaceChatModels(5, "ingestion", ingestOnce);

        expect(requestsTo("deployment")).toEqual([]);
        expect(requestsTo("deployment-ner")).toEqual([]);

        const own = requestsTo("workspace");
        expect(own).toHaveLength(3);
        expect(own.every(r => r.path === "/workspace/v1/chat/completions")).toBe(true);
        expect(own.every(r => r.authorization === `Bearer ${WORKSPACE_KEY}`)).toBe(true);

        // The fast model for text, the model for images for the page image.
        const table = own.find(r => systemOf(r.body).includes("data analyst"))!;
        const image = own.find(r => systemOf(r.body).includes("visual layout"))!;
        const ner = own.find(r => systemOf(r.body).includes("named entity recognition"))!;
        expect(table.body.model).toBe("ws-fast");
        expect(ner.body.model).toBe("ws-fast");
        expect(image.body.model).toBe("ws-vision");
        expect(JSON.stringify(image.body.messages)).toContain("data:image/png;base64,");

        // Only declared fields: no temperature, no output cap, no JSON mode.
        for (const r of own) {
            expect(r.body).not.toHaveProperty("temperature");
            expect(r.body).not.toHaveProperty("max_tokens");
            expect(r.body).not.toHaveProperty("response_format");
        }
        // Stored text, not an answer: chat's identity rule is not added.
        expect(systemOf(table.body).startsWith("You are a concise data analyst.")).toBe(true);

        expect(out.tableDescription).toBe("Table on Page 1: Quarterly revenue by region.");
        expect(out.vlmConfigured).toBe(true);
        expect(out.imageDescription).toBe("A bar chart of revenue by quarter.");
        // A fenced answer still parses, and the workspace's provider bills it.
        expect(out.ner.ok && out.ner.result.data.totalEntities).toBe(1);
        expect(out.ner.ok && out.ner.result.usage.tokensUsed).toBe(0);
    });

    it("uses the default model when the workspace assigned no fast or image model", async () => {
        mockRow.mockResolvedValue(
            workspaceRow({ default: { id: "ws-default", vision: true, reasoning: false } })
        );
        await withWorkspaceChatModels(5, "ingestion", ingestOnce);
        expect(requestsTo("workspace").map(r => r.body.model)).toEqual([
            "ws-default",
            "ws-default",
            "ws-default",
        ]);
        expect(requestsTo("deployment")).toEqual([]);
    });

    it("asks for JSON mode only from a model that follows a JSON schema", async () => {
        mockRow.mockResolvedValue(
            workspaceRow(
                selection({
                    fast: {
                        id: "ws-fast",
                        vision: false,
                        reasoning: false,
                        structuredOutput: true,
                    },
                })
            )
        );
        await withWorkspaceChatModels(5, "ingestion", async () =>
            (await getNERProvider()).extract(["Acme Corp opened an office."])
        );
        expect(requestsTo("workspace")[0]!.body.response_format).toEqual({ type: "json_object" });
    });

    it("skips image descriptions when no workspace model reads images, rather than use the server's", async () => {
        mockRow.mockResolvedValue(
            workspaceRow({ default: { id: "ws-default", vision: false, reasoning: false } })
        );
        configureVlmEnrichment({ ollamaBaseUrl: `${base}/deployment-ollama` });

        const out = await withWorkspaceChatModels(5, "ingestion", ingestOnce);

        expect(out.vlmConfigured).toBe(false);
        expect(out.imageDescription).toBe("");
        expect(seen.filter(r => r.endpoint !== "workspace")).toEqual([]);
        // Text tasks still run, on the workspace's default model.
        expect(requestsTo("workspace").map(r => r.body.model)).toEqual([
            "ws-default",
            "ws-default",
        ]);
    });

    it("falls back to plain text, never the server's, when the workspace's endpoint can't be used", async () => {
        mockRow.mockResolvedValue(workspaceRow(selection()));
        mockReadKey.mockImplementation(() => {
            throw new Error("unseal failed");
        });

        const out = await withWorkspaceChatModels(5, "ingestion", ingestOnce);

        expect(seen).toEqual([]);
        expect(out.tableDescription).toMatch(/^Table from Page 1 \(Table 1\) containing /);
        expect(out.vlmConfigured).toBe(false);
        expect(out.imageDescription).toBe("");
        // NER fails; the pipeline logs it and indexes without graph rows.
        expect(out.ner.ok).toBe(false);
        expect(String((out.ner as { error: unknown }).error)).toMatch(
            /Entity extraction can't use the workspace's own model/
        );
    });

    it("keeps two workspaces apart when they ingest at the same time", async () => {
        mockRow.mockImplementation(async (companyId: number) =>
            Number(companyId) === 5 ? workspaceRow(selection()) : null
        );
        await Promise.all([
            withWorkspaceChatModels(5, "ingestion", ingestOnce),
            withWorkspaceChatModels(6, "ingestion", ingestOnce),
        ]);
        expect(requestsTo("workspace")).toHaveLength(3);
        expect(requestsTo("deployment")).toHaveLength(2);
        expect(requestsTo("deployment-ner")).toHaveLength(1);
    });

    it("counts every call against the workspace that made it, on whichever endpoint served it", async () => {
        mockRow.mockImplementation(async (companyId: number) =>
            Number(companyId) === 5 ? workspaceRow(selection()) : null
        );
        await Promise.all([
            withWorkspaceChatModels(5, "ingestion", ingestOnce),
            withWorkspaceChatModels(6, "ingestion", ingestOnce),
        ]);
        // A JSON answer's usage is read from a clone, a tick after the caller has it.
        for (let i = 0; i < 50 && counted.length < 6; i++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        const tokens = { inputTokens: 10, outputTokens: 5 };
        const own = counted.filter(c => c.companyId === 5);
        expect(own.map(c => c.route).sort()).toEqual(["fast", "fast", "vision"]);
        expect(own.map(c => c.modelId).sort()).toEqual(["ws-fast", "ws-fast", "ws-vision"]);
        expect(own.every(c => c.owner === "workspace" && c.feature === "ingestion")).toBe(true);
        expect(own.every(c => c.inputTokens === 10 && c.outputTokens === 5)).toBe(true);

        const server = counted.filter(c => c.companyId === 6);
        expect(server).toHaveLength(3);
        for (const call of server) {
            expect(call).toMatchObject({ ...tokens, owner: "deployment", route: "auxiliary" });
        }
        expect(server.map(c => c.modelId).sort()).toEqual(
            [GEMINI_DEFAULT_MODEL, GEMINI_FAST_MODEL, GEMINI_FAST_MODEL].sort()
        );
    });
});

describe("entity extraction answers", () => {
    it("reads a batch answered one element per chunk, and drops entries that are not entities", async () => {
        const out = await (
            await getNERProvider()
        ).extract(["Acme Corp opened an office.", "It is in Berlin."]);
        expect(out.data.results.map(r => r.entities.map(e => e.text))).toEqual([
            ["Acme Corp"],
            ["Berlin"],
        ]);
        expect(out.data.totalEntities).toBe(2);
    });
});

describe("auxiliaryRequestFields", () => {
    const client = {} as AuxiliaryModel["client"];
    const behavior = (parameters: Partial<ChatModelBehavior["parameters"]>, json = false) =>
        ({
            input: ["text"],
            reasoning: { mode: "none" },
            nativeStructuredOutput: json ? ["json-schema"] : [],
            parameters: {
                temperature: "unsupported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "unsupported",
                ...parameters,
            },
        }) as ChatModelBehavior;

    it("passes every wish to the server's auxiliary models", () => {
        expect(
            auxiliaryRequestFields(
                { owner: "deployment", client, modelId: "m" },
                { temperature: 0, maxTokens: 60, json: true }
            )
        ).toEqual({ temperature: 0, max_tokens: 60, response_format: { type: "json_object" } });
    });

    it("sends a workspace's model only what it declared, under its own cap field", () => {
        const model: AuxiliaryModel = {
            owner: "workspace",
            client,
            modelId: "m",
            behavior: behavior({
                temperature: "supported",
                maxOutputTokens: "supported",
                maxOutputTokensField: "max_completion_tokens",
            }),
        };
        expect(
            auxiliaryRequestFields(model, { temperature: 0, maxTokens: 60, json: true })
        ).toEqual({ temperature: 0, max_completion_tokens: 60 });
    });
});
