import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import type {
    AnalysisSpecification,
    PdfChunk,
} from "~/app/api/agents/predictive-document-analysis/types";
import type { AnalyzeDocumentChunksResponse } from "~/app/api/agents/predictive-document-analysis/services/analysisEngine";
import type { PredictiveAnalysisEvent } from "~/server/inngest/client";

type AnalyzeDocumentChunks = (
    allChunks: PdfChunk[],
    specification: AnalysisSpecification,
    timeoutMs?: number,
    maxConcurrency?: number
) => Promise<AnalyzeDocumentChunksResponse>;
type AnalyzeDocumentChunksModule = {
    analyzeDocumentChunks: AnalyzeDocumentChunks;
};
type CriticalFinding = {
    documentName: string;
    priority: string;
    reason: string;
};
type NotifyOnCriticalFindings = (
    documentTitle: string,
    analysisType: string,
    missingDocuments: CriticalFinding[],
    documentUrl?: string
) => Promise<boolean>;
type SlackModule = {
    notifyOnCriticalFindings: NotifyOnCriticalFindings;
};
type InngestSend = (event: PredictiveAnalysisEvent) => Promise<{ ids: string[] }>;
type InngestModule = {
    inngest: {
        send: InngestSend;
    };
};

const mockEngine: { db: unknown } = { db: undefined };
const mockAnalyzeDocumentChunks = jest.fn<
    Promise<AnalyzeDocumentChunksResponse>,
    Parameters<AnalyzeDocumentChunks>
>();
const mockInngestSend = jest.fn<Promise<{ ids: string[] }>, [PredictiveAnalysisEvent]>();
const mockNotifyOnCriticalFindings = jest.fn<
    Promise<boolean>,
    Parameters<NotifyOnCriticalFindings>
>();

jest.mock("~/server/engine", () => ({
    getEngine: jest.fn(() => mockEngine),
}));

// The predictive-analysis routes now require a Clerk session and scope the
// document to the caller's active company. Simulate a signed-in user whose
// default workspace is the seeded test company.
const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("~/lib/active-workspace", () => ({
    resolveActiveCompanyForUser: (
        _userPk: number | bigint,
        defaultCompanyId: number | bigint
    ): Promise<bigint> =>
        Promise.resolve(
            typeof defaultCompanyId === "bigint" ? defaultCompanyId : BigInt(defaultCompanyId)
        ),
}));

jest.mock(
    "~/app/api/agents/predictive-document-analysis/agent",
    (): AnalyzeDocumentChunksModule => ({
        analyzeDocumentChunks: (...args: Parameters<AnalyzeDocumentChunks>) =>
            mockAnalyzeDocumentChunks(...args),
    })
);

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: jest.fn(
        async (
            _request: unknown,
            _config: unknown,
            handler: () => Promise<unknown>
        ): Promise<unknown> => handler()
    ),
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

jest.mock("~/server/metrics/registry", () => ({
    predictiveAnalysisAiCalls: { observe: jest.fn() },
    predictiveAnalysisCacheHits: { inc: jest.fn() },
    predictiveAnalysisDuration: { startTimer: jest.fn(() => jest.fn()) },
    predictiveAnalysisRequests: { inc: jest.fn() },
}));

jest.mock(
    "~/lib/integrations/slack",
    (): SlackModule => ({
        notifyOnCriticalFindings: (...args: Parameters<NotifyOnCriticalFindings>) =>
            mockNotifyOnCriticalFindings(...args),
    })
);

jest.mock(
    "~/server/inngest/client",
    (): InngestModule => ({
        inngest: {
            send: (...args: Parameters<InngestSend>) => mockInngestSend(...args),
        },
    })
);

import { createDb, type Db } from "@launchstack/core/db";
import {
    company,
    document,
    documentContextChunks,
    documentVersions,
} from "@launchstack/core/db/schema";
import { predictiveDocumentAnalysisResults, users } from "~/server/db/schema";
import { POST as postPredictiveAnalysis } from "~/app/api/agents/predictive-document-analysis/route";
import { POST as postPredictiveAnalysisStream } from "~/app/api/agents/predictive-document-analysis/stream/route";

const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;

type CacheResult = {
    documentId: number;
    analysisType: "general";
    marker: string;
    summary: {
        totalMissingDocuments: number;
        highPriorityItems: number;
        totalRecommendations: number;
        totalInsights: number;
        totalSuggestedRelated: number;
        analysisTimestamp: string;
    };
    analysis: {
        missingDocuments: never[];
        recommendations: never[];
        insights: never[];
        suggestedRelatedDocuments: never[];
    };
    metadata: {
        pagesAnalyzed: number;
        existingDocumentsChecked: number;
        aiCalls: number;
    };
};

