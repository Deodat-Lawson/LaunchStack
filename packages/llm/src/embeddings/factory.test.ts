import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ollama = vi.hoisted(() => ({
    options: [] as Array<{ baseUrl?: string; model?: string }>,
}));
vi.mock("@langchain/ollama", () => ({
    OllamaEmbeddings: class {
        constructor(options: { baseUrl?: string; model?: string }) {
            ollama.options.push(options);
        }
        async embedQuery(): Promise<number[]> {
            return [0.1, 0.2, 0.3];
        }
        async embedDocuments(documents: string[]): Promise<number[][]> {
            return documents.map(() => [0.1, 0.2, 0.3]);
        }
    },
}));

import { runWithChatModelsScope } from "../chat-scope";
import type { ChatUsageEvent } from "../usage-meter";
import { configureCompanyEmbeddingDefaults } from "./company-config";
import { createEmbeddingModel } from "./factory";
import type { EmbeddingIndexConfig } from "./index-registry";

function index(provider: EmbeddingIndexConfig["provider"], model: string): EmbeddingIndexConfig {
    return {
        indexKey: `${provider}-test`,
        provider,
        model,
        dimension: 3,
        enabled: true,
        storageKind: "dimension_table",
        version: "1",
    };
}

/** Run `fn` in a scope that collects what was reported. */
async function counting(fn: () => Promise<unknown>): Promise<ChatUsageEvent[]> {
    const events: ChatUsageEvent[] = [];
    await runWithChatModelsScope(
        { source: "deployment", usage: { record: event => events.push(event) } },
        fn
    );
    return events;
}

beforeEach(() => {
    ollama.options.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureCompanyEmbeddingDefaults({
        openAIApiKey: "deployment-key",
        openAIBaseUrl: "https://embeddings.deployment.example/v1",
        huggingFaceApiKey: "hf-deployment",
        ollamaBaseUrl: "http://ollama.deployment:11434",
        ollamaEmbeddingModel: "nomic-embed-text",
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    configureCompanyEmbeddingDefaults({});
});

describe("createEmbeddingModel counts against whoever owns the endpoint", () => {
    function stubOpenAICompatible() {
        const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
            Response.json({
                object: "list",
                model: "text-embedding-3-large",
                data: [{ index: 0, embedding: [1, 2, 3] }],
                usage: { prompt_tokens: 5, total_tokens: 5 },
            })
        );
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("OpenAI-compatible on the deployment's pair", async () => {
        const fetchMock = stubOpenAICompatible();
        const model = createEmbeddingModel(index("openai", "text-embedding-3-large"), {});
        const events = await counting(() => model.embedQuery("hello"));

        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
            "https://embeddings.deployment.example/v1/embeddings"
        );
        expect(events).toEqual([
            {
                kind: "embedding",
                modelId: "text-embedding-3-large",
                owner: "deployment",
                inputTokens: 5,
                outputTokens: 0,
            },
        ]);
    });

    it("OpenAI-compatible on the workspace's own key and URL", async () => {
        const fetchMock = stubOpenAICompatible();
        const model = createEmbeddingModel(index("openai", "text-embedding-3-large"), {
            openAIApiKey: "tenant-key",
            openAIBaseUrl: "https://tenant.example/v1",
        });
        const events = await counting(() => model.embedDocuments!(["hello"]));

        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://tenant.example/v1/embeddings");
        expect(events).toMatchObject([{ kind: "embedding", owner: "workspace", inputTokens: 5 }]);
    });

    it("Ollama: an estimate per request, under the model actually asked for", async () => {
        const deployment = createEmbeddingModel(index("ollama", "registry-model"), {});
        const onDeployment = await counting(() => deployment.embedDocuments!(["12345678", "1234"]));
        expect(ollama.options[0]).toEqual({
            baseUrl: "http://ollama.deployment:11434",
            model: "nomic-embed-text",
        });
        expect(onDeployment).toEqual([
            {
                kind: "embedding",
                modelId: "nomic-embed-text",
                owner: "deployment",
                inputTokens: 3,
                outputTokens: 0,
            },
        ]);

        const tenant = createEmbeddingModel(index("ollama", "registry-model"), {
            ollamaBaseUrl: "http://ollama.tenant:11434",
            ollamaModel: "mxbai-embed-large",
        });
        const onTenant = await counting(() => tenant.embedQuery("hello"));
        expect(onTenant).toEqual([
            {
                kind: "embedding",
                modelId: "mxbai-embed-large",
                owner: "workspace",
                inputTokens: 2,
                outputTokens: 0,
            },
        ]);
    });

    it("Hugging Face: an estimate per request, owned by whoever supplied the key", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json([0.1, 0.2, 0.3]))
        );
        const deployment = createEmbeddingModel(index("huggingface", "BAAI/bge-small"), {});
        const tenant = createEmbeddingModel(index("huggingface", "BAAI/bge-small"), {
            huggingFaceApiKey: "hf-tenant",
        });

        const events = await counting(async () => {
            await deployment.embedQuery("abcd");
            await tenant.embedDocuments!(["abcd", "efgh"]);
        });

        expect(events).toEqual([
            {
                kind: "embedding",
                modelId: "BAAI/bge-small",
                owner: "deployment",
                inputTokens: 1,
                outputTokens: 0,
            },
            {
                kind: "embedding",
                modelId: "BAAI/bge-small",
                owner: "workspace",
                inputTokens: 2,
                outputTokens: 0,
            },
        ]);
    });
});
