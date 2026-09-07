import type * as CoreLlm from "@launchstack/llm";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockStructuredInvoke = jest
    .fn<Promise<{ missingDocuments: never[]; recommendations: never[] }>, []>()
    .mockResolvedValue({
        missingDocuments: [],
        recommendations: [],
    });

jest.mock("p-limit", () => ({
    __esModule: true,
    default: () => (fn: () => Promise<unknown>) => fn(),
}));

// The routes require a workspace context and scope the document to the
// caller's active company (cross-tenant documents read as 404). Company 7 is
// the company the fixture document below belongs to.
const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

// The route imports RateLimitPresets from ~/lib/rate-limiter; loading the
// real module starts an un-unref'd cleanup setInterval that keeps the Jest
// process alive after the run, so mock the presets instead.
jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: {
        standard: { maxRequests: 100, windowMs: 15 * 60 * 1000 },
        strict: { maxRequests: 20, windowMs: 15 * 60 * 1000 },
        permissive: { maxRequests: 300, windowMs: 15 * 60 * 1000 },
        burst: { maxRequests: 10, windowMs: 60 * 1000 },
    },
}));

jest.mock("@launchstack/llm", () => {
    const actual = jest.requireActual<typeof CoreLlm>("@launchstack/llm");
    return {
        __esModule: true,
        ...actual,
        invokeStructured: jest.fn(() => mockStructuredInvoke()),
    };
});

jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(() => ({
        route: "fast",
        name: "primary",
        modelId: "test-model",
        behavior: {
            input: ["text"],
            reasoning: { mode: "none" },
            nativeStructuredOutput: ["json-schema"],
            parameters: {
                temperature: "supported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
            },
        },
        inheritsDefault: true,
        reasoning: { mode: "none", enabled: false, requestPatch: {} },
        chat: {},
        prepareMessages: (messages: unknown[]) => messages,
    })),
}));

const mockRouteDb = {
    select: jest.fn(),
    insert: jest.fn(),
};
const mockWorkerDb = {
    select: jest.fn(),
    insert: jest.fn(),
};

jest.mock("~/server/db/index", () => ({
    get db() {
        return mockRouteDb;
    },
}));
jest.mock("~/server/db", () => ({
    get db() {
        return mockWorkerDb;
    },
}));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: jest.fn(
        async (_request: Request, _config: unknown, handler: () => Promise<unknown>) => handler()
    ),
}));
jest.mock("~/server/metrics/registry", () => ({
    predictiveAnalysisAiCalls: { observe: jest.fn() },
    predictiveAnalysisCacheHits: { inc: jest.fn() },
    predictiveAnalysisDuration: { startTimer: jest.fn(() => jest.fn()) },
    predictiveAnalysisRequests: { inc: jest.fn() },
}));
jest.mock("~/lib/integrations/slack", () => ({
    notifyOnCriticalFindings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("~/server/inngest/client", () => ({
    inngest: {
        createFunction: jest.fn((_options: unknown, _trigger: unknown, handler: unknown) => ({
            fn: handler,
        })),
        send: jest.fn().mockResolvedValue(undefined),
    },
}));

import { POST } from "~/app/api/agents/predictive-document-analysis/route";
import { POST as streamPOST } from "~/app/api/agents/predictive-document-analysis/stream/route";
import { predictiveAnalysisJob } from "~/server/inngest/functions/predictiveAnalysis";
import { document, documentContextChunks, pdfChunks } from "@launchstack/store/schema";
import { predictiveDocumentAnalysisResults } from "~/server/db/schema";

import * as AnalysisEngine from "~/app/api/agents/predictive-document-analysis/services/analysisEngine";
import { createChunkBatches } from "~/app/api/agents/predictive-document-analysis/utils/batching";
import type {
    PdfChunk,
    AnalysisSpecification,
} from "~/app/api/agents/predictive-document-analysis/types";

describe("predictive analysis batching", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStructuredInvoke.mockClear();
    });

    it("groups chunks according to the configured limits", () => {
        const chunks: PdfChunk[] = [
            { id: 1, page: 1, content: "a".repeat(1000) },
            { id: 2, page: 2, content: "b".repeat(1000) },
            { id: 3, page: 3, content: "c".repeat(1000) },
            { id: 4, page: 4, content: "d".repeat(1000) },
            { id: 5, page: 5, content: "e".repeat(1000) },
        ];

        const batches = createChunkBatches(chunks, {
            maxChunksPerCall: 2,
            maxCharactersPerCall: 2500,
        });

        expect(batches).toHaveLength(3);
        expect(batches[0]).toHaveLength(2);
        expect(batches[1]).toHaveLength(2);
        expect(batches[2]).toHaveLength(1);
    });

    it("caps OpenAI round trips for large documents", async () => {
        const chunks: PdfChunk[] = Array.from({ length: 120 }, (_, index) => ({
            id: index + 1,
            page: index + 1,
            content: `Chunk content ${index + 1}`,
        }));

        const specification: AnalysisSpecification = {
            type: "general",
            includeRelatedDocs: false,
            existingDocuments: [],
            title: "Sample",
            category: "general",
            companyId: 1,
            documentId: 10,
        };

        const { stats } = await AnalysisEngine.analyzeDocumentChunks(
            chunks,
            specification,
            2000,
            8
        );

        expect(stats.aiCalls).toBeLessThanOrEqual(15);
        expect(stats.totalChunks).toBe(120);
        expect(mockStructuredInvoke).toHaveBeenCalledTimes(stats.aiCalls);
    });
});

