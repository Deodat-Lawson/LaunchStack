import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { eq, sql, and, gt, desc, ne } from "drizzle-orm";
import { analyzeDocumentChunks } from "~/app/api/agents/predictive-document-analysis/agent";
import type { PredictiveAnalysisResult } from "~/app/api/agents/predictive-document-analysis/agent";
import { predictiveDocumentAnalysisResults, document, pdfChunks, documentContextChunks, documentStructure } from "@launchstack/core/db/schema";
import { sanitizeErrorMessage } from "~/app/api/agents/predictive-document-analysis/utils/logging";
import {
    ANALYSIS_BATCH_CONFIG,
    ANALYSIS_TYPES,
    TIMEOUT_LIMITS,
    CACHE_CONFIG,
    ERROR_TYPES,
    HTTP_STATUS,
    type AnalysisType,
    type ErrorType
} from "~/lib/constants";
import {
    predictiveAnalysisAiCalls,
    predictiveAnalysisCacheHits,
    predictiveAnalysisDuration,
    predictiveAnalysisRequests
} from "~/server/metrics/registry";
import { validateRequestBody, PredictiveAnalysisSchema } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { notifyOnCriticalFindings } from "~/lib/integrations/slack";

export const runtime = 'nodejs';
export const maxDuration = 300;

type PdfChunk = {
    id: number;
    content: string;
    page: number;
};

type DocumentDetails = {
    title: string;
    category: string;
    companyId: string;
};

type PredictiveAnalysisOutput = {
    documentId: number;
    analysisType: string;
    summary: {
        totalMissingDocuments: number;
        highPriorityItems: number;
        totalRecommendations: number;
        totalInsights: number;
        totalSuggestedRelated: number;
        analysisTimestamp: string;
    };
    analysis: PredictiveAnalysisResult;
    metadata: {
        pagesAnalyzed: number;
        existingDocumentsChecked: number;
        aiCalls: number;
    };
};


async function getCachedAnalysis(documentId: number, analysisType: string, includeRelatedDocs: boolean) {
    const result = await db.select({ resultJson: predictiveDocumentAnalysisResults.resultJson })
        .from(predictiveDocumentAnalysisResults)
        .where(
            and(
                eq(predictiveDocumentAnalysisResults.documentId, BigInt(documentId)),
                eq(predictiveDocumentAnalysisResults.analysisType, analysisType),
                eq(predictiveDocumentAnalysisResults.includeRelatedDocs, includeRelatedDocs),
                gt(
                    predictiveDocumentAnalysisResults.createdAt,
                    sql`NOW() - INTERVAL '${sql.raw(`${CACHE_CONFIG.TTL_HOURS} hours`)}'`
                )
            )
        )
        .orderBy(desc(predictiveDocumentAnalysisResults.createdAt))
        .limit(1);

    return result[0]?.resultJson ?? null;
}

async function storeAnalysisResult(documentId: number, analysisType: string, includeRelatedDocs: boolean, resultJson: PredictiveAnalysisOutput) {
    const result = await db.insert(predictiveDocumentAnalysisResults).values({
        documentId: BigInt(documentId),
        analysisType,
        includeRelatedDocs,
        resultJson,
    });
    return result;
}

async function getDocumentDetails(documentId: number) : Promise<DocumentDetails | null> {
    const results = await db
        .select({ title: document.title, category: document.category, companyId: document.companyId })
        .from(document)
        .where(eq(document.id, documentId))
        .limit(1);

    return results[0] ? { ...results[0], companyId: results[0].companyId.toString() } : null;
}

