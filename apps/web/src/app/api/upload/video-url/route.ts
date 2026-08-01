import { NextResponse } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { validateRequestBody } from "~/lib/validation";
import { processVideoUrlUpload } from "~/server/services/document-upload";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

const VideoUrlSchema = z.object({
  videoUrl: z.string().url("A valid URL is required"),
  category: z.string().min(1, "Category is required"),
  title: z.string().optional(),
  preferredProvider: z.string().optional(),
});

export async function POST(request: Request) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  return withRateLimit(request, RateLimitPresets.standard, async () => {
    const validation = await validateRequestBody(request, VideoUrlSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { videoUrl, category, title, preferredProvider } = validation.data;

    try {
      const result = await processVideoUrlUpload({
        user: { userId: ctx.data.clerkUserId, companyId: ctx.data.companyId },
        videoUrl,
        requestUrl: request.url,
        category,
        title,
        preferredProvider,
      });

      return NextResponse.json(
        {
          success: true,
          jobId: result.jobId,
          document: result.document,
        },
        { status: 201 }
      );
    } catch (error) {
      console.error("[VideoUrlUpload] Failed:", error);
      return NextResponse.json(
        {
          error: "Failed to process video URL",
          details:
            error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
}