type ContextChunkFixture = {
    id: number;
    documentId: bigint;
    versionId: bigint | null;
    content: string;
    pageNumber: number | null;
    sectionHeading: string | null;
};

const predictiveDocumentId = 10;
let currentVersionId = 2n;
let contextChunkRows: ContextChunkFixture[] = [];
let legacyChunkRows: Array<{ id: number; content: string; page: number }> = [];
let legacyChunkQueryCount = 0;

type PredictiveCacheFixture = {
    versionId: bigint | null;
    analysisType: string;
    includeRelatedDocs: boolean;
    resultJson: Record<string, unknown>;
};

let predictiveCacheRows: PredictiveCacheFixture[] = [];

type PredictiveQueryState = {
    source: unknown;
    hasCurrentVersionPredicate: boolean;
};

type PredictiveQueryChain = PredictiveQueryState & {
    from(source: unknown): PredictiveQueryChain;
    innerJoin(...args: unknown[]): PredictiveQueryChain;
    leftJoin(...args: unknown[]): PredictiveQueryChain;
    where(...args: unknown[]): PredictiveQueryChain;
    orderBy(...args: unknown[]): PredictiveQueryChain;
    limit(limit?: number): Promise<unknown[]>;
    then<TResult1 = unknown[], TResult2 = never>(
        onFulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2>;
};

function collectColumnNames(value: unknown, names: Set<string>, seen: WeakSet<object>): void {
    if (typeof value !== "object" || value === null || seen.has(value)) {
        return;
    }
    seen.add(value);

    if ("name" in value && typeof value.name === "string") {
        names.add(value.name);
    }
    if ("queryChunks" in value && Array.isArray(value.queryChunks)) {
        for (const chunk of value.queryChunks) {
            collectColumnNames(chunk, names, seen);
        }
    }
}

function hasCurrentVersionPredicate(values: unknown[]): boolean {
    const names = new Set<string>();
    const seen = new WeakSet<object>();
    for (const value of values) {
        collectColumnNames(value, names, seen);
    }
    return (
        (names.has("versionId") || names.has("version_id")) &&
        (names.has("currentVersionId") || names.has("current_version_id"))
    );
}

function resolvePredictiveQuery(query: PredictiveQueryState): unknown[] {
    if (query.source === document) {
        return [
            {
                id: predictiveDocumentId,
                title: "Versioned document",
                category: "general",
                companyId: 7n,
                currentVersionId,
            },
        ];
    }

    if (query.source === predictiveDocumentAnalysisResults) {
        const rows = query.hasCurrentVersionPredicate
            ? predictiveCacheRows.filter(row => row.versionId === currentVersionId)
            : predictiveCacheRows;
        return rows.map(row => ({ resultJson: row.resultJson }));
    }

    if (query.source === documentContextChunks) {
        const rows = query.hasCurrentVersionPredicate
            ? contextChunkRows.filter(row => row.versionId === currentVersionId)
            : contextChunkRows;
        return rows.map(row => ({
            id: row.id,
            content: row.content,
            page: row.pageNumber,
            sectionHeading: row.sectionHeading,
        }));
    }

    if (query.source === pdfChunks) {
        legacyChunkQueryCount += 1;
        return legacyChunkRows;
    }

    return [];
}

function makePredictiveSelectQuery(): PredictiveQueryChain {
    const query: PredictiveQueryChain = {
        source: undefined,
        hasCurrentVersionPredicate: false,
        from: jest.fn((source: unknown): PredictiveQueryChain => {
            query.source = source;
            return query;
        }),
        innerJoin: jest.fn((..._args: unknown[]): PredictiveQueryChain => query),
        leftJoin: jest.fn((..._args: unknown[]): PredictiveQueryChain => query),
        where: jest.fn((...args: unknown[]): PredictiveQueryChain => {
            query.hasCurrentVersionPredicate = hasCurrentVersionPredicate(args);
            return query;
        }),
        orderBy: jest.fn((..._args: unknown[]): PredictiveQueryChain => query),
        limit: jest.fn(
            (_limit?: number): Promise<unknown[]> => Promise.resolve(resolvePredictiveQuery(query))
        ),
        then: <TResult1 = unknown[], TResult2 = never>(
            onFulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
            onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ): PromiseLike<TResult1 | TResult2> =>
            Promise.resolve(resolvePredictiveQuery(query)).then(onFulfilled, onRejected),
    };

    return query;
}

function resetPredictiveFixtures() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            authUserId: "user-1",
            userPk: BigInt(1),
            companyId: BigInt(7),
            role: "owner",
        }),
    });
    currentVersionId = 2n;
    contextChunkRows = [
        {
            id: 1,
            documentId: BigInt(predictiveDocumentId),
            versionId: 1n,
            content: "v1 content",
            pageNumber: 1,
            sectionHeading: "v1",
        },
        {
            id: 2,
            documentId: BigInt(predictiveDocumentId),
            versionId: 2n,
            content: "v2 content",
            pageNumber: 2,
            sectionHeading: "v2",
        },
    ];
    predictiveCacheRows = [
        {
            versionId: 1n,
            analysisType: "general",
            includeRelatedDocs: false,
            resultJson: { marker: "v1" },
        },
        {
            versionId: 2n,
            analysisType: "general",
            includeRelatedDocs: false,
            resultJson: { marker: "v2" },
        },
        {
            versionId: null,
            analysisType: "general",
            includeRelatedDocs: false,
            resultJson: { marker: "null" },
        },
    ];
    legacyChunkRows = [{ id: 99, content: "legacy pdfChunks content", page: 99 }];
    legacyChunkQueryCount = 0;

    mockRouteDb.select.mockImplementation((): PredictiveQueryChain => makePredictiveSelectQuery());
    mockWorkerDb.select.mockImplementation((): PredictiveQueryChain => makePredictiveSelectQuery());
    mockRouteDb.insert.mockImplementation(() => ({
        values: jest.fn().mockResolvedValue(undefined),
    }));
    mockWorkerDb.insert.mockImplementation(() => ({
        values: jest.fn().mockResolvedValue(undefined),
    }));
}

