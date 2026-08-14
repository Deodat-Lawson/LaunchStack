/**
 * The sink is where a `KnowledgeItem` becomes a document: first sync creates
 * one, a changed file adds a version to the *same* document, and an unchanged
 * file is recognised before anything reaches blob storage.
 */

const mockEnv = { server: { APP_PUBLIC_URL: undefined as string | undefined } };
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("@launchstack/core/embeddings", () => ({ resolveIngestIndexKey: jest.fn() }));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentLifecycle: jest.fn(),
    createDocumentVersionLifecycle: jest.fn(),
    findDocumentByCreationKey: jest.fn(),
}));

const mockUpdateWhere = jest.fn();
const mockUpdateSet = jest.fn(() => ({ where: mockUpdateWhere }));
const mockDbUpdate = jest.fn((_table: unknown) => ({ set: mockUpdateSet }));
jest.mock("~/server/db", () => ({
    db: { update: (table: unknown) => mockDbUpdate(table) },
}));

import type { KnowledgeItem } from "@launchstack/features/connectors";
import { resolveIngestIndexKey } from "@launchstack/core/embeddings";

import { uploadFile } from "~/lib/storage";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
} from "~/server/services/document-creation";
import {
    AGENT_KNOWLEDGE_CATEGORY,
    createAgentKnowledgeSink,
} from "~/server/services/agent-knowledge-connector";

const mockUploadFile = uploadFile as jest.Mock;
const mockResolveIndex = resolveIngestIndexKey as jest.Mock;
const mockCreate = createDocumentLifecycle as jest.Mock;
const mockCreateVersion = createDocumentVersionLifecycle as jest.Mock;
const mockFind = findDocumentByCreationKey as jest.Mock;

const SOURCE_ID = "agent-knowledge://claude-code/global/agents/code-reviewer.md";

interface UploadArg {
    filename: string;
    data: Buffer;
    contentType: string;
}

interface LifecycleArg {
    ocrMetadata: Record<string, unknown>;
    processing: Record<string, unknown>;
}

function firstCallArg<T>(mock: jest.Mock): T {
    const calls = mock.mock.calls as unknown as [T][];
    const first = calls[0];
    if (!first) throw new Error("expected the mock to have been called");
    return first[0];
}

function knowledgeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
    return {
        sourceId: SOURCE_ID,
        connectorId: "agent-knowledge",
        title: "Claude Code (global) — agents/code-reviewer.md",
        kind: "agent",
        mimeType: "text/markdown",
        bytes: 42,
        modifiedAt: "2026-08-01T00:00:00.000Z",
        location: {
            origin: "/home/dev/.claude/agents/code-reviewer.md",
            relativePath: "agents/code-reviewer.md",
        },
        metadata: {
            tool: "claude-code",
            toolLabel: "Claude Code",
            scope: "global",
            scopeKey: "global",
            kind: "agent",
        },
        content: "You review code carefully.",
        contentHash: "a".repeat(64),
        ...overrides,
    };
}

const context = { companyId: 7n, userId: "user_abc" };

beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.server.APP_PUBLIC_URL = undefined;
    mockResolveIndex.mockResolvedValue("openai-small");
    mockUploadFile.mockResolvedValue({ url: "https://blob.test/doc.md" });
    mockFind.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ documentId: 11, versionId: 21, jobId: "job-1" });
    mockCreateVersion.mockResolvedValue({ documentId: 11, versionId: 22, jobId: "job-2" });
});

describe("createAgentKnowledgeSink — first sync", () => {
    it("uploads the file and creates a document keyed on the connector source id", async () => {
        const sink = await createAgentKnowledgeSink(context);
        const result = await sink.store(knowledgeItem());

        expect(result).toEqual({
            sourceId: SOURCE_ID,
            documentId: 11,
            versionId: 21,
            jobId: "job-1",
            revised: false,
        });

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: 7n,
                userId: "user_abc",
                category: AGENT_KNOWLEDGE_CATEGORY,
                creationKey: `connector:agent-knowledge:${SOURCE_ID}`,
                mimeType: "text/markdown",
                url: "https://blob.test/doc.md",
                processingUrl: "https://blob.test/doc.md",
                ocrEnabled: true,
                ocrProcessed: false,
            })
        );
        expect(mockCreateVersion).not.toHaveBeenCalled();
    });

    it("keeps provenance in the uploaded text so retrieved chunks stay attributable", async () => {
        const sink = await createAgentKnowledgeSink(context);
        await sink.store(knowledgeItem());

        const uploaded = firstCallArg<UploadArg>(mockUploadFile);
        const body = uploaded.data.toString("utf-8");

        expect(body).toContain("Imported from Claude Code (global) — agent");
        expect(body).toContain("`agents/code-reviewer.md`");
        expect(body).toContain("You review code carefully.");
        expect(uploaded.contentType).toBe("text/markdown");
        // Flat filename, extension preserved so the ingestion router still
        // routes it to the markdown adapter.
        expect(uploaded.filename).toBe("claude-code-global-agents-code-reviewer.md");
    });

    it("records the content hash so the next sync can detect a change", async () => {
        const sink = await createAgentKnowledgeSink(context);
        await sink.store(knowledgeItem());

        const params = firstCallArg<LifecycleArg>(mockCreate);
        expect(params.ocrMetadata).toEqual(
            expect.objectContaining({
                connector: "agent-knowledge",
                sourceId: SOURCE_ID,
                contentHash: "a".repeat(64),
                tool: "claude-code",
                kind: "agent",
                relativePath: "agents/code-reviewer.md",
            })
        );
        expect(params.processing.embeddingIndexKey).toBe("openai-small");
    });

    it("resolves the embedding index once per sink, not once per file", async () => {
        const sink = await createAgentKnowledgeSink(context);
        await sink.store(knowledgeItem());
        await sink.store(knowledgeItem({ sourceId: `${SOURCE_ID}-2` }));

        expect(mockResolveIndex).toHaveBeenCalledTimes(1);
    });

    it("honours an explicit category and embedding index", async () => {
        const sink = await createAgentKnowledgeSink({
            ...context,
            category: "Playbooks",
            embeddingIndexKey: "custom-index",
        });
        await sink.store(knowledgeItem());

        expect(mockResolveIndex).not.toHaveBeenCalled();
        const params = firstCallArg<LifecycleArg & { category: string }>(mockCreate);
        expect(params.category).toBe("Playbooks");
        expect(params.processing.embeddingIndexKey).toBe("custom-index");
    });
});

