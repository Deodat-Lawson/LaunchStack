import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import {
    predictiveDocumentAnalysisResults,
    document,
    documentContextChunks,
} from "@launchstack/core/db/schema";
import { inngest } from "~/server/inngest/client";
import { validateRequestBody, PredictiveAnalysisSchema } from "~/lib/validation";
import { CACHE_CONFIG, ERROR_TYPES, HTTP_STATUS, type AnalysisType } from "~/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * SSE endpoint for predictive document analysis.
 *
 * Dispatches the analysis to Inngest for async processing, then streams
 * progress updates back to the client via Server-Sent Events. The client
 * receives:
 *   - "status" events with progress updates
 *   - a "result" event with the full analysis when complete
 *   - an "error" event if the job fails
 */
export async function POST(request: Request) {
    const validation = await validateRequestBody(request, PredictiveAnalysisSchema);
    if (!validation.success) {
        return validation.response;
    }

    const {
        documentId,
        analysisType,
        includeRelatedDocs,
        timeoutMs,
        forceRefresh,
    } = validation.data;

    const typedAnalysisType: AnalysisType = analysisType ?? "general";
    const typedIncludeRelatedDocs = includeRelatedDocs ?? false;

    // Check cache first (unless forceRefresh)
    if (!forceRefresh) {
        const cached = await db
            .select({ resultJson: predictiveDocumentAnalysisResults.resultJson })
            .from(predictiveDocumentAnalysisResults)
            .where(
                and(
                    eq(predictiveDocumentAnalysisResults.documentId, BigInt(documentId)),
                    eq(predictiveDocumentAnalysisResults.analysisType, typedAnalysisType),
                    eq(predictiveDocumentAnalysisResults.includeRelatedDocs, typedIncludeRelatedDocs),
                    gt(
                        predictiveDocumentAnalysisResults.createdAt,
                        sql`NOW() - INTERVAL '${sql.raw(`${CACHE_CONFIG.TTL_HOURS} hours`)}'`
                    )
                )
            )
            .orderBy(desc(predictiveDocumentAnalysisResults.createdAt))
            .limit(1);

        if (cached[0]?.resultJson) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "result", data: cached[0]!.resultJson, fromCache: true })}\n\n`));
                    controller.close();
                },
            });
            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                },
            });
        }
    }

    // Verify document exists and has chunks
    const docCheck = await db
        .select({ id: document.id })
        .from(document)
        .where(eq(document.id, documentId))
        .limit(1);

    if (docCheck.length === 0) {
        return NextResponse.json(
            { success: false, message: "Document not found.", errorType: ERROR_TYPES.VALIDATION },
            { status: HTTP_STATUS.NOT_FOUND }
        );
    }

    const chunkCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(documentContextChunks)
        .where(eq(documentContextChunks.documentId, BigInt(documentId)));

    const totalChunks = Number(chunkCount[0]?.count ?? 0);
    if (totalChunks === 0) {
        return NextResponse.json(
            { success: false, message: "No chunks found for document.", errorType: ERROR_TYPES.VALIDATION },
            { status: HTTP_STATUS.NOT_FOUND }
        );
    }

    // Dispatch to Inngest
    const jobId = `pda-${documentId}-${Date.now()}`;
    await inngest.send({
        name: "predictive-analysis/run.requested",
        data: {
            documentId,
            analysisType: typedAnalysisType,
            includeRelatedDocs: typedIncludeRelatedDocs,
            timeoutMs,
            jobId,
        },
    });

    // Stream progress via SSE by polling the result table
    const encoder = new TextEncoder();
    const maxWaitMs = timeoutMs ?? 120000;
    const pollIntervalMs = 3000;

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: event, data })}\n\n`));
            };

            send("status", { phase: "queued", totalChunks, jobId });

            const startTime = Date.now();
            let found = false;

            while (Date.now() - startTime < maxWaitMs) {
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

                const result = await db
                    .select({ resultJson: predictiveDocumentAnalysisResults.resultJson })
                    .from(predictiveDocumentAnalysisResults)
                    .where(
                        and(
                            eq(predictiveDocumentAnalysisResults.documentId, BigInt(documentId)),
                            eq(predictiveDocumentAnalysisResults.analysisType, typedAnalysisType),
                            gt(
                                predictiveDocumentAnalysisResults.createdAt,
                                sql`NOW() - INTERVAL '5 minutes'`
                            )
                        )
                    )
                    .orderBy(desc(predictiveDocumentAnalysisResults.createdAt))
                    .limit(1);

                if (result[0]?.resultJson) {
                    send("result", { ...result[0].resultJson, fromCache: false });
                    found = true;
                    break;
                }

                const elapsed = Math.round((Date.now() - startTime) / 1000);
                send("status", { phase: "processing", elapsed, totalChunks, jobId });
            }

            if (!found) {
                send("error", { message: "Analysis timed out. Results will be cached when complete." });
            }

            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
