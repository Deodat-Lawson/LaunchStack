import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { validateRequestBody } from "~/lib/validation";
import { processVideoUrlUpload } from "~/server/services/document-upload";
import { assertPublicHttpUrl, UrlGuardError } from "~/server/security/url-guard";

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

    const { userId: bodyUserId, videoUrl, category, title, preferredProvider } =
      validation.data;

    // Identity comes from the Clerk session, never the request body.
    // `userId` stays in the schema for wire-compat but is overridden.
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (bodyUserId && bodyUserId !== userId) {
      console.warn(
        `[VideoUrlUpload] Ignoring body userId=${bodyUserId}; using session userId=${userId}`
      );
    }

    // SSRF guard: best-effort pre-check only. This route never fetches the
    // URL itself — it hands the string to the transcription sidecar, which
    // downloads in its own process — so `fetchPublicUrl` (per-redirect-hop
    // re-validation) does not apply here. Redirect hardening for downloads
    // the sidecar performs has to live in the sidecar.
    try {
      await assertPublicHttpUrl(videoUrl);
    } catch (err) {
      if (err instanceof UrlGuardError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

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