const predictiveAnalysisResponse = {
    result: {
        missingDocuments: [],
        recommendations: [],
        insights: [],
        suggestedRelatedDocuments: [],
    },
    stats: {
        aiCalls: 1,
        batches: 1,
        averageBatchSize: 1,
        averageChunkLength: 10,
        totalChunks: 1,
    },
};

type PredictiveWorkerHandler = (context: {
    event: {
        data: {
            documentId: number;
            analysisType: string;
            includeRelatedDocs: boolean;
            timeoutMs: number;
            jobId: string;
        };
    };
    step: {
        run: (name: string, operation: () => Promise<unknown>) => Promise<unknown>;
    };
}) => Promise<unknown>;

const runPredictiveWorker = () =>
    (
        predictiveAnalysisJob as unknown as {
            fn: PredictiveWorkerHandler;
        }
    ).fn({
        event: {
            data: {
                documentId: predictiveDocumentId,
                analysisType: "general",
                includeRelatedDocs: false,
                timeoutMs: 2000,
                jobId: "predictive-test-job",
            },
        },
        step: {
            run: async (_name, operation) => operation(),
        },
    });

describe("predictive entrypoint current-version retrieval", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetPredictiveFixtures();
    });

    it("returns only the current-version HTTP cache entry", async () => {
        const response = await POST(
            new Request("http://localhost/api/predictive", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ documentId: predictiveDocumentId }),
            })
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as { marker?: string; fromCache?: boolean };
        expect(body).toMatchObject({ marker: "v2", fromCache: true });
        expect(body.marker).not.toBe("v1");
        expect(body.marker).not.toBe("null");
    });

    it("returns only the current-version SSE cache entry", async () => {
        const response = await streamPOST(
            new Request("http://localhost/api/predictive/stream", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ documentId: predictiveDocumentId }),
            })
        );

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).toContain('"marker":"v2"');
        expect(body).toContain('"fromCache":true');
        expect(body).not.toContain('"marker":"v1"');
        expect(body).not.toContain('"marker":"null"');
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("sends only current-version chunks to HTTP analysis without querying pdfChunks", async () => {
        const analyzeSpy = jest
            .spyOn(AnalysisEngine, "analyzeDocumentChunks")
            .mockResolvedValue(predictiveAnalysisResponse);

        const response = await POST(
            new Request("http://localhost/api/predictive", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    documentId: predictiveDocumentId,
                    forceRefresh: true,
                }),
            })
        );

        expect(response.status).toBe(200);
        expect(analyzeSpy).toHaveBeenCalledTimes(1);
        expect(analyzeSpy.mock.calls[0]?.[0].map(chunk => chunk.id)).toEqual([2]);
        expect(legacyChunkQueryCount).toBe(0);
    });

    it("fails closed for HTTP when only stale or unversioned chunks exist", async () => {
        contextChunkRows = [
            {
                id: 1,
                documentId: BigInt(predictiveDocumentId),
                versionId: 1n,
                content: "stale v1 content",
                pageNumber: 1,
                sectionHeading: "v1",
            },
            {
                id: 3,
                documentId: BigInt(predictiveDocumentId),
                versionId: null,
                content: "unversioned content",
                pageNumber: 3,
                sectionHeading: null,
            },
        ];
        const analyzeSpy = jest
            .spyOn(AnalysisEngine, "analyzeDocumentChunks")
            .mockResolvedValue(predictiveAnalysisResponse);

        const response = await POST(
            new Request("http://localhost/api/predictive", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    documentId: predictiveDocumentId,
                    forceRefresh: true,
                }),
            })
        );

        expect(response.status).toBe(404);
        expect(analyzeSpy).not.toHaveBeenCalled();
        expect(legacyChunkQueryCount).toBe(0);
    });

    it("sends only current-version chunks to worker analysis without querying pdfChunks", async () => {
        const analyzeSpy = jest
            .spyOn(AnalysisEngine, "analyzeDocumentChunks")
            .mockResolvedValue(predictiveAnalysisResponse);

        await runPredictiveWorker();

        expect(analyzeSpy).toHaveBeenCalledTimes(1);
        expect(analyzeSpy.mock.calls[0]?.[0].map(chunk => chunk.id)).toEqual([2]);
        expect(legacyChunkQueryCount).toBe(0);
    });

    it("fails closed for the worker when only stale or unversioned chunks exist", async () => {
        contextChunkRows = [
            {
                id: 1,
                documentId: BigInt(predictiveDocumentId),
                versionId: 1n,
                content: "stale v1 content",
                pageNumber: 1,
                sectionHeading: "v1",
            },
            {
                id: 3,
                documentId: BigInt(predictiveDocumentId),
                versionId: null,
                content: "unversioned content",
                pageNumber: 3,
                sectionHeading: null,
            },
        ];
        const analyzeSpy = jest
            .spyOn(AnalysisEngine, "analyzeDocumentChunks")
            .mockResolvedValue(predictiveAnalysisResponse);

        await expect(runPredictiveWorker()).rejects.toThrow(
            `No chunks found for document ${predictiveDocumentId}`
        );

        expect(analyzeSpy).not.toHaveBeenCalled();
        expect(legacyChunkQueryCount).toBe(0);
    });
});
