/**
 * Feedback reports — bug reports and feature requests (`~/lib/feedback/contract`).
 *
 * GET  ?scope=mine|ideas|triage&kind&status&q&sort&limit → `{ items: FeedbackListItem[] }`.
 *      `triage` is for triagers only (403 otherwise).
 * POST multipart: `payload` = JSON of `createFeedbackSchema`, `files` = up to
 *      three images → 201 `{ report: FeedbackDetail }`. Refused with 403 while
 *      the instance names no triager. Session only: the active workspace is
 *      recorded when there is one. The operator's webhook, if set, hears
 *      about it after the report is stored.
 *
 * Errors are `{ error }` in the reader's language.
 */

import { NextResponse } from "next/server";

import { requestTranslator } from "~/i18n/server";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    FEEDBACK_LIMITS,
    createFeedbackSchema,
    listFeedbackQuerySchema,
} from "~/lib/feedback/contract";
import { feedbackEnabled } from "~/server/feedback/access";
import { activeWorkspaceId, resolveFeedbackCaller } from "~/server/feedback/caller";
import { parseContract } from "~/server/feedback/http";
import { normalizeFeedbackImage, type NormalizedFeedbackImage } from "~/server/feedback/images";
import { FEEDBACK_CREATE_LIMIT } from "~/server/feedback/limits";
import { createFeedbackReport, getFeedbackReport, listFeedback } from "~/server/feedback/store";
import { queueFeedbackWebhook } from "~/server/feedback/webhook";
import { publicOrigin } from "~/server/public-origin";
import { queryObject, workspaceErrorResponse } from "~/server/workspace/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every image at its limit, plus room for the payload and the multipart framing. */
const MAX_BODY_BYTES =
    FEEDBACK_LIMITS.attachmentsMax * FEEDBACK_LIMITS.attachmentBytesMax + 1024 * 1024;

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;
        const query = parseContract(queryObject(request), listFeedbackQuerySchema, request);
        if (!query.success) return query.response;
        try {
            const items = await listFeedback(caller.data, query.data);
            return NextResponse.json({ items });
        } catch (error) {
            return workspaceErrorResponse(error, "[feedback GET]", request);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, FEEDBACK_CREATE_LIMIT, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;

        const t = requestTranslator(request, "errors.feedback");
        const refuse = (error: string, status = 400) => NextResponse.json({ error }, { status });
        if (!feedbackEnabled()) return refuse(t("disabled"), 403);

        // The whole body is buffered to parse it, so a declared size past
        // what the contract allows is refused before a byte is read.
        const mb = Math.round(FEEDBACK_LIMITS.attachmentBytesMax / (1024 * 1024));
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > MAX_BODY_BYTES) {
            return refuse(t("requestTooLarge", { max: FEEDBACK_LIMITS.attachmentsMax, mb }), 413);
        }

        let form: FormData;
        try {
            form = await request.formData();
        } catch {
            return refuse(t("multipartRequired"));
        }

        const rawPayload = form.get("payload");
        if (typeof rawPayload !== "string") return refuse(t("payloadMissing"));
        let payload: unknown;
        try {
            payload = JSON.parse(rawPayload) as unknown;
        } catch {
            return refuse(t("payloadInvalid"));
        }
        const input = parseContract(payload, createFeedbackSchema, request);
        if (!input.success) return input.response;

        const files = form.getAll("files");
        if (files.length > FEEDBACK_LIMITS.attachmentsMax) {
            return refuse(t("tooManyImages", { max: FEEDBACK_LIMITS.attachmentsMax }));
        }
        for (const file of files) {
            if (typeof file === "string") return refuse(t("imageType"));
            // Refused before it is decoded.
            if (file.size > FEEDBACK_LIMITS.attachmentBytesMax) {
                return refuse(t("imageTooLarge", { mb }));
            }
        }

        try {
            const images: NormalizedFeedbackImage[] = [];
            for (const file of files as Blob[]) {
                images.push(
                    await normalizeFeedbackImage(Buffer.from(await file.arrayBuffer()), file.type)
                );
            }
            const created = await createFeedbackReport({
                reporter: { ...caller.data, companyId: await activeWorkspaceId() },
                input: input.data,
                images,
            });
            queueFeedbackWebhook(created, publicOrigin(request));
            const report = await getFeedbackReport(caller.data, created.id);
            return NextResponse.json({ report }, { status: 201 });
        } catch (error) {
            return workspaceErrorResponse(error, "[feedback POST]", request);
        }
    });
}
