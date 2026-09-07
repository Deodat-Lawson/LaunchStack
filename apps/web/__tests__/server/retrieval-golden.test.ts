/**
 * Golden retrieval tests (database).
 *
 * A fixed corpus, a fixed query set, deterministic embeddings — the ensemble
 * search's top results are pinned here so a move or "cleanup" that shifts
 * relevance behavior fails loudly instead of drifting silently. If a change
 * legitimately improves ranking, update the goldens in the same commit and
 * say why.
 */

import type * as CoreDb from "@launchstack/store/client";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const coreDb = jest.requireActual<typeof CoreDb>("@launchstack/store/client");
    const engineDb = databaseUrl
        ? coreDb.createDb({
              url: databaseUrl,
              maxConnections: 10,
          }).db
        : undefined;
    if (engineDb) coreDb.configureDatabase(engineDb);

    return {
        getEngine: jest.fn(() => ({ db: engineDb })),
    };
});

import type { EmbeddingsProvider } from "@launchstack/llm/embeddings";
import {
    company,
    document,
    documentContextChunks,
    documentRetrievalChunks,
    documentSections,
    documentVersions,
} from "@launchstack/store/schema";
import { documentEnsembleSearch } from "@launchstack/retrieval/algorithms/ensemble";
import { createDocumentVectorRetriever } from "@launchstack/retrieval/algorithms/vector";
import { resolveEmbeddingIndex } from "@launchstack/llm/embeddings";
import { db } from "~/server/db/index";

const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;

/** One-hot 1536-dim vector — cosine distance is 0 to itself, 1 to any other axis. */
function axis(i: number): number[] {
    const v = Array<number>(1536).fill(0);
    v[i] = 1;
    return v;
}

const CHUNKS = [
    { axisIndex: 0, page: 1, content: "alpha section mentions the invoice once" },
    { axisIndex: 1, page: 2, content: "payment terms for the invoice are net thirty days" },
    { axisIndex: 2, page: 3, content: "charlie section about an unrelated appendix" },
] as const;

/** Deterministic embedder: every query lands exactly on axis 1 (chunk 2). */
const stubEmbeddings: EmbeddingsProvider = {
    embedQuery: async () => axis(1),
    embedDocuments: async docs => docs.map(() => axis(1)),
};