/**
 * The database storage backend (the default when S3 is unconfigured) returns
 * relative URLs. The ingestion worker runs in a different process and fetches
 * the URL verbatim, so a relative one dies inside the worker with
 * "Failed to parse URL from /api/files/12" long after the sync reported success.
 */
describe("createAgentKnowledgeSink — relative blob URLs", () => {
    beforeEach(() => {
        mockUploadFile.mockResolvedValue({ url: "/api/files/12" });
    });

    it("keeps the row relative but hands the worker an absolute URL", async () => {
        const sink = await createAgentKnowledgeSink({
            ...context,
            requestUrl: "http://localhost:3001/api/connectors/agent-knowledge",
        });
        await sink.store(knowledgeItem());

        const params = firstCallArg<{ url: string; processingUrl: string }>(mockCreate);
        expect(params.url).toBe("/api/files/12");
        expect(params.processingUrl).toBe("http://localhost:3001/api/files/12");
    });

    it("falls back to APP_PUBLIC_URL for callers with no request", async () => {
        mockEnv.server.APP_PUBLIC_URL = "https://knowledge.example.com";

        const sink = await createAgentKnowledgeSink(context);
        await sink.store(knowledgeItem());

        const params = firstCallArg<{ processingUrl: string }>(mockCreate);
        expect(params.processingUrl).toBe("https://knowledge.example.com/api/files/12");
    });

    it("refuses to dispatch rather than queue a job that cannot fetch its file", async () => {
        const sink = await createAgentKnowledgeSink(context);

        await expect(sink.store(knowledgeItem())).rejects.toThrow(/APP_PUBLIC_URL/);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("passes an absolute blob URL through untouched", async () => {
        mockUploadFile.mockResolvedValue({ url: "https://s3.test/doc.md" });

        const sink = await createAgentKnowledgeSink(context);
        await sink.store(knowledgeItem());

        const params = firstCallArg<{ url: string; processingUrl: string }>(mockCreate);
        expect(params.url).toBe("https://s3.test/doc.md");
        expect(params.processingUrl).toBe("https://s3.test/doc.md");
    });

    it("absolutizes the version path too", async () => {
        mockFind.mockResolvedValue({ id: 11, ocrMetadata: { contentHash: "b".repeat(64) } });

        const sink = await createAgentKnowledgeSink({
            ...context,
            requestUrl: "http://localhost:3001/api/connectors/agent-knowledge",
        });
        await sink.store(knowledgeItem());

        const params = firstCallArg<{ url: string; processingUrl: string }>(mockCreateVersion);
        expect(params.url).toBe("/api/files/12");
        expect(params.processingUrl).toBe("http://localhost:3001/api/files/12");
    });
});

describe("createAgentKnowledgeSink — re-sync", () => {
    it("adds a version to the existing document when the content changed", async () => {
        mockFind.mockResolvedValue({ id: 11, ocrMetadata: { contentHash: "b".repeat(64) } });

        const sink = await createAgentKnowledgeSink(context);
        const result = await sink.store(knowledgeItem());

        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockCreateVersion).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: 11,
                companyId: 7n,
                // The hash in the key makes a repeated call converge on the
                // version it already created instead of stacking new ones.
                creationKey: `connector:agent-knowledge:${SOURCE_ID}:v:${"a".repeat(64)}`,
            })
        );
        expect(result.revised).toBe(true);
        expect(result.versionId).toBe(22);
    });

    it("writes the new hash back to the document after a revision", async () => {
        mockFind.mockResolvedValue({ id: 11, ocrMetadata: { contentHash: "b".repeat(64) } });

        const sink = await createAgentKnowledgeSink(context);
        await sink.store(knowledgeItem());

        expect(mockDbUpdate).toHaveBeenCalledTimes(1);
        const patch = firstCallArg<{ ocrMetadata: Record<string, unknown> }>(mockUpdateSet);
        expect(patch.ocrMetadata.contentHash).toBe("a".repeat(64));
        expect(patch.ocrMetadata.sourceId).toBe(SOURCE_ID);
    });

    it("reports the last synced hash from the stored document", async () => {
        mockFind.mockResolvedValue({ id: 11, ocrMetadata: { contentHash: "c".repeat(64) } });

        const sink = await createAgentKnowledgeSink(context);

        expect(await sink.lastSyncedHash?.(knowledgeItem())).toBe("c".repeat(64));
        expect(mockFind).toHaveBeenCalledWith(7n, `connector:agent-knowledge:${SOURCE_ID}`);
    });

    it("reports no hash for a source it has never seen, or one stored without metadata", async () => {
        const sink = await createAgentKnowledgeSink(context);

        mockFind.mockResolvedValue(null);
        expect(await sink.lastSyncedHash?.(knowledgeItem())).toBeNull();

        mockFind.mockResolvedValue({ id: 11, ocrMetadata: null });
        expect(await sink.lastSyncedHash?.(knowledgeItem())).toBeNull();
    });
});
