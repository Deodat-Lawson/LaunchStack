/**
 * Process Document API Route
 * Triggers the OCR-to-Vector pipeline via Inngest.
 * Supports both cloud storage (UploadThing) and database storage.
 * Accepts any file type: known types use dedicated adapters; unknown types use best-effort text extraction.
 */

import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { ocrJobs } from "@launchstack/store/schema";
import { processDocumentUpload } from "~/server/services/document-upload";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { UploadAuthorizationError } from "~/server/services/internal-file-ref";

const UploadDocumentSchema = z.object({
    documentUrl: z.string().min(1, "Document URL or path is required"),
    documentName: z.string().min(1, "Document name is required"),
    category: z.string().optional(),
    preferredProvider: z.string().optional(),
    storageType: z.enum(["s3", "database"]).optional(),
    mimeType: z.string().optional(),
    originalFilename: z.string().optional(),
    storageProvider: z.string().optional(),
    storagePathname: z.string().optional(),
    embeddingIndexKey: z.string().min(1).optional(),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        try {
            const validation = await validateRequestBody(request, UploadDocumentSchema);
            if (!validation.success) {
                return validation.response;
            }

            const {
                documentUrl: rawDocumentUrl,
                documentName,
                category,
                preferredProvider,
                storageType: explicitStorageType,
                mimeType,
                originalFilename,
                embeddingIndexKey,
            } = validation.data;

            const uploadResult = await processDocumentUpload({
                user: {
                    userId: ctx.data.authUserId,
                    companyId: ctx.data.companyId,
                },
                documentName,
                rawDocumentUrl,
                creationKey: `upload:${rawDocumentUrl}`,
                category,
                preferredProvider,
                explicitStorageType,
                mimeType,
                originalFilename,
                embeddingIndexKey,
                requestUrl: request.url,
            });

            return NextResponse.json(
                {
                    success: true,
                    jobId: uploadResult.jobId,
                    eventIds: uploadResult.eventIds,
                    message: "Document processing started",
                    storageType: uploadResult.storageType,
                    document: uploadResult.document,
                },
                { status: 202 }
            );
        } catch (error) {
            if (error instanceof UploadAuthorizationError) {
                return NextResponse.json({ error: error.message }, { status: error.status });
            }
            console.error("[UploadDocument] Error triggering document processing:", error);
            return NextResponse.json(
                { error: "Failed to start document processing" },
                { status: 500 }
            );
        }
    });
}

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const { searchParams } = new URL(request.url);
        const jobId = searchParams.get("jobId");

        if (!jobId) {
            return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
        }

        const [job] = await db
            .select()
            .from(ocrJobs)
            .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.companyId, ctx.data.companyId)));

        if (!job) {
            return NextResponse.json({ error: "Job not found" }, { status: 404 });
        }

        return NextResponse.json({
            jobId: job.id,
            status: job.status,
            documentName: job.documentName,
            provider: job.actualProvider ?? job.primaryProvider,
            pageCount: job.pageCount,
            confidenceScore: job.confidenceScore,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            processingDurationMs: job.processingDurationMs,
            error: job.errorMessage,
        });
    } catch (error) {
        console.error("Error fetching job status:", error);
        return NextResponse.json({ error: "Failed to fetch job status" }, { status: 500 });
    }
}
