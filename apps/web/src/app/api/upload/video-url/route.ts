import { NextResponse } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { validateRequestBody } from "~/lib/validation";
import { processVideoUrlUpload } from "~/server/services/document-upload";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { assertPublicHttpUrl, UrlGuardError } from "~/server/security/url-guard";

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
                    details: error instanceof Error ? error.message : "Unknown error",
                },
                { status: 500 }
            );
        }
    });
}