export async function POST(request: Request) {
    // Apply rate limiting: 20 requests per 15 minutes for predictive analysis
    // This is a compute-intensive AI operation
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const endTimer = predictiveAnalysisDuration.startTimer();
        let cachedLabel: "true" | "false" = "false";
        const recordResult = (result: "success" | "error") => {
            predictiveAnalysisRequests.inc({ result, cached: cachedLabel });
            endTimer({ result, cached: cachedLabel });
        };

        try {
        const validation = await validateRequestBody(request, PredictiveAnalysisSchema);
        if (!validation.success) {
            recordResult("error");
            return validation.response;
        }

        const {
            documentId,
            analysisType,
            includeRelatedDocs,
            timeoutMs,
            forceRefresh
        } = validation.data;

        const typedAnalysisType: AnalysisType = analysisType ?? "general";
        const typedIncludeRelatedDocs: boolean = includeRelatedDocs ?? false;

        // Input validation
        if (typeof documentId !== 'number' || documentId <= 0) {
            recordResult("error");
            return NextResponse.json({
                success: false,
                message: "Invalid documentId. Must be a positive number.",
                errorType: ERROR_TYPES.VALIDATION
            }, { status: HTTP_STATUS.BAD_REQUEST });
        }

        if (!ANALYSIS_TYPES.includes(typedAnalysisType)) {
            recordResult("error");
            return NextResponse.json({
                success: false,
                message: `Invalid analysisType. Must be one of: ${ANALYSIS_TYPES.join(', ')}`,
                errorType: ERROR_TYPES.VALIDATION
            }, { status: HTTP_STATUS.BAD_REQUEST });
        }

        if (timeoutMs && (timeoutMs < TIMEOUT_LIMITS.MIN_MS || timeoutMs > TIMEOUT_LIMITS.MAX_MS)) {
            recordResult("error");
            return NextResponse.json({
                success: false,
                message: `Invalid timeoutMs. Must be between ${TIMEOUT_LIMITS.MIN_MS} and ${TIMEOUT_LIMITS.MAX_MS}`,
                errorType: ERROR_TYPES.VALIDATION
            }, { status: HTTP_STATUS.BAD_REQUEST });
        }

        if (!forceRefresh) {
            const cachedResult = await getCachedAnalysis(documentId, typedAnalysisType, typedIncludeRelatedDocs);

            if (cachedResult) {
                cachedLabel = "true";
                predictiveAnalysisCacheHits.inc();
                recordResult("success");
                return NextResponse.json({
                    success: true,
                    ...cachedResult,
                    fromCache: true
                }, { status: HTTP_STATUS.OK });
            }
        }

        const docDetails = await getDocumentDetails(documentId);
        if (!docDetails) {
            recordResult("error");
            return NextResponse.json({
                success: false,
                message: "Document not found.",
                errorType: ERROR_TYPES.VALIDATION
            }, { status: HTTP_STATUS.NOT_FOUND });
        }

        // Read from RLM table first (with structure headings), fall back to legacy pdfChunks
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

        let chunks: PdfChunk[];

        if (rlmChunks.length > 0) {
            chunks = rlmChunks.map(c => ({
                id: c.id,
                content: c.content,
                page: c.page ?? 1,
                sectionHeading: c.sectionHeading,
            }));
        } else {
            const legacyChunks = await db
                .select({
                    id: pdfChunks.id,
                    content: pdfChunks.content,
                    page: pdfChunks.page
                })
                .from(pdfChunks)
                .where(eq(pdfChunks.documentId, BigInt(documentId)))
                .orderBy(pdfChunks.id);

            chunks = legacyChunks;
        }

        if (chunks.length === 0) {
            recordResult("error");
            return NextResponse.json({
                success: false,
                message: "No chunks found for the given documentId.",
                errorType: ERROR_TYPES.VALIDATION
            }, { status: HTTP_STATUS.NOT_FOUND });
        }

        let existingDocuments: string[] = [];
        if (includeRelatedDocs) {
            const currentDoc = await db.select({ companyId: document.companyId })
                .from(document)
                .where(eq(document.id, documentId))
                .limit(1);

            const currentCompanyId = currentDoc[0]?.companyId;

            if (currentCompanyId) {
                const existingDocs = await db
                    .selectDistinct({ title: document.title, url: document.url }) //getting title and document url
                    .from(document)
                    .where(
                        and(
                            eq(document.companyId, currentCompanyId),
                            ne(document.id, documentId)
                        )
                    );

                existingDocuments = existingDocs.map(row => `${row.title || row.url}`);
            }
        }

        const specification = {
            type: typedAnalysisType,
            includeRelatedDocs: typedIncludeRelatedDocs,
            existingDocuments,
            title: docDetails.title,
            category: docDetails.category
        };

        const { result: analysisResult, stats } = await analyzeDocumentChunks(
            chunks,
            {
                ...specification,
                companyId: Number(docDetails.companyId),
                documentId
            },
            timeoutMs,
            ANALYSIS_BATCH_CONFIG.MAX_CONCURRENCY
        );
        predictiveAnalysisAiCalls.observe(chunks.length);

        const fullResult = {
            documentId,
            analysisType: typedAnalysisType,
            summary: {
                totalMissingDocuments: analysisResult.missingDocuments.length,
                highPriorityItems: analysisResult.missingDocuments.filter(doc => doc.priority === 'high').length,
                totalRecommendations: analysisResult.recommendations.length,
                totalInsights: analysisResult.insights?.length ?? 0,
                totalSuggestedRelated: analysisResult.suggestedRelatedDocuments?.length ?? 0,
                analysisTimestamp: new Date().toISOString()
            },
            analysis: analysisResult,
            metadata: {
                pagesAnalyzed: chunks.length,
                existingDocumentsChecked: existingDocuments.length,
                aiCalls: stats.aiCalls
            }
        } as PredictiveAnalysisOutput;

        await storeAnalysisResult(documentId, typedAnalysisType, typedIncludeRelatedDocs, fullResult);

        // Fire-and-forget Slack notification for critical findings
        notifyOnCriticalFindings(
            docDetails.title,
            typedAnalysisType,
            analysisResult.missingDocuments,
        ).catch(() => { /* non-critical */ });

        recordResult("success");

        return NextResponse.json({
            success: true,
            ...fullResult,
            fromCache: false
        }, { status: HTTP_STATUS.OK });
    } catch (error: unknown) {
        console.error("Predictive Document Analysis Error:", sanitizeErrorMessage(error));

        let status: number = HTTP_STATUS.INTERNAL_SERVER_ERROR;
        let message = "Failed to perform predictive document analysis";
        let errorType: ErrorType = ERROR_TYPES.UNKNOWN;

        if (error instanceof Error) {
            if (error.message.includes('timed out') || error.message.includes('timeout')) {
                status = HTTP_STATUS.TIMEOUT;
                message = "The AI analysis took too long to complete. Please try again or reduce the document size.";
                errorType = ERROR_TYPES.TIMEOUT;
            } else if (error.message.includes('database') || error.message.includes('connection')) {
                status = HTTP_STATUS.SERVICE_UNAVAILABLE;
                message = "Database connection error. Please try again later.";
                errorType = ERROR_TYPES.DATABASE;
            } else if (error.message.includes('search') || error.message.includes('fetch')) {
                status = HTTP_STATUS.BAD_GATEWAY;
                message = "External service error. Analysis completed with limited functionality.";
                errorType = ERROR_TYPES.EXTERNAL_SERVICE;
            } else if (error.message.includes('openai') || error.message.includes('api')) {
                status = HTTP_STATUS.BAD_GATEWAY;
                message = "AI service temporarily unavailable. Please try again later.";
                errorType = ERROR_TYPES.AI_SERVICE;
            } else if (error.message.includes('validation') || error.message.includes('invalid')) {
                status = HTTP_STATUS.BAD_REQUEST;
                message = "Invalid request data provided.";
                errorType = ERROR_TYPES.VALIDATION;
            }
        }

            recordResult("error");

            return NextResponse.json({
                success: false,
                error: String(error) ?? "Unknown error",
                message,
                errorType,
                timestamp: new Date().toISOString()
            }, { status });
        }
    });
}
