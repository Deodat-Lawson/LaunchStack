/**
 * Replay pin for the indexing stage (ADR-003 idempotency). The outbox worker
 * re-runs `evidence.version.extracted` whole on retry and on operator
 * replay, so running the stage twice for one version, or once after a
 * partial first attempt, must leave exactly one copy of every structure
 * node, context chunk and retrieval chunk. Before `resetVersionIndex` every
 * re-run appended a second copy of each.
 *
 * Runs against a real Postgres (TEST_DATABASE_URL, falling back to
 * DATABASE_URL). Only the embedding model is replaced, with a deterministic
 * local one so the stage runs offline; chunking, structure, storage and
 * finalize are the production code.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";
import {
    documentContextChunks,
    documentEmbeddings768,
    documentRetrievalChunks,
    documentStructure,
    ocrJobs,
} from "@launchstack/store/schema";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
} from "@launchstack/orchestration";
import type { PageContent } from "@launchstack/conversion/ocr/types";
import { chunkPages, createStructureTree, storeBatch } from "@launchstack/conversion/ocr/processor";
import { mergeWithEmbeddings, prepareForEmbedding } from "@launchstack/conversion/ocr/chunker";
import { resolveEmbeddingIndex } from "@launchstack/llm/embeddings";
import type * as EmbeddingsModule from "@launchstack/llm/embeddings";

import { runIndexingStage, type ExtractionStageSummary } from "../src/doc-ingestion";
import type { DocIngestionToolInput } from "../src/doc-ingestion/types";

const { fakeEmbeddings, vectorFor } = vi.hoisted(() => {
    // A deterministic vector from the text: the same chunk always embeds the
    // same way, and distinct chunks differ, without any network call.
    function vectorFor(text: string, dimension: number): number[] {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        const out = new Array<number>(dimension);
        for (let i = 0; i < dimension; i++) {
            h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
            out[i] = ((h % 2000) - 1000) / 1000;
        }
        return out;
    }
    function fakeEmbeddings(dimension: number) {
        return {
            embedDocuments: async (texts: string[]) => texts.map(t => vectorFor(t, dimension)),
            embedQuery: async (text: string) => vectorFor(text, dimension),
        };
    }
    return { fakeEmbeddings, vectorFor };
});

vi.mock("@launchstack/llm/embeddings", async importOriginal => {
    const actual = await importOriginal<typeof EmbeddingsModule>();
    return {
        ...actual,
        createEmbeddingModel: (index: { dimension: number }) =>
            fakeEmbeddings(index.dimension) as never,
    };
});

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

function paragraph(seed: number, sentences = 12): string {
    const parts: string[] = [];
    for (let i = 0; i < sentences; i++) {
        parts.push(
            `Clause ${seed}.${i} states that the replay guarantee holds for every ` +
                `stage of the pipeline and names item ${seed * 100 + i} as evidence.`
        );
    }
    return parts.join(" ");
}

/** Three pages with headings, enough text for several parents and children. */
function samplePages(): PageContent[] {
    return [1, 2, 3].map(page => ({
        pageNumber: page,
        textBlocks: [
            `# Section ${page}`,
            paragraph(page * 10 + 1),
            paragraph(page * 10 + 2),
            `## Section ${page}.1`,
            paragraph(page * 10 + 3),
            paragraph(page * 10 + 4),
        ],
        tables: [],
    }));
}

const extraction: ExtractionStageSummary = {
    provider: "NATIVE_PDF",
    pageCount: 3,
    processingTimeMs: 5,
    confidenceScore: 0.9,
    usedFastTextPath: true,
};

interface Counts {
    structureNodes: number;
    contextChunks: number;
    retrievalChunks: number;
    duplicateContextChunks: number;
}