integrationDescribe("Golden ensemble retrieval (database)", () => {
    let seededCompanyId: number | undefined;
    let seededDocumentId: number | undefined;

    afterAll(async () => {
        if (seededDocumentId !== undefined) {
            await db.delete(document).where(eq(document.id, seededDocumentId));
        }
        if (seededCompanyId !== undefined) {
            await db.delete(company).where(eq(company.id, seededCompanyId));
        }
    });

    beforeAll(async () => {
        const suffix = randomUUID();
        const [companyRow] = await db
            .insert(company)
            .values({ name: `Golden retrieval ${suffix}`, numberOfEmployees: "1" })
            .returning({ id: company.id });
        if (!companyRow) throw new Error("Failed to seed golden company");
        seededCompanyId = companyRow.id;

        const [documentRow] = await db
            .insert(document)
            .values({
                url: `https://example.test/golden/${suffix}`,
                category: "test",
                title: "Golden retrieval fixture",
                companyId: BigInt(companyRow.id),
            })
            .returning({ id: document.id });
        if (!documentRow) throw new Error("Failed to seed golden document");
        seededDocumentId = documentRow.id;

        const [version] = await db
            .insert(documentVersions)
            .values({
                documentId: BigInt(documentRow.id),
                versionNumber: 1,
                url: `https://example.test/golden/${suffix}/v1`,
                mimeType: "text/plain",
            })
            .returning({ id: documentVersions.id });
        if (!version) throw new Error("Failed to seed golden version");

        await db
            .update(document)
            .set({ currentVersionId: BigInt(version.id) })
            .where(eq(document.id, documentRow.id));

        for (const chunk of CHUNKS) {
            // BM25 leg reads documentSections; vector leg reads the retrieval
            // chunks via their parent context chunk. Seed both sides.
            await db.insert(documentSections).values({
                documentId: BigInt(documentRow.id),
                versionId: BigInt(version.id),
                content: chunk.content,
                pageNumber: chunk.page,
                embedding: axis(chunk.axisIndex),
            });

            const [context] = await db
                .insert(documentContextChunks)
                .values({
                    documentId: BigInt(documentRow.id),
                    versionId: BigInt(version.id),
                    content: chunk.content,
                    pageNumber: chunk.page,
                    embedding: axis(chunk.axisIndex),
                })
                .returning({ id: documentContextChunks.id });
            if (!context) throw new Error("Failed to seed golden context chunk");

            await db.insert(documentRetrievalChunks).values({
                documentId: BigInt(documentRow.id),
                versionId: BigInt(version.id),
                contextChunkId: BigInt(context.id),
                content: chunk.content,
                embedding: axis(chunk.axisIndex),
                embeddingShort: axis(chunk.axisIndex).slice(0, 512),
            });
        }
    });

    it("golden: 'invoice payment terms' ranks the payment-terms chunk first in document scope", async () => {
        const results = await documentEnsembleSearch(
            "invoice payment terms",
            {
                documentId: seededDocumentId!,
                topK: 3,
                embeddingIndexKey: "legacy-openai-1536",
            },
            stubEmbeddings
        );

        expect(results.length).toBeGreaterThan(0);
        // Both legs agree on chunk 2: BM25 because it carries the most query
        // terms, vector because the stub query embedding sits on its axis.
        expect(results[0]?.pageContent).toBe(CHUNKS[1].content);
        // Every hit comes from the seeded corpus — nothing leaks across scope.
        const corpus = new Set<string>(CHUNKS.map(c => c.content));
        for (const hit of results) {
            expect(corpus.has(hit.pageContent)).toBe(true);
        }
    });

    it("golden: RRF rewards cross-leg agreement over a single leg's top rank", async () => {
        // "section" matches chunks 1 and 3 lexically; the stub embedding puts
        // every query on chunk 2's axis. Chunk 1 appears in BOTH legs' lists
        // while chunk 2 appears only in the vector list, so fusion ranks
        // chunk 1 first — pinning the agreement-beats-solo-rank property of
        // weighted RRF (k=60, weights [0.4, 0.6]).
        const results = await documentEnsembleSearch(
            "section",
            {
                documentId: seededDocumentId!,
                topK: 3,
                embeddingIndexKey: "legacy-openai-1536",
            },
            stubEmbeddings
        );

        expect(results[0]?.pageContent).toBe(CHUNKS[0].content);
    });

    it("golden: the vector leg the ensemble builds is alive against the registry index", async () => {
        // Same construction the ensemble uses internally: the registered
        // legacy index, the stub embedder, the seeded retrieval chunks. The
        // stub query sits on chunk 2's axis, so a live vector leg must rank
        // it first — a dead leg (wrong table, wrong join, wrong dimension)
        // returns something else or nothing.
        const retriever = createDocumentVectorRetriever(
            seededDocumentId!,
            stubEmbeddings,
            resolveEmbeddingIndex("legacy-openai-1536"),
            3
        );
        const docs = await retriever.getRelevantDocuments("anything");

        expect(docs.length).toBeGreaterThan(0);
        expect(docs[0]?.pageContent).toBe(CHUNKS[1].content);
    });

    it("golden: retrieval is non-empty on the seeded corpus (the silent-death canary)", async () => {
        // The worst retrieval failure is empty-context-not-error. This canary
        // exists so a broken leg composition or port wiring cannot pass CI by
        // returning [] — see the design's §6/§7.
        const results = await documentEnsembleSearch(
            "appendix",
            {
                documentId: seededDocumentId!,
                topK: 2,
                embeddingIndexKey: "legacy-openai-1536",
            },
            stubEmbeddings
        );
        expect(results.length).toBeGreaterThan(0);
    });
});
