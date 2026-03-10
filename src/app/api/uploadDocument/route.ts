/**
 * Process Document API Route
 * Triggers the OCR-to-Vector pipeline via Inngest.
 * Supports both cloud storage (UploadThing) and database storage.
 * Accepts any file type: known types use dedicated adapters; unknown types use best-effort text extraction.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users, ocrJobs } from "~/server/db/schema";
import { processDocumentUpload } from "~/server/services/document-upload";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";

/**
 * Request validation schema
 * Accepts either a full URL (cloud) or a relative path (database)
 */
const UploadDocumentSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  documentUrl: z.string().min(1, "Document URL or path is required"),
  documentName: z.string().min(1, "Document name is required"),
  category: z.string().optional(),
  preferredProvider: z.string().optional(),
  storageType: z.enum(["cloud", "database"]).optional(),
  /** MIME type of the uploaded file — used to route non-PDF files to the correct adapter */
  mimeType: z.string().optional(),
});

export async function POST(request: Request) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const validation = await validateRequestBody(request, UploadDocumentSchema);
      if (!validation.success) {
        return validation.response;
      }

      const {
        userId,
        documentUrl: rawDocumentUrl,
        documentName,
        category,
        preferredProvider,
        storageType: explicitStorageType,
        mimeType,
      } = validation.data;

      console.log(
        `[UploadDocument] Incoming: name="${documentName}", url="${rawDocumentUrl.substring(0, 80)}", ` +
        `mime=${mimeType ?? "not provided"}, user=${userId}, provider=${preferredProvider ?? "auto"}`
      );

      const [userInfo] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId));

      if (!userInfo) {
        console.warn(`[UploadDocument] Rejected: user not found userId=${userId}`);
        return NextResponse.json(
          { error: "Invalid user" },
          { status: 400 }
        );
      }

      const uploadResult = await processDocumentUpload({
        user: {
          userId,
          companyId: userInfo.companyId,
        },
        documentName,
        rawDocumentUrl,
        category,
        preferredProvider,
        explicitStorageType,
        mimeType,
        requestUrl: request.url,
      });

      console.log(
        `[UploadDocument] Pipeline triggered: jobId=${uploadResult.jobId}, docId=${uploadResult.document.id}, ` +
        `mime=${mimeType ?? "none"}, eventIds=${uploadResult.eventIds.length}`
      );

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
      console.error("[UploadDocument] Error triggering document processing:", error);
      return NextResponse.json(
        {
          error: "Failed to start document processing",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    const [job] = await db
      .select()
      .from(ocrJobs)
      .where(eq(ocrJobs.id, jobId));

    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
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
    return NextResponse.json(
      { error: "Failed to fetch job status" },
      { status: 500 }
    );
  }
}

