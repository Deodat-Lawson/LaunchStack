import type * as CoreDb from "@launchstack/core/db";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const coreDb = jest.requireActual<typeof CoreDb>("@launchstack/core/db");
    const engineDb = databaseUrl
        ? coreDb.createDb({
              url: databaseUrl,
              maxConnections: 10,
          }).db
        : undefined;
    // Register the engine's getDb() slot exactly like createEngine would —
    // the moved retrievers/lifecycle read it, not the ~/server/db proxy.
    if (engineDb) coreDb.configureDatabase(engineDb);

    return {
        getEngine: jest.fn(() => ({ db: engineDb })),
    };
});

import type { EmbeddingIndexConfig } from "@launchstack/core/embeddings";
import {
    company,
    document,
    documentContextChunks,
    documentEmbeddings768,
    documentMetadata,
    documentRetrievalChunks,
    documentVersions,
} from "@launchstack/core/db/schema";
import { createDocumentVectorRetriever } from "~/lib/tools/rag/retrievers/vector-retriever";
import { db } from "~/server/db/index";

const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;

const legacyIndex: EmbeddingIndexConfig = {
    indexKey: "test-legacy-index",
    provider: "openai",
    model: "test-model",
    dimension: 1536,
    enabled: true,
    storageKind: "legacy",
    version: "test",
};

const dimensionTableIndex: EmbeddingIndexConfig = {
    indexKey: "test-dimension-index",
    provider: "openai",
    model: "test-model",
    dimension: 768,
    enabled: true,
    storageKind: "dimension_table",
    version: "test",
};

function vector(dimension: number): number[] {
    const result = Array<number>(dimension).fill(0);
    result[0] = 1;
    return result;
}

const legacyEmbedding = vector(1536);
const dimensionEmbedding = vector(768);

