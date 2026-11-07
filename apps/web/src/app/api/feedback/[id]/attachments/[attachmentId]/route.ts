/**
 * Serves a report's screenshot — to its reporter and triagers only. Anyone
 * else, including someone reading the idea on the board, gets the same 404 as
 * a missing id.
 *
 * Attachments are written once and never change, so the bytes cache forever
 * (privately: they are behind the session).
 */

import { NextResponse } from "next/server";

import { requestTranslator } from "~/i18n/server";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { resolveFeedbackCaller } from "~/server/feedback/caller";
import { readFeedbackAttachment } from "~/server/feedback/store";
import { parseIdParam, workspaceErrorResponse } from "~/server/workspace/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;
        const raw = await params;
        const reportId = parseIdParam(raw.id);
        const attachmentId = parseIdParam(raw.attachmentId);
        const notFound = () =>
            NextResponse.json(
                { error: requestTranslator(request, "errors.api")("notFound") },
                { status: 404 }
            );
        if (reportId === null || attachmentId === null) return notFound();
        try {
            const image = await readFeedbackAttachment(caller.data, reportId, attachmentId);
            if (!image) return notFound();
            return new NextResponse(new Uint8Array(image.data), {
                status: 200,
                headers: {
                    "Content-Type": image.contentType,
                    "Content-Length": String(image.data.length),
                    "Cache-Control": "private, max-age=31536000, immutable",
                    "X-Content-Type-Options": "nosniff",
                },
            });
        } catch (error) {
            return workspaceErrorResponse(error, "[feedback attachments GET]", request);
        }
    });
}
