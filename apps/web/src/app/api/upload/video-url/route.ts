import { NextResponse } from "next/server";
import { z } from "zod";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordCopy } from "~/i18n/translate";
import { V } from "~/i18n/validation";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { validateRequestBody } from "~/lib/validation";
import { processVideoUrlUpload, UploadRefusedError } from "~/server/services/document-upload";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";
import { assertPublicHttpUrl, UrlGuardError } from "~/server/security/url-guard";

const VideoUrlSchema = z.object({
    videoUrl: z.string().url(V.validUrlRequired),
    category: z.string().min(1, V.categoryRequired),
    title: z.string().optional(),
    preferredProvider: z.string().optional(),
});

export async function POST(request: Request) {
    const locale = localeOfRequest(request);
    const ctx = await requireWorkspacePermission("documents.upload");
    if (!ctx.success) return ctx.response;

    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const validation = await validateRequestBody(request, VideoUrlSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { videoUrl, category, title, preferredProvider } = validation.data;

        if (!(await canEditFolder(ctx.data, category))) {
            return NextResponse.json(
                { error: translatorFor(locale, "sources.server.errors")("folderEditDenied") },
                { status: 403 }
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

        try {
            const result = await processVideoUrlUpload({
                user: { userId: ctx.data.authUserId, companyId: ctx.data.companyId },
                videoUrl,
                requestUrl: request.url,
                category,
                title,
                preferredProvider,
            });
            await recordUpload(ctx.data, result);

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
                    error: translatorFor(locale, "upload.server.errors")("videoUrlFailed"),
                    details:
                        error instanceof UploadRefusedError
                            ? wordCopy(error.copy, locale)
                            : error instanceof Error
                              ? error.message
                              : translatorFor(locale, "errors.api")("unknownError"),
                },
                { status: 500 }
            );
        }
    });
}