integrationDescribe("VectorRetriever current-version joins (database)", () => {
    let seededCompanyId: number | undefined;
    let seededDocumentId: number | undefined;

    afterEach(async () => {
        if (seededDocumentId !== undefined) {
            await db.delete(document).where(eq(document.id, seededDocumentId));
        }
        if (seededCompanyId !== undefined) {
            await db.delete(company).where(eq(company.id, seededCompanyId));
        }
        seededDocumentId = undefined;
        seededCompanyId = undefined;
    });

    it("hides stale context and metadata in legacy, fallback, and dimension retrieval", async () => {
        const suffix = randomUUID();
        const [companyRow] = await db
            .insert(company)
            .values({
                name: `Vector version test ${suffix}`,
                numberOfEmployees: "1",
            })
            .returning({ id: company.id });
        if (!companyRow) throw new Error("Failed to seed vector test company");
        seededCompanyId = companyRow.id;

        const [documentRow] = await db
            .insert(document)
            .values({
                url: `https://example.test/${suffix}`,
                category: "test",
                title: "Versioned vector fixture",
                companyId: BigInt(companyRow.id),
            })
            .returning({ id: document.id });
        if (!documentRow) throw new Error("Failed to seed vector test document");
        seededDocumentId = documentRow.id;

        const [versionOne] = await db
            .insert(documentVersions)
            .values({
                documentId: BigInt(documentRow.id),
                versionNumber: 1,
                url: `https://example.test/${suffix}/v1`,
                mimeType: "text/plain",
            })
            .returning({ id: documentVersions.id });
        const [versionTwo] = await db
            .insert(documentVersions)
            .values({
                documentId: BigInt(documentRow.id),
                versionNumber: 2,
                url: `https://example.test/${suffix}/v2`,
                mimeType: "text/plain",
            })
            .returning({ id: documentVersions.id });
        if (!versionOne || !versionTwo) throw new Error("Failed to seed vector test versions");

        await db
            .update(document)
            .set({ currentVersionId: BigInt(versionTwo.id) })
            .where(eq(document.id, documentRow.id));

        const [staleContext] = await db
            .insert(documentContextChunks)
            .values({
                documentId: BigInt(documentRow.id),
                versionId: BigInt(versionOne.id),
                content: "stale parent context",
                pageNumber: 1,
                embedding: legacyEmbedding,
            })
            .returning({ id: documentContextChunks.id });
        const [currentContext] = await db
            .insert(documentContextChunks)
            .values({
                documentId: BigInt(documentRow.id),
                versionId: BigInt(versionTwo.id),
                content: "current parent context",
                pageNumber: 2,
                embedding: legacyEmbedding,
            })
            .returning({ id: documentContextChunks.id });
        if (!staleContext || !currentContext) throw new Error("Failed to seed vector contexts");

        const [staleParentRetrieval] = await db
            .insert(documentRetrievalChunks)
            .values({
                documentId: BigInt(documentRow.id),
                versionId: BigInt(versionTwo.id),
                contextChunkId: BigInt(staleContext.id),
                content: "child with stale parent",
                embedding: legacyEmbedding,
            })
            .returning({ id: documentRetrievalChunks.id });
        const [currentRetrieval] = await db
            .insert(documentRetrievalChunks)
            .values({
                documentId: BigInt(documentRow.id),
                versionId: BigInt(versionTwo.id),
                contextChunkId: BigInt(currentContext.id),
                content: "current child",
                embedding: legacyEmbedding,
            })
            .returning({ id: documentRetrievalChunks.id });
        if (!staleParentRetrieval || !currentRetrieval) {
            throw new Error("Failed to seed vector retrieval chunks");
        }

        await db.insert(documentMetadata).values({
            documentId: BigInt(documentRow.id),
            versionId: BigInt(versionOne.id),
            documentClass: "contract",
        });

        const legacyEmbeddings = {
            embedQuery: jest.fn().mockResolvedValue(legacyEmbedding),
        };
        const legacyRetriever = createDocumentVectorRetriever(
            documentRow.id,
            legacyEmbeddings,
            legacyIndex
        );
        const fullDocuments = await legacyRetriever.invoke("which version is live?");

        expect(fullDocuments).toHaveLength(1);
        expect(fullDocuments[0]?.pageContent).toBe("current parent context");
        expect(fullDocuments[0]?.metadata.childContent).toBe("current child");

        await db
            .update(documentRetrievalChunks)
            .set({ embedding: null })
            .where(eq(documentRetrievalChunks.documentId, BigInt(documentRow.id)));

        const fallbackDocuments = await createDocumentVectorRetriever(
            documentRow.id,
            legacyEmbeddings,
            legacyIndex
        ).invoke("which version is live?");
        expect(fallbackDocuments.map(result => result.pageContent)).toEqual([
            "current parent context",
        ]);

        const filteredFallbackDocuments = await createDocumentVectorRetriever(
            documentRow.id,
            legacyEmbeddings,
            legacyIndex,
            8,
            { documentClass: "contract" }
        ).invoke("which version is live?");
        expect(filteredFallbackDocuments).toHaveLength(0);

        await db.insert(documentEmbeddings768).values([
            {
                documentId: BigInt(documentRow.id),
                retrievalChunkId: BigInt(staleParentRetrieval.id),
                indexKey: dimensionTableIndex.indexKey,
                provider: "test",
                model: "test-model",
                version: "test",
                embedding: dimensionEmbedding,
            },
            {
                documentId: BigInt(documentRow.id),
                retrievalChunkId: BigInt(currentRetrieval.id),
                indexKey: dimensionTableIndex.indexKey,
                provider: "test",
                model: "test-model",
                version: "test",
                embedding: dimensionEmbedding,
            },
        ]);

        const dimensionEmbeddings = {
            embedQuery: jest.fn().mockResolvedValue(dimensionEmbedding),
        };
        const dimensionDocuments = await createDocumentVectorRetriever(
            documentRow.id,
            dimensionEmbeddings,
            dimensionTableIndex
        ).invoke("which version is live?");
        expect(dimensionDocuments).toHaveLength(1);
        expect(dimensionDocuments[0]?.pageContent).toBe("current parent context");

        const filteredDimensionDocuments = await createDocumentVectorRetriever(
            documentRow.id,
            dimensionEmbeddings,
            dimensionTableIndex,
            8,
            { documentClass: "contract" }
        ).invoke("which version is live?");
        expect(filteredDimensionDocuments).toHaveLength(0);
    });
});