describe.skipIf(!url)("indexing stage replay (integration)", () => {
    let handle: Db;
    let companyId: bigint;
    const jobIds: string[] = [];

    beforeAll(async () => {
        handle = createDb({ url: url! });
        configureDatabase(handle.db);
        const rows = await handle.client`
      INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
      VALUES ('index-replay-test-co', '1') RETURNING id
    `;
        companyId = BigInt(rows[0]!.id as number);
    });

    afterAll(async () => {
        if (!handle) return;
        await handle.client`DELETE FROM pdr_ai_v2_event_outbox WHERE company_id = ${String(companyId)}`;
        await handle.client`DELETE FROM pdr_ai_v2_company WHERE id = ${String(companyId)}`;
        for (const jobId of jobIds) {
            await handle.client`DELETE FROM pdr_ai_v2_ocr_jobs WHERE id = ${jobId}`;
        }
        await handle.close();
    });

    async function seedPipelineState(jobId: string): Promise<void> {
        jobIds.push(jobId);
        await handle.db
            .update(ocrJobs)
            .set({ ocrResult: { pages: samplePages(), extraction } })
            .where(eq(ocrJobs.id, jobId));
    }

    async function newDocument(name: string) {
        const created = await createDocumentLifecycle({
            companyId,
            userId: "user_test",
            title: name,
            category: "General",
            url: `/api/files/${name}`,
            creationKey: `upload:/api/files/${name}`,
            mimeType: "text/plain",
            processing: { originalFilename: name },
        });
        await seedPipelineState(created.jobId!);
        return {
            documentId: created.documentId,
            versionId: created.versionId,
            jobId: created.jobId!,
        };
    }

    function stageInput(
        doc: { documentId: number; versionId: number; jobId: string },
        name: string,
        embeddingIndexKey?: string
    ): DocIngestionToolInput {
        return {
            jobId: doc.jobId,
            documentUrl: `/api/files/${name}`,
            documentName: name,
            companyId: String(companyId),
            userId: "user_test",
            documentId: doc.documentId,
            category: "General",
            mimeType: "text/plain",
            originalFilename: name,
            versionId: doc.versionId,
            options: embeddingIndexKey ? { embeddingIndexKey } : undefined,
        };
    }

    async function count(table: typeof documentStructure, documentId: number, versionId: number) {
        const [row] = await handle.db
            .select({ n: sql<number>`count(*)::int` })
            .from(table)
            .where(
                and(
                    eq(table.documentId, BigInt(documentId)),
                    eq(table.versionId, BigInt(versionId))
                )
            );
        return row!.n;
    }

    async function versionCounts(documentId: number, versionId: number): Promise<Counts> {
        const [dupes] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(
            handle.db
                .select({ content: documentContextChunks.content })
                .from(documentContextChunks)
                .where(
                    and(
                        eq(documentContextChunks.documentId, BigInt(documentId)),
                        eq(documentContextChunks.versionId, BigInt(versionId))
                    )
                )
                .groupBy(documentContextChunks.content)
                .having(sql`count(*) > 1`)
                .as("dupes")
        );
        return {
            structureNodes: await count(documentStructure, documentId, versionId),
            contextChunks: await count(
                documentContextChunks as unknown as typeof documentStructure,
                documentId,
                versionId
            ),
            retrievalChunks: await count(
                documentRetrievalChunks as unknown as typeof documentStructure,
                documentId,
                versionId
            ),
            duplicateContextChunks: dupes!.n,
        };
    }

    it("running the stage twice leaves one copy of every row", async () => {
        const doc = await newDocument("replay-twice.txt");
        const input = stageInput(doc, "replay-twice.txt");

        const first = await runIndexingStage(input);
        const afterFirst = await versionCounts(doc.documentId, doc.versionId);
        expect(afterFirst.contextChunks).toBeGreaterThan(1);
        expect(afterFirst.retrievalChunks).toBeGreaterThanOrEqual(afterFirst.contextChunks);
        expect(afterFirst.structureNodes).toBeGreaterThanOrEqual(1);
        expect(afterFirst.duplicateContextChunks).toBe(0);
        expect(first.contextChunkCount).toBe(afterFirst.contextChunks);
        expect(first.retrievalChunkCount).toBe(afterFirst.retrievalChunks);

        // The outbox replays the same event; the stage must converge.
        const second = await runIndexingStage(input);
        const afterSecond = await versionCounts(doc.documentId, doc.versionId);
        expect(afterSecond).toEqual(afterFirst);
        expect(second.contextChunkCount).toBe(first.contextChunkCount);
        expect(second.retrievalChunkCount).toBe(first.retrievalChunkCount);

        // And the stored vectors are the fresh run's, not a stale half.
        const [sample] = await handle.db
            .select({
                content: documentRetrievalChunks.content,
                embedding: documentRetrievalChunks.embedding,
            })
            .from(documentRetrievalChunks)
            .where(
                and(
                    eq(documentRetrievalChunks.documentId, BigInt(doc.documentId)),
                    eq(documentRetrievalChunks.versionId, BigInt(doc.versionId))
                )
            )
            .limit(1);
        expect(sample!.embedding?.slice(0, 4)).toEqual(
            vectorFor(sample!.content, 1536).slice(0, 4)
        );
    });

    it("a partial first attempt is cleared, not appended to", async () => {
        const doc = await newDocument("replay-partial.txt");
        const clean = await runIndexingStage(stageInput(doc, "replay-partial.txt"));
        const cleanCounts = await versionCounts(doc.documentId, doc.versionId);

        // A second version of the same source, whose first attempt died after
        // the structure tree and the first embedding batch were written.
        const superseded = await createDocumentVersionLifecycle({
            documentId: doc.documentId,
            companyId,
            userId: "user_test",
            title: "replay-partial.txt",
            category: "General",
            url: "/api/files/replay-partial-v2",
            creationKey: "upload:/api/files/replay-partial-v2",
            mimeType: "text/plain",
        });
        await seedPipelineState(superseded.jobId);
        const v2 = {
            documentId: doc.documentId,
            versionId: superseded.versionId,
            jobId: superseded.jobId,
        };

        const index = resolveEmbeddingIndex();
        const chunks = await chunkPages(samplePages(), "replay-partial.txt", {
            documentTitle: "replay-partial.txt",
            embeddingModel: index.model,
        });
        const structure = await createStructureTree(doc.documentId, 3, v2.versionId, chunks);
        const firstParent = chunks.slice(0, 1);
        const vectors = prepareForEmbedding(firstParent).map(t => vectorFor(t, index.dimension));
        await storeBatch(
            doc.documentId,
            structure,
            mergeWithEmbeddings(firstParent, vectors, {
                shortDimension: index.shortDimension,
                supportsMatryoshka: true,
            }),
            index,
            v2.versionId
        );
        const partial = await versionCounts(doc.documentId, v2.versionId);
        expect(partial.contextChunks).toBe(1);
        expect(partial.structureNodes).toBe(cleanCounts.structureNodes);

        // The retry runs the whole stage again over the same pages.
        const retried = await runIndexingStage(stageInput(v2, "replay-partial.txt"));
        const afterRetry = await versionCounts(doc.documentId, v2.versionId);
        expect(afterRetry).toEqual(cleanCounts);
        expect(retried.contextChunkCount).toBe(clean.contextChunkCount);

        // The other version is untouched by the reset.
        expect(await versionCounts(doc.documentId, doc.versionId)).toEqual(cleanCounts);
    });

    it("per-dimension vectors commit with their chunks and survive replay", async () => {
        const doc = await newDocument("replay-768.txt");
        const input = stageInput(doc, "replay-768.txt", "gemini-embedding-768");

        async function vectorRows() {
            const [row] = await handle.db
                .select({ n: sql<number>`count(*)::int` })
                .from(documentEmbeddings768)
                .innerJoin(
                    documentRetrievalChunks,
                    eq(documentEmbeddings768.retrievalChunkId, documentRetrievalChunks.id)
                )
                .where(
                    and(
                        eq(documentRetrievalChunks.documentId, BigInt(doc.documentId)),
                        eq(documentRetrievalChunks.versionId, BigInt(doc.versionId))
                    )
                );
            return row!.n;
        }

        await runIndexingStage(input);
        const first = await versionCounts(doc.documentId, doc.versionId);
        expect(first.retrievalChunks).toBeGreaterThan(0);
        expect(await vectorRows()).toBe(first.retrievalChunks);

        await runIndexingStage(input);
        const second = await versionCounts(doc.documentId, doc.versionId);
        expect(second).toEqual(first);
        // Old vector rows went with their cascaded chunks; every surviving
        // retrieval chunk has exactly one vector.
        expect(await vectorRows()).toBe(second.retrievalChunks);
    });
});
