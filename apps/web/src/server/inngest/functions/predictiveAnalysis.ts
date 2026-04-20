import { inngest } from "~/server/inngest/client";
import { db } from "~/server/db";
import {
    document,
    pdfChunks,
    documentContextChunks,
    documentStructure,
    predictiveDocumentAnalysisResults,
} from "~/server/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { analyzeDocumentChunks } from "~/app/api/agents/predictive-document-analysis/services/analysisEngine";
import { ANALYSIS_BATCH_CONFIG } from "~/lib/constants";
import type { PdfChunk } from "~/app/api/agents/predictive-document-analysis/types";

/**
 * Inngest function for async predictive document analysis.
 * Used for large documents that may exceed the default HTTP timeout.
 *
 * Progress is tracked via the predictiveDocumentAnalysisResults table
 * and polled by the SSE endpoint.
 */
export const predictiveAnalysisJob = inngest.createFunction(
    {
        id: "predictive-analysis-job",
        retries: 2,
        concurrency: { limit: 5 },
    },
    { event: "predictive-analysis/run.requested" },
    async ({ event, step }) => {
        const { documentId, analysisType, includeRelatedDocs, timeoutMs, jobId } = event.data;

        const docDetails = await step.run("load-document", async () => {
            const results = await db
                .select({
                    title: document.title,
                    category: document.category,
                    companyId: document.companyId,
                })
                .from(document)
                .where(eq(document.id, documentId))
                .limit(1);

            return results[0] ?? null;
        });

        if (!docDetails) {
            throw new Error(`Document ${documentId} not found`);
        }

        const chunks = await step.run("load-chunks", async () => {
            const rlmChunks = await db
                .select({
                    id: documentContextChunks.id,
                    content: documentContextChunks.content,
                    page: documentContextChunks.pageNumber,
                    sectionHeading: documentStructure.title,
                })
                .from(documentContextChunks)
                .leftJoin(
                    documentStructure,
                    eq(documentContextChunks.structureId, documentStructure.id)
                )
                .where(eq(documentContextChunks.documentId, BigInt(documentId)))
                .orderBy(documentContextChunks.id);

            if (rlmChunks.length > 0) {
                return rlmChunks.map(c => ({
                    id: c.id,
                    content: c.content,
                    page: c.page ?? 1,
                    sectionHeading: c.sectionHeading,
                }));
            }

            const legacyChunks = await db
                .select({
                    id: pdfChunks.id,
                    content: pdfChunks.content,
                    page: pdfChunks.page,
                })
                .from(pdfChunks)
                .where(eq(pdfChunks.documentId, BigInt(documentId)))
                .orderBy(pdfChunks.id);

            return legacyChunks as PdfChunk[];
        });

        if (chunks.length === 0) {
            throw new Error(`No chunks found for document ${documentId}`);
        }

        let existingDocuments: string[] = [];
        if (includeRelatedDocs) {
            existingDocuments = await step.run("load-existing-docs", async () => {
                const existingDocs = await db
                    .selectDistinct({ title: document.title, url: document.url })
                    .from(document)
                    .where(
                        and(
                            eq(document.companyId, docDetails.companyId),
                            ne(document.id, documentId)
                        )
                    );
                return existingDocs.map(row => `${row.title || row.url}`);
            });
        }

        const { result: analysisResult, stats } = await step.run("run-analysis", async () => {
            return analyzeDocumentChunks(
                chunks as PdfChunk[],
                {
                    type: analysisType as "contract" | "financial" | "technical" | "compliance" | "general",
                    includeRelatedDocs,
                    existingDocuments,
                    title: docDetails.title,
                    category: docDetails.category,
                    companyId: Number(docDetails.companyId),
                    documentId,
                },
                timeoutMs ?? 60000,
                ANALYSIS_BATCH_CONFIG.MAX_CONCURRENCY,
            );
        });

        const fullResult = {
            documentId,
            analysisType,
            summary: {
                totalMissingDocuments: analysisResult.missingDocuments.length,
                highPriorityItems: analysisResult.missingDocuments.filter(d => d.priority === "high").length,
                totalRecommendations: analysisResult.recommendations.length,
                totalSuggestedRelated: analysisResult.suggestedRelatedDocuments?.length ?? 0,
                analysisTimestamp: new Date().toISOString(),
            },
            analysis: analysisResult,
            metadata: {
                pagesAnalyzed: chunks.length,
                existingDocumentsChecked: existingDocuments.length,
                aiCalls: stats.aiCalls,
                jobId,
            },
        };

        await step.run("persist-result", async () => {
            await db.insert(predictiveDocumentAnalysisResults).values({
                documentId: BigInt(documentId),
                analysisType,
                includeRelatedDocs,
                resultJson: fullResult,
            });
        });

        return fullResult;
    }
);
