import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { validateRequestBody } from "~/lib/validation";
import { processVideoUrlUpload } from "~/server/services/document-upload";

const VideoUrlSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  videoUrl: z.string().url("A valid URL is required"),
  category: z.string().min(1, "Category is required"),
  title: z.string().optional(),
  preferredProvider: z.string().optional(),
});

export async function POST(request: Request) {
  return withRateLimit(request, RateLimitPresets.standard, async () => {
    const validation = await validateRequestBody(request, VideoUrlSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { userId, videoUrl, category, title, preferredProvider } = validation.data;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId));

    if (!user) {
      return NextResponse.json({ error: "Invalid user" }, { status: 400 });
    }

    try {
      const result = await processVideoUrlUpload({
        user: { userId, companyId: user.companyId },
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