type SseEvent = {
    type: string;
    fromCache?: boolean;
    data?: {
        marker?: string;
        totalChunks?: number;
        fromCache?: boolean;
    };
};

function makeCacheResult(documentId: number, marker: string): CacheResult {
    return {
        documentId,
        analysisType: "general",
        marker,
        summary: {
            totalMissingDocuments: 0,
            highPriorityItems: 0,
            totalRecommendations: 0,
            totalInsights: 0,
            totalSuggestedRelated: 0,
            analysisTimestamp: new Date(0).toISOString(),
        },
        analysis: {
            missingDocuments: [],
            recommendations: [],
            insights: [],
            suggestedRelatedDocuments: [],
        },
        metadata: {
            pagesAnalyzed: 1,
            existingDocumentsChecked: 0,
            aiCalls: 0,
        },
    };
}

function requestFor(body: Record<string, unknown>): Request {
    return new Request("http://localhost/api/agents/predictive-document-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

function decodeSseEvent(value: Uint8Array): SseEvent {
    const frame = new TextDecoder().decode(value);
    const dataLine = frame.split("\n").find(line => line.startsWith("data: "));
    if (!dataLine) throw new Error(`Expected an SSE data event, received: ${frame}`);
    return JSON.parse(dataLine.slice("data: ".length)) as SseEvent;
}

async function readFirstSseEvent(response: Response): Promise<SseEvent> {
    const body = await response.text();
    const dataLine = body.split("\n").find(line => line.startsWith("data: "));
    if (!dataLine) throw new Error(`Expected an SSE data event, received: ${body}`);
    return JSON.parse(dataLine.slice("data: ".length)) as SseEvent;
}

integrationDescribe("predictive analysis cache versioning (database)", () => {
    let integrationDb: Db | undefined;
    let companyId: number | undefined;
    let documentId: number | undefined;
    let version1Id: bigint | undefined;
    let version2Id: bigint | undefined;
    let testUserPk: number | undefined;

    beforeEach(async () => {
        mockAnalyzeDocumentChunks.mockReset();
        mockInngestSend.mockReset().mockResolvedValue({ ids: ["predictive-cache-test-event"] });
        mockNotifyOnCriticalFindings.mockReset().mockResolvedValue(false);

        if (!process.env.DATABASE_URL) return;

        integrationDb = createDb({ url: process.env.DATABASE_URL, maxConnections: 4 });
        mockEngine.db = integrationDb.db;

        const suffix = randomUUID();
        const [companyRow] = await integrationDb.db
            .insert(company)
            .values({
                name: `predictive-cache-test-${suffix}`,
                slug: `predictive-cache-${suffix.slice(0, 24)}`,
                numberOfEmployees: "1",
            })
            .returning({ id: company.id });
        if (!companyRow) throw new Error("Failed to create predictive cache test company");
        companyId = companyRow.id;

        // Seed a session user for the auth check on the routes under test.
        mockClerk.userId = `predictive-cache-user-${suffix}`;
        const [userRow] = await integrationDb.db
            .insert(users)
            .values({
                name: "Predictive Cache Tester",
                email: `predictive-cache-${suffix}@example.test`,
                userId: mockClerk.userId,
                companyId: BigInt(companyId),
                role: "employer",
                status: "approved",
            })
            .returning({ id: users.id });
        if (!userRow) throw new Error("Failed to create predictive cache test user");
        testUserPk = userRow.id;

        const [documentRow] = await integrationDb.db
            .insert(document)
            .values({
                url: "https://example.test/predictive-cache.pdf",
                category: "integration",
                title: "Predictive cache integration document",
                companyId: BigInt(companyId),
                mimeType: "application/pdf",
                creationKey: `predictive-cache-${suffix}`,
            })
            .returning({ id: document.id });
        if (!documentRow) throw new Error("Failed to create predictive cache test document");
        documentId = documentRow.id;

        const [version1] = await integrationDb.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(documentId),
                versionNumber: 1,
                url: "https://example.test/predictive-cache-v1.pdf",
                mimeType: "application/pdf",
                uploadedBy: "predictive-cache-integration-test",
            })
            .returning({ id: documentVersions.id });
        const [version2] = await integrationDb.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(documentId),
                versionNumber: 2,
                url: "https://example.test/predictive-cache-v2.pdf",
                mimeType: "application/pdf",
                uploadedBy: "predictive-cache-integration-test",
            })
            .returning({ id: documentVersions.id });
        if (!version1 || !version2) throw new Error("Failed to create predictive cache versions");

        version1Id = BigInt(version1.id);
        version2Id = BigInt(version2.id);

        await integrationDb.db
            .update(document)
            .set({ currentVersionId: version2Id })
            .where(eq(document.id, documentId));

        await integrationDb.db.insert(documentContextChunks).values([
            {
                documentId: BigInt(documentId),
                versionId: version1Id,
                content: "stale v1 chunk",
                pageNumber: 1,
            },
            {
                documentId: BigInt(documentId),
                versionId: version2Id,
                content: "current v2 chunk",
                pageNumber: 2,
            },
            {
                documentId: BigInt(documentId),
                versionId: null,
                content: "legacy unversioned chunk",
                pageNumber: 3,
            },
        ]);

        const now = Date.now();
        await integrationDb.db.insert(predictiveDocumentAnalysisResults).values([
            {
                documentId: BigInt(documentId),
                versionId: version2Id,
                analysisType: "general",
                includeRelatedDocs: false,
                resultJson: makeCacheResult(documentId, "v2"),
                createdAt: new Date(now - 3_000),
            },
            {
                documentId: BigInt(documentId),
                versionId: version1Id,
                analysisType: "general",
                includeRelatedDocs: false,
                resultJson: makeCacheResult(documentId, "v1"),
                createdAt: new Date(now - 2_000),
            },
            {
                documentId: BigInt(documentId),
                versionId: null,
                analysisType: "general",
                includeRelatedDocs: false,
                resultJson: makeCacheResult(documentId, "legacy-null"),
                createdAt: new Date(now - 1_000),
            },
        ]);
    });

    afterEach(async () => {
        const database = integrationDb;
        const cleanupDocumentId = documentId;
        const cleanupCompanyId = companyId;
        const cleanupUserPk = testUserPk;
        integrationDb = undefined;
        mockEngine.db = undefined;
        documentId = undefined;
        companyId = undefined;
        version1Id = undefined;
        version2Id = undefined;
        testUserPk = undefined;
        mockClerk.userId = null;

        if (!database) return;

        try {
            if (cleanupUserPk !== undefined) {
                await database.db.delete(users).where(eq(users.id, cleanupUserPk));
            }
            if (cleanupDocumentId !== undefined) {
                await database.db
                    .delete(predictiveDocumentAnalysisResults)
                    .where(
                        eq(predictiveDocumentAnalysisResults.documentId, BigInt(cleanupDocumentId))
                    );
                await database.db
                    .delete(documentContextChunks)
                    .where(eq(documentContextChunks.documentId, BigInt(cleanupDocumentId)));
                await database.db
                    .delete(documentVersions)
                    .where(eq(documentVersions.documentId, BigInt(cleanupDocumentId)));
                await database.db.delete(document).where(eq(document.id, cleanupDocumentId));
            }
            if (cleanupCompanyId !== undefined) {
                await database.db.delete(company).where(eq(company.id, cleanupCompanyId));
            }
        } finally {
            await database.close();
        }
    });

    it("returns only the current-version HTTP and SSE cache after a pointer flip", async () => {
        if (documentId === undefined || version1Id === undefined || version2Id === undefined) {
            throw new Error("Predictive cache fixture was not initialized");
        }
        const database = integrationDb;
        if (!database) throw new Error("DATABASE_URL is required for this integration test");

        const seededRows = await database.db
            .select({ versionId: predictiveDocumentAnalysisResults.versionId })
            .from(predictiveDocumentAnalysisResults)
            .where(eq(predictiveDocumentAnalysisResults.documentId, BigInt(documentId)));
        expect(seededRows).toHaveLength(3);
        expect(seededRows.map(row => row.versionId).sort()).toEqual(
            [null, version1Id, version2Id].sort()
        );

        const httpV2Response = await postPredictiveAnalysis(
            requestFor({ documentId, analysisType: "general", includeRelatedDocs: false })
        );
        expect(httpV2Response.status).toBe(200);
        const httpV2 = (await httpV2Response.json()) as { fromCache?: boolean; marker?: string };
        expect(httpV2).toMatchObject({ fromCache: true, marker: "v2" });
        expect(httpV2.marker).not.toBe("legacy-null");

        const sseV2 = await readFirstSseEvent(
            await postPredictiveAnalysisStream(
                requestFor({ documentId, analysisType: "general", includeRelatedDocs: false })
            )
        );
        expect(sseV2).toMatchObject({
            type: "result",
            fromCache: true,
            data: { marker: "v2" },
        });
        expect(sseV2.data?.marker).not.toBe("legacy-null");

        await database.db
            .update(document)
            .set({ currentVersionId: version1Id })
            .where(eq(document.id, documentId));

        const httpV1Response = await postPredictiveAnalysis(
            requestFor({ documentId, analysisType: "general", includeRelatedDocs: false })
        );
        expect(httpV1Response.status).toBe(200);
        const httpV1 = (await httpV1Response.json()) as { fromCache?: boolean; marker?: string };
        expect(httpV1).toMatchObject({ fromCache: true, marker: "v1" });
        expect(httpV1.marker).not.toBe("legacy-null");

        const sseV1 = await readFirstSseEvent(
            await postPredictiveAnalysisStream(
                requestFor({ documentId, analysisType: "general", includeRelatedDocs: false })
            )
        );
        expect(sseV1).toMatchObject({
            type: "result",
            fromCache: true,
            data: { marker: "v1" },
        });
        expect(sseV1.data?.marker).not.toBe("legacy-null");
    });

    it("requires a post-dispatch current-version cache result for force-refresh SSE", async () => {
        if (documentId === undefined || version2Id === undefined) {
            throw new Error("Predictive cache fixture was not initialized");
        }
        const database = integrationDb;
        if (!database) throw new Error("DATABASE_URL is required for this integration test");

        mockAnalyzeDocumentChunks.mockResolvedValueOnce({
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
                averageChunkLength: 16,
                totalChunks: 1,
            },
        });

        const freshHttpResponse = await postPredictiveAnalysis(
            requestFor({ documentId, forceRefresh: true })
        );
        expect(freshHttpResponse.status).toBe(200);
        expect(mockAnalyzeDocumentChunks).toHaveBeenCalledTimes(1);

        const [freshRow] = await database.db
            .select({ versionId: predictiveDocumentAnalysisResults.versionId })
            .from(predictiveDocumentAnalysisResults)
            .where(eq(predictiveDocumentAnalysisResults.documentId, BigInt(documentId)))
            .orderBy(desc(predictiveDocumentAnalysisResults.id))
            .limit(1);
        expect(freshRow?.versionId).toBe(version2Id);

        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            const streamResponse = await postPredictiveAnalysisStream(
                requestFor({ documentId, forceRefresh: true, timeoutMs: 5_000 })
            );
            reader = streamResponse.body?.getReader();
            if (!reader) throw new Error("Predictive SSE response did not provide a body");

            const firstRead = await reader.read();
            if (!firstRead.value) throw new Error("Predictive SSE response was empty");
            const firstEvent = decodeSseEvent(firstRead.value);
            expect(firstEvent).toMatchObject({
                type: "status",
                data: { phase: "queued", totalChunks: 1 },
            });

            const resultReadPromise = reader.read();
            await database.db.insert(predictiveDocumentAnalysisResults).values({
                documentId: BigInt(documentId),
                versionId: version2Id,
                analysisType: "general",
                includeRelatedDocs: false,
                resultJson: makeCacheResult(documentId, "post-dispatch"),
            });

            const resultRead = await resultReadPromise;
            if (!resultRead.value) throw new Error("Predictive SSE response did not finish");
            const resultEvent = decodeSseEvent(resultRead.value);
            expect(resultEvent).toMatchObject({
                type: "result",
                data: { marker: "post-dispatch", fromCache: false },
            });
            expect(resultEvent.data?.marker).not.toBe("v2");

            const endRead = await reader.read();
            expect(endRead.done).toBe(true);
        } finally {
            if (reader) await reader.cancel();
        }

        expect(mockInngestSend).toHaveBeenCalledTimes(1);
    }, 15_000);

    it("bounds force-refresh SSE polling by timeoutMs", async () => {
        if (documentId === undefined) {
            throw new Error("Predictive cache fixture was not initialized");
        }

        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            const streamResponse = await postPredictiveAnalysisStream(
                requestFor({ documentId, forceRefresh: true, timeoutMs: 1_000 })
            );
            reader = streamResponse.body?.getReader();
            if (!reader) throw new Error("Predictive SSE response did not provide a body");

            const firstRead = await reader.read();
            if (!firstRead.value) throw new Error("Predictive SSE response was empty");
            expect(decodeSseEvent(firstRead.value)).toMatchObject({
                type: "status",
                data: { phase: "queued", totalChunks: 1 },
            });

            const timeoutStart = Date.now();
            const timeoutRead = await reader.read();
            const elapsedMs = Date.now() - timeoutStart;
            if (!timeoutRead.value) throw new Error("Predictive SSE timeout response was empty");
            expect(decodeSseEvent(timeoutRead.value)).toMatchObject({ type: "error" });
            expect(elapsedMs).toBeLessThan(2_500);
        } finally {
            if (reader) await reader.cancel();
        }

        expect(mockInngestSend).toHaveBeenCalledTimes(1);
    }, 15_000);
});
